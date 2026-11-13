import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import amqp from 'amqplib';
import { createBroker } from '../src/messaging/broker.js';

function fakeConnection() {
  const connection = new EventEmitter();
  const channel = new EventEmitter();
  let closed = false;
  let channelClosed = false;
  channel.close = async () => {
    if (!channelClosed) {
      channelClosed = true;
      channel.emit('close');
    }
  };
  connection.createChannel = async () => channel;
  connection.close = async () => {
    if (!closed) {
      closed = true;
      await channel.close();
      connection.emit('close');
    }
  };
  return { connection, channel };
}

test('broker: reintenta al arrancar, recupera conexión/canal y cierra sin reconectar', { timeout: 12000 }, async (t) => {
  let attempts = 0;
  let current;
  const events = new EventEmitter();
  const logs = [];
  const logger = {
    info(message) { events.emit('connected'); logs.push(message); },
    warn(fields, message) { logs.push(JSON.stringify({ fields, message })); },
  };
  t.mock.method(amqp, 'connect', async () => {
    if (++attempts === 1) throw new Error('secret');
    current = fakeConnection();
    return current.connection;
  });

  let connected = once(events, 'connected');
  const broker = createBroker('amqp://user:secret@broker', 'worker', logger);
  t.after(() => broker.close());
  assert.equal(broker.ready, false);
  await connected;
  assert.equal(attempts, 2);
  assert.equal(broker.ready, true);

  connected = once(events, 'connected');
  current.connection.emit('error', new Error('secret'));
  await current.connection.close();
  assert.equal(broker.ready, false);
  await connected;
  assert.equal(broker.ready, true);

  connected = once(events, 'connected');
  current.channel.emit('error', new Error('secret'));
  await current.channel.close();
  await connected;
  assert.equal(broker.ready, true);

  await broker.close();
  assert.equal(broker.ready, false);
  assert.equal(attempts, 4);
  assert.ok(logs.every((line) => !line.includes('secret')));
});

test('broker: cierra también si SIGTERM llega durante la conexión inicial', async (t) => {
  let finishConnecting;
  const { connection } = fakeConnection();
  t.mock.method(amqp, 'connect', () => new Promise((resolve) => { finishConnecting = resolve; }));
  const broker = createBroker('amqp://broker', 'worker', { info() {}, warn() {} });
  const stopped = broker.close();
  finishConnecting(connection);
  await stopped;
  assert.equal(broker.ready, false);
});
