import * as repository from '../repositories/cocina.js';
import { UUID } from '../http/validation.js';
import { PEDIDO_CONFIRMADO } from '../messaging/topology.js';

const VERSIONES_SOPORTADAS = [1];

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

// Efecto idempotente del evento pedido.confirmado: una única OrdenCocina
// "recibida" por pedido. Un reenvío del mismo evento (o de otro evento para el
// mismo pedido) devuelve la orden existente sin crear otra.
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
  };
}
