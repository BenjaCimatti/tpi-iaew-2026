import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createOutboxPublisher } from '../src/services/outbox.js';
import { EXCHANGE } from '../src/messaging/topology.js';

function fakeOutbox(count) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(), pedidoId: randomUUID(), eventType: 'pedido.confirmado', version: 1,
    occurredAt: new Date(Date.now() + i), correlationId: randomUUID(), payload: { orden: i }, publicadoEn: null,
  }));
  const client = {
    outbox: {
      async findMany({ take }) { return rows.filter((row) => !row.publicadoEn).slice(0, take); },
      async update({ where, data }) { Object.assign(rows.find((row) => row.id === where.id), data); },
    },
  };
  return { rows, client };
}

const logger = { info() {}, warn() {} };

test('outbox: publica en orden y marca publicado solo después de la confirmación del broker', async () => {
  const { rows, client } = fakeOutbox(3);
  const published = [];
  const broker = {
    ready: true,
    async publish(exchange, routingKey, content, options) {
      assert.equal(rows.find((row) => row.id === options.messageId).publicadoEn, null);
      published.push({ exchange, routingKey, body: JSON.parse(content), options });
    },
  };
  const outbox = createOutboxPublisher(client, broker, logger);
  assert.equal(await outbox.publishPending(), 3);
  assert.deepEqual(published.map((p) => p.body.orden), [0, 1, 2]);
  assert.ok(published.every((p) => p.exchange === EXCHANGE && p.routingKey === 'pedido.confirmado'));
  assert.equal(published[0].options.correlationId, rows[0].correlationId);
  assert.equal(published[0].options.headers['x-correlation-id'], rows[0].correlationId);
  assert.ok(rows.every((row) => row.publicadoEn instanceof Date));
  assert.equal(await outbox.publishPending(), 0);
});

test('outbox: con broker caído o sin confirmación conserva los eventos pendientes y los reintenta', async () => {
  const { rows, client } = fakeOutbox(2);
  let confirm = false;
  const broker = {
    ready: false,
    async publish() { if (!confirm) throw new Error('nack'); },
  };
  const outbox = createOutboxPublisher(client, broker, logger, { intervalMs: 5, maxIntervalMs: 10 });
  await assert.rejects(outbox.publishPending());
  broker.ready = true;
  await assert.rejects(outbox.publishPending(), /nack/);
  assert.ok(rows.every((row) => row.publicadoEn === null));

  outbox.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(rows.every((row) => row.publicadoEn === null));
  confirm = true;
  outbox.notify();
  for (let i = 0; i < 50 && rows.some((row) => !row.publicadoEn); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  await outbox.stop();
  assert.ok(rows.every((row) => row.publicadoEn instanceof Date));
});
