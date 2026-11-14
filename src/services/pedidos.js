import { randomUUID } from 'node:crypto';
import { EstadoPedido, Prisma } from '../generated/prisma/client.ts';
import * as repository from '../repositories/pedidos.js';
import { HttpError } from '../http/errors.js';
import { invalid, object, uuid } from '../http/validation.js';
import { PEDIDO_CONFIRMADO } from '../messaging/topology.js';

const EVENT_VERSION = 1;

function input(body) {
  object(body);
  const mesaId = uuid(body.mesaId, 'mesaId');
  if (!Array.isArray(body.items) || !body.items.length) invalid('items debe contener al menos un ítem');
  const seen = new Set();
  const items = body.items.map((item) => {
    object(item);
    const productoId = uuid(item.productoId, 'productoId');
    if (seen.has(productoId)) invalid('No repetir productoId en los ítems');
    seen.add(productoId);
    if (!Number.isInteger(item.cantidad) || item.cantidad < 1 || item.cantidad > 2147483647) invalid('cantidad debe ser un entero positivo hasta 2147483647');
    return { productoId, cantidad: item.cantidad };
  });
  return { mesaId, items };
}

async function pricedInput(client, data, previous = []) {
  if (!await client.mesa.findUnique({ where: { id: data.mesaId } })) throw new HttpError(404, 'MESA_NO_ENCONTRADA', 'Mesa inexistente');
  const productos = await client.producto.findMany({ where: { id: { in: data.items.map((item) => item.productoId) } } });
  const catalogo = new Map(productos.map((producto) => [producto.id, producto]));
  const precios = new Map(previous.map((item) => [item.productoId, item.precioUnitario]));
  const items = data.items.map((item) => {
    const producto = catalogo.get(item.productoId);
    if (!producto) throw new HttpError(404, 'PRODUCTO_NO_ENCONTRADO', 'Producto inexistente');
    if (!producto.disponible) throw new HttpError(409, 'PRODUCTO_NO_DISPONIBLE', 'Producto no disponible');
    return { ...item, precioUnitario: precios.get(item.productoId) ?? producto.precio };
  });
  const total = items.reduce((sum, item) => sum.plus(item.precioUnitario.times(item.cantidad)), new Prisma.Decimal(0));
  if (total.gt('999999999999.99')) invalid('El total supera el importe máximo permitido');
  return { mesaId: data.mesaId, items, total };
}

function requirePending(pedido) {
  if (!pedido) throw new HttpError(404, 'PEDIDO_NO_ENCONTRADO', 'Pedido inexistente');
  if (pedido.estado !== 'pendiente') throw new HttpError(409, 'ESTADO_INCOMPATIBLE', 'La operación requiere un pedido pendiente');
}

// Confirmación multi-paso dentro de una única transacción SQL:
// bloqueo del pedido → validación de estado e ítems → bloqueo compartido y
// validación de productos → total con precios capturados → estado/total/fecha
// → evento pedido.confirmado en outbox. Cualquier rechazo revierte todo.
// La orden de cocina NO se crea aquí: la crea el worker al consumir el evento.
async function confirmar(tx, pedido, correlationId) {
  if (!pedido.items.length) throw new HttpError(409, 'PEDIDO_SIN_ITEMS', 'El pedido no tiene ítems para confirmar');
  const productos = new Map((await repository.lockProductos(tx, pedido.items.map((item) => item.productoId)))
    .map((producto) => [producto.id, producto]));
  const items = pedido.items.map((item) => {
    const producto = productos.get(item.productoId);
    if (!producto) throw new HttpError(409, 'PRODUCTO_NO_ENCONTRADO', 'El pedido contiene un producto inexistente');
    if (!producto.disponible) throw new HttpError(409, 'PRODUCTO_NO_DISPONIBLE', 'El pedido contiene un producto no disponible');
    if (!Number.isInteger(item.cantidad) || item.cantidad < 1) throw new HttpError(409, 'CANTIDAD_INVALIDA', 'El pedido contiene una cantidad inválida');
    return { ...item, nombre: producto.nombre };
  });
  const total = items.reduce((sum, item) => sum.plus(item.precioUnitario.times(item.cantidad)), new Prisma.Decimal(0));
  const confirmadoEn = new Date();
  const eventId = randomUUID();
  const confirmado = await repository.confirmPedido(tx, pedido.id, { total, confirmadoEn });
  await repository.createEvento(tx, {
    id: eventId, pedidoId: pedido.id, eventType: PEDIDO_CONFIRMADO, version: EVENT_VERSION,
    occurredAt: confirmadoEn, correlationId,
    payload: {
      eventId, eventType: PEDIDO_CONFIRMADO, version: EVENT_VERSION, occurredAt: confirmadoEn.toISOString(), correlationId,
      pedidoId: pedido.id,
      data: {
        mesaId: pedido.mesaId,
        total: total.toFixed(2),
        items: items.map(({ productoId, nombre, cantidad, precioUnitario }) => ({ productoId, nombre, cantidad, precioUnitario: precioUnitario.toFixed(2) })),
      },
    },
  });
  return confirmado;
}

export function createPedidoService(client, { onConfirmed = () => {} } = {}) {
  async function modify(id, operation) {
    id = uuid(id, 'pedidoId');
    return client.$transaction(async (tx) => {
      const pedido = await repository.lockPedido(tx, id);
      requirePending(pedido);
      return operation(tx, pedido);
    });
  }
  return {
    list(estado) {
      if (estado !== undefined && !Object.values(EstadoPedido).includes(estado)) invalid('estado de pedido inválido');
      return repository.listPedidos(client, estado);
    },
    async get(id) {
      const pedido = await repository.getPedido(client, uuid(id, 'pedidoId'));
      if (!pedido) throw new HttpError(404, 'PEDIDO_NO_ENCONTRADO', 'Pedido inexistente');
      return pedido;
    },
    create(body) {
      const data = input(body);
      return client.$transaction(async (tx) => repository.createPedido(tx, await pricedInput(tx, data)));
    },
    update(id, body) {
      const data = input(body);
      return modify(id, async (tx, pedido) => repository.updatePedido(tx, pedido.id, await pricedInput(tx, data, pedido.items)));
    },
    delete: (id) => modify(id, (tx, pedido) => repository.deletePedido(tx, pedido.id)),
    cancel: (id) => modify(id, (tx, pedido) => repository.cancelPedido(tx, pedido.id)),
    async confirm(id, correlationId = randomUUID()) {
      const pedido = await modify(id, (tx, actual) => confirmar(tx, actual, correlationId));
      onConfirmed(pedido);
      return pedido;
    },
  };
}
