import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createHealthService } from '../src/services/health.js';

const logger = { error() {} };

test('HTTP health: comprueba ambas dependencias y devuelve 503 ante caída', async (t) => {
  let databaseUp = true;
  const database = { async ping() { if (!databaseUp) throw new Error('secret'); } };
  const broker = { ready: true };
  const app = createApp(createHealthService(database, broker, 'api'), logger);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;

  let response = await fetch(`${url}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    servicio: 'api', estado: 'ok', dependencias: { db: 'up', broker: 'up' },
  });

  databaseUp = false;
  response = await fetch(`${url}/health`);
  assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).dependencias, { db: 'down', broker: 'up' });

  databaseUp = true;
  broker.ready = false;
  response = await fetch(`${url}/health`);
  assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).dependencias, { db: 'up', broker: 'down' });

  broker.ready = true;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(`${url}/pedidos`)).status, 404);
});

test('HTTP: un error inesperado no expone detalles internos', async (t) => {
  const app = createApp(async () => { throw new Error('secret'); }, logger);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.codigo, 'ERROR_INTERNO');
  assert.equal(body.mensaje, 'Error interno');
  assert.equal(body.correlationId, response.headers.get('x-correlation-id'));
});
