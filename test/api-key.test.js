import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';

test('API key: válida solo en su ruta, sin reemplazar JWT ni exponerse en errores', async (t) => {
  const key = 'test-key-private';
  const app = createApp(async () => ({ servicio: 'api', estado: 'ok' }), { error() {} }, { client: {}, apiKey: key });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const headers of [{}, { 'x-api-key': 'wrong' }, { 'x-api-key': `${key}-longer` }, { Authorization: 'Bearer test' }]) {
    const response = await fetch(`${base}/health-protegido`, { headers });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'ApiKey');
    const body = await response.json();
    assert.equal(body.codigo, 'API_KEY_INVALIDA');
    assert.ok(!JSON.stringify(body).includes(key));
  }
  const response = await fetch(`${base}/health-protegido`, { headers: { 'x-api-key': key } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).estado, 'ok');
  assert.equal((await fetch(`${base}/productos`, { headers: { 'x-api-key': key } })).status, 401);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('API key: configuración ausente rechaza acceso', async (t) => {
  const app = createApp(async () => ({ estado: 'ok' }), { error() {} }, { client: {} });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/health-protegido`, { headers: { 'x-api-key': 'test' } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).codigo, 'API_KEY_NO_CONFIGURADA');
});
