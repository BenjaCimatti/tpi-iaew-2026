import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/http/errors.js';
import { createMetrics } from '../src/observability/metrics.js';
import { pedidoController } from '../src/controllers/pedidos.js';

function fakeLogger() {
  const lines = [];
  const log = (level) => (fields, msg) => lines.push({ level, ...fields, msg });
  return { lines, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}

test('métricas HTTP: rutas normalizadas sin UUID, status y logs con correlationId', async (t) => {
  const metrics = createMetrics('api', { defaults: false });
  const logger = fakeLogger();
  const fakeClient = { pedido: { findUnique: async () => null }, $transaction: async (fn) => fn({ $queryRaw: async () => [], pedido: { findUnique: async () => null } }) };
  const app = createApp(async () => ({ estado: 'ok' }), logger, { client: fakeClient, authorize: () => [(_q, _r, next) => next()], metrics });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of ids) await fetch(`${base}/pedidos/${id}`);
  const correlationId = randomUUID();
  await fetch(`${base}/pedidos/no-uuid`, { headers: { 'x-correlation-id': correlationId } });
  await fetch(`${base}/inexistente/${randomUUID()}`);
  await fetch(`${base}/health`);

  const response = await fetch(`${base}/metrics`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/plain/);
  const texto = await response.text();
  assert.match(texto, /http_requests_total\{method="GET",route="\/pedidos\/:pedidoId",status="404",servicio="api"\} 3/);
  assert.match(texto, /http_requests_total\{method="GET",route="\/pedidos\/:pedidoId",status="400",servicio="api"\} 1/);
  assert.match(texto, /route="no_encontrada"/);
  assert.match(texto, /http_request_duration_seconds_bucket\{le="\+Inf",servicio="api",method="GET",route="\/health",status="200"\} 1/);
  for (const id of ids) assert.ok(!texto.includes(id), 'ningún UUID en las etiquetas');

  await new Promise((resolve) => setTimeout(resolve, 20));
  const linea = logger.lines.find((l) => l.correlationId === correlationId);
  assert.deepEqual({ ...linea, duracionMs: typeof linea.duracionMs }, {
    level: 'info', msg: 'Request HTTP atendido', operacion: 'GET /pedidos/:pedidoId', metodo: 'GET', ruta: '/pedidos/:pedidoId',
    status: 400, resultado: 'error_cliente', duracionMs: 'number', correlationId,
  });
  assert.equal(logger.lines.find((l) => l.ruta === '/health').level, 'debug', 'healthchecks solo en debug');
});

test('métricas de dominio: confirmaciones aceptadas y rechazadas por código', async (t) => {
  const metrics = createMetrics('api', { defaults: false });
  let falla = new HttpError(409, 'PRODUCTO_NO_DISPONIBLE', 'x');
  const service = { async confirm() { if (falla) throw falla; return { id: 'p', mesaId: 'm', estado: 'confirmado', total: 1, items: [], creadoEn: null, confirmadoEn: null }; } };
  const express = (await import('express')).default;
  const app = express();
  app.use('/pedidos', pedidoController(service, () => [(_q, _r, next) => next()], {}, metrics));
  app.use((error, _q, response, _n) => response.status(error.status ?? 500).end());
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/pedidos/${randomUUID()}/confirmar`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 409);
  falla = new Error('db');
  assert.equal((await fetch(url, { method: 'POST' })).status, 500);
  falla = undefined;
  assert.equal((await fetch(url, { method: 'POST' })).status, 200);
  const texto = await metrics.registry.metrics();
  assert.match(texto, /pedidos_confirmaciones_total\{resultado="rechazada",codigo="PRODUCTO_NO_DISPONIBLE",servicio="api"\} 1/);
  assert.match(texto, /pedidos_confirmaciones_total\{resultado="rechazada",codigo="ERROR_INTERNO",servicio="api"\} 1/);
  assert.match(texto, /pedidos_confirmaciones_total\{resultado="aceptada",codigo="OK",servicio="api"\} 1/);
});
