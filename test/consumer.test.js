import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPedidoConfirmadoConsumer } from '../src/messaging/consumer.js';
import { EventoInvalido, validarPedidoConfirmado } from '../src/services/cocina.js';

const evento = (extra = {}) => ({
  eventId: randomUUID(), eventType: 'pedido.confirmado', version: 1, occurredAt: new Date().toISOString(),
  correlationId: randomUUID(), pedidoId: randomUUID(), data: {}, ...extra,
});
const mensaje = (body, deliveryCount) => ({
  content: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  properties: { messageId: 'm', correlationId: 'c', headers: deliveryCount === undefined ? { otro: 1 } : { otro: 1, 'x-reintentos': deliveryCount } },
});
function fakeChannel({ confirmar = true } = {}) {
  const calls = [];
  return {
    calls,
    ack: () => calls.push(['ack']),
    nack: (m, all, requeue) => calls.push(['nack', requeue]),
    sendToQueue: (queue, content, options, callback) => {
      calls.push(['send', queue, options.headers, options.persistent, options.correlationId]);
      callback(confirmar ? null : new Error('nack'));
    },
  };
}
function fakeLogger() {
  const lines = [];
  const log = (level) => (fields, msg) => lines.push({ level, ...fields, msg });
  return { lines, info: log('info'), warn: log('warn'), error: log('error') };
}

test('validación: rechaza tipo, versión, UUID y fecha inválidos', () => {
  assert.equal(validarPedidoConfirmado(evento({ pedidoId: 'A1C9F0E0-2222-4A2B-9C3D-000000000002' })).pedidoId, 'a1c9f0e0-2222-4a2b-9c3d-000000000002');
  for (const malo of [null, [], evento({ eventType: 'otro' }), evento({ version: 2 }), evento({ eventId: 'x' }), evento({ pedidoId: undefined }), evento({ correlationId: 1 }), evento({ occurredAt: 'ayer' })]) {
    assert.throws(() => validarPedidoConfirmado(malo), EventoInvalido);
  }
});

test('consumidor: ACK después de persistir, duplicado también ACK y notifica solo la orden nueva', async () => {
  const persistidos = [];
  const notificadas = [];
  const cocina = {
    async procesarPedidoConfirmado(e) {
      const creada = !persistidos.includes(e.pedidoId);
      if (creada) persistidos.push(e.pedidoId);
      return { creada, orden: { id: `orden-${e.pedidoId}`, pedidoId: e.pedidoId } };
    },
  };
  const logger = fakeLogger();
  const consumer = createPedidoConfirmadoConsumer(cocina, logger, { onOrdenCreada: (orden) => notificadas.push(orden.id) });
  const channel = fakeChannel();
  const e = evento();
  await consumer.handle(channel, mensaje(e));
  await consumer.handle(channel, mensaje(e, 1));
  assert.deepEqual(channel.calls, [['ack'], ['ack']]);
  assert.deepEqual(notificadas, [`orden-${e.pedidoId}`]);
  assert.deepEqual(logger.lines.map((l) => l.resultado), ['orden_creada', 'duplicado']);
  assert.ok(logger.lines.every((l) => l.eventId === e.eventId && l.pedidoId === e.pedidoId && l.correlationId === e.correlationId));
});

test('consumidor: mensajes inválidos o de negocio imposibles van a la DLQ sin reencolar', async () => {
  const cocina = { async procesarPedidoConfirmado() { throw new EventoInvalido('PEDIDO_INEXISTENTE', 'x'); } };
  const logger = fakeLogger();
  const consumer = createPedidoConfirmadoConsumer(cocina, logger);
  const channel = fakeChannel();
  await consumer.handle(channel, mensaje('{no es json'));
  await consumer.handle(channel, mensaje(evento({ version: 99 })));
  await consumer.handle(channel, mensaje(evento()));
  assert.deepEqual(channel.calls, [['nack', false], ['nack', false], ['nack', false]]);
  assert.deepEqual(logger.lines.map((l) => l.codigo), ['JSON_INVALIDO', 'VERSION_NO_SOPORTADA', 'PEDIDO_INEXISTENTE']);
});

test('consumidor: fallo transitorio republica con x-reintentos y espera creciente; agotado va a la DLQ', async () => {
  let falla = true;
  const cocina = {
    async procesarPedidoConfirmado(e) {
      if (falla) throw Object.assign(new Error('db caída'), { code: 'P1001' });
      return { creada: true, orden: { id: 'o1', pedidoId: e.pedidoId } };
    },
  };
  const logger = fakeLogger();
  const consumer = createPedidoConfirmadoConsumer(cocina, logger, { backoffMs: 5, onOrdenCreada: () => { throw new Error('ws'); } });
  const channel = fakeChannel();
  const inicio = performance.now();
  await consumer.handle(channel, mensaje(evento(), 2));
  assert.ok(performance.now() - inicio >= 15, 'espera creciente según x-reintentos');
  // Copia confirmada por el broker con el contador incrementado; recién entonces ACK del original.
  assert.deepEqual(channel.calls, [['send', 'cocina.pedido-confirmado', { otro: 1, 'x-reintentos': 3 }, true, 'c'], ['ack']]);
  assert.equal(logger.lines[0].resultado, 'reintento');
  assert.equal(logger.lines[0].intento, 3);

  const sinConfirmar = fakeChannel({ confirmar: false });
  await consumer.handle(sinConfirmar, mensaje(evento()));
  assert.deepEqual(sinConfirmar.calls.at(-1), ['nack', true], 'sin confirmación de la copia, el original vuelve a la cola');

  const agotado = fakeChannel();
  await consumer.handle(agotado, mensaje(evento(), 10));
  assert.deepEqual(agotado.calls, [['nack', false]]);
  assert.equal(logger.lines.at(-1).resultado, 'agotado_dlq');

  falla = false;
  await consumer.handle(channel, mensaje(evento()));
  assert.deepEqual(channel.calls.at(-1), ['ack']);
  assert.equal(logger.lines.at(-1).level, 'warn');
});

test('consumidor: si el canal ya cerró, el ACK fallido no rompe el proceso', async () => {
  const cocina = { async procesarPedidoConfirmado(e) { return { creada: false, orden: { id: 'o' } }; } };
  const consumer = createPedidoConfirmadoConsumer(cocina, fakeLogger());
  const channel = { ack() { throw new Error('Channel closed'); } };
  await consumer.handle(channel, mensaje(evento()));
  await consumer.handle(channel, null);
});
