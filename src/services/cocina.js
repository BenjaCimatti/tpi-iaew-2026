import { randomUUID } from 'node:crypto';
import * as repository from '../repositories/cocina.js';
import { HttpError } from '../http/errors.js';
import { invalid, object, UUID, uuid } from '../http/validation.js';
import { ORDEN_ACTUALIZADA, PEDIDO_CONFIRMADO } from '../messaging/topology.js';

const VERSIONES_SOPORTADAS = [1];
const EVENT_VERSION = 1;
export const ESTADOS_ORDEN = ['recibida', 'en_preparacion', 'lista'];

// Avance de cocina y estado del pedido que resulta de cada paso.
// Cocina solo avanza; no hay retrocesos ni saltos.
const TRANSICIONES = {
  recibida: { siguiente: 'en_preparacion', pedido: 'en_preparacion' },
  en_preparacion: { siguiente: 'lista', pedido: 'listo' },
};

// Representación pública de una orden: REST, eventos y WebSocket usan la misma.
export const ordenJSON = (orden) => ({
  id: orden.id,
  pedidoId: orden.pedidoId,
  estado: orden.estado,
  pedidoEstado: orden.pedido.estado,
  mesa: orden.pedido.mesa.numero,
  items: orden.pedido.items.map(({ productoId, cantidad, producto }) => ({ productoId, nombre: producto.nombre, cantidad })),
  creadoEn: orden.creadoEn.toISOString(),
  actualizadoEn: orden.actualizadoEn.toISOString(),
});

// Error que no se resuelve reintentando: el mensaje va directo a la DLQ.
export class EventoInvalido extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export function validarPedidoConfirmado(evento) {
  if (!evento || typeof evento !== 'object' || Array.isArray(evento)) throw new EventoInvalido('EVENTO_MALFORMADO', 'El mensaje no es un objeto JSON');
  if (evento.eventType !== PEDIDO_CONFIRMADO) throw new EventoInvalido('TIPO_NO_SOPORTADO', 'eventType no soportado');
  if (!VERSIONES_SOPORTADAS.includes(evento.version)) throw new EventoInvalido('VERSION_NO_SOPORTADA', 'version no soportada');
  for (const campo of ['eventId', 'pedidoId', 'correlationId']) {
    if (typeof evento[campo] !== 'string' || !UUID.test(evento[campo])) throw new EventoInvalido('EVENTO_MALFORMADO', `${campo} debe ser UUID`);
  }
  if (typeof evento.occurredAt !== 'string' || Number.isNaN(Date.parse(evento.occurredAt))) throw new EventoInvalido('EVENTO_MALFORMADO', 'occurredAt debe ser fecha ISO');
  return { ...evento, pedidoId: evento.pedidoId.toLowerCase() };
}

// Worker: efecto idempotente del evento pedido.confirmado. Una única
// OrdenCocina "recibida" por pedido; un reenvío devuelve la orden existente.
export function createCocinaService(client) {
  return {
    async procesarPedidoConfirmado(evento) {
      const pedido = await repository.getPedidoEstado(client, evento.pedidoId);
      if (!pedido) throw new EventoInvalido('PEDIDO_INEXISTENTE', 'El pedido del evento no existe');
      const existente = await repository.getOrdenPorPedido(client, pedido.id);
      if (existente) return { creada: false, orden: existente };
      if (['pendiente', 'cancelado'].includes(pedido.estado)) throw new EventoInvalido('ESTADO_INCOMPATIBLE', `El pedido está ${pedido.estado}`);
      return repository.createOrdenSiNoExiste(client, pedido.id);
    },
    // Estado inicial del tablero: órdenes de pedidos no entregados.
    async snapshot() {
      return (await repository.listOrdenes(client, { activas: true })).map(ordenJSON);
    },
    async obtener(id) {
      const orden = await repository.getOrden(client, id);
      return orden && ordenJSON(orden);
    },
  };
}

// API: consultas y cambios de estado. Cada cambio guarda, en la misma
// transacción, el evento orden.actualizada en outbox; el gateway del worker lo
// recibe por RabbitMQ (la API y el worker no comparten memoria).
export function createCocinaApiService(client, { onEvento = () => {} } = {}) {
  async function emitir(tx, orden, correlationId) {
    const occurredAt = new Date();
    const eventId = randomUUID();
    const data = ordenJSON(orden);
    await tx.outbox.create({
      data: {
        id: eventId, pedidoId: orden.pedidoId, eventType: ORDEN_ACTUALIZADA, version: EVENT_VERSION, occurredAt, correlationId,
        payload: { eventId, eventType: ORDEN_ACTUALIZADA, version: EVENT_VERSION, occurredAt: occurredAt.toISOString(), correlationId, pedidoId: orden.pedidoId, data: { orden: data } },
      },
    });
    return data;
  }

  // Bloqueo siempre en el mismo orden (pedido → orden) para evitar deadlocks
  // entre cambios de cocina, entrega y cancelación.
  async function transaccion(operation) {
    const resultado = await client.$transaction(operation);
    onEvento();
    return resultado;
  }

  return {
    async listar(estado) {
      if (estado !== undefined && !ESTADOS_ORDEN.includes(estado)) invalid('estado de orden inválido');
      return (await repository.listOrdenes(client, { estado })).map(ordenJSON);
    },
    async obtener(id) {
      const orden = await repository.getOrden(client, uuid(id, 'ordenId'));
      if (!orden) throw new HttpError(404, 'ORDEN_NO_ENCONTRADA', 'Orden de cocina inexistente');
      return ordenJSON(orden);
    },
    avanzar(id, body, correlationId = randomUUID()) {
      id = uuid(id, 'ordenId');
      object(body);
      if (!ESTADOS_ORDEN.includes(body.estado)) invalid(`estado debe ser uno de: ${ESTADOS_ORDEN.join(', ')}`);
      return transaccion(async (tx) => {
        const actual = await repository.getOrden(tx, id);
        if (!actual) throw new HttpError(404, 'ORDEN_NO_ENCONTRADA', 'Orden de cocina inexistente');
        await repository.lockPedido(tx, actual.pedidoId);
        await tx.$queryRaw`SELECT id FROM orden_cocina WHERE id = ${id}::uuid FOR UPDATE`;
        const orden = await repository.getOrden(tx, id);
        const transicion = TRANSICIONES[orden.estado];
        if (!transicion || transicion.siguiente !== body.estado) {
          throw new HttpError(409, 'TRANSICION_INVALIDA', `No se puede pasar de ${orden.estado} a ${body.estado}`);
        }
        await repository.updatePedidoEstado(tx, orden.pedidoId, transicion.pedido);
        return emitir(tx, await repository.updateOrdenEstado(tx, id, transicion.siguiente), correlationId);
      });
    },
    // El mozo entrega un pedido listo: el pedido pasa a "entregado" y el
    // tablero retira la orden.
    entregar(pedidoId, correlationId = randomUUID()) {
      pedidoId = uuid(pedidoId, 'pedidoId');
      return transaccion(async (tx) => {
        const pedido = await repository.lockPedido(tx, pedidoId);
        if (!pedido) throw new HttpError(404, 'PEDIDO_NO_ENCONTRADO', 'Pedido inexistente');
        if (pedido.estado !== 'listo') throw new HttpError(409, 'ESTADO_INCOMPATIBLE', 'Solo se entregan pedidos listos');
        await repository.updatePedidoEstado(tx, pedidoId, 'entregado');
        const orden = await repository.getOrdenPorPedido(tx, pedidoId);
        await emitir(tx, orden, correlationId);
        return pedidoId;
      });
    },
  };
}
