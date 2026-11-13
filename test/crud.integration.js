import assert from 'node:assert/strict';
import { generateKeyPairSync, randomInt, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/http/authorization.js';
import { createDatabase } from '../src/repositories/database.js';

test('CRUD HTTP con PostgreSQL y JWT real: permisos, precios, atomicidad, concurrencia y borrados', { timeout: 30000 }, async (t) => {
  const logger = { error() {}, warn() {} };
  const database = createDatabase(process.env.DATABASE_URL, logger);
  const client = database.client;
  const prefix = `e203-${randomUUID()}`;
  const mesa = await client.mesa.create({ data: { numero: randomInt(1000000, 2000000000), capacidad: 4 } });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'e203-test', alg: 'RS256', use: 'sig' };
  const jwks = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ keys: [key] }));
  }).listen(0, '127.0.0.1');
  await once(jwks, 'listening');
  const issuer = `http://127.0.0.1:${jwks.address().port}/`;
  const audience = 'urn:e203:test';
  const app = createApp(async () => ({ estado: 'ok' }), logger, {
    client, authorize: createAuthorization({ issuer, jwksUri: `${issuer}jwks`, audience }),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => jwks.close(resolve))]);
    try {
      await client.pedido.deleteMany({ where: { mesaId: mesa.id } });
      await client.producto.deleteMany({ where: { nombre: { startsWith: prefix } } });
      await client.mesa.delete({ where: { id: mesa.id } });
    } finally {
      await database.close();
    }
  });

  function token(claims = {}, header = {}) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const parts = `${encode({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header })}.${encode({
      iss: issuer, aud: audience, sub: 'test-client', iat: now, exp: now + 600,
      scope: 'read:pedidos write:pedidos admin:productos', ...claims,
    })}`;
    return `${parts}.${sign('RSA-SHA256', Buffer.from(parts), privateKey).toString('base64url')}`;
  }
  async function request(method, path, body, bearer = token(), headers = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? null : await response.json();
    if (response.status >= 400) {
      assert.equal(typeof data.codigo, 'string');
      assert.equal(typeof data.mensaje, 'string');
      assert.equal(data.correlationId, response.headers.get('x-correlation-id'));
      assert.ok(!JSON.stringify(data).includes('secret'));
    }
    return { status: response.status, data, headers: response.headers };
  }

  assert.equal((await request('GET', '/productos', undefined, null)).status, 401);
  assert.equal((await request('GET', '/productos', undefined, token({ exp: 1 }))).status, 401);
  assert.equal((await request('GET', '/productos', undefined, token({ aud: 'wrong' }))).status, 401);
  assert.equal((await request('GET', '/productos', undefined, token({ iss: 'https://wrong/' }))).status, 401);
  assert.equal((await request('GET', '/productos', undefined, token({}, { alg: 'HS256' }))).status, 401);
  const parts = token().split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
  assert.equal((await request('GET', '/productos', undefined, parts.join('.'))).status, 401);
  const readOnly = token({ scope: 'read:pedidos' });
  assert.equal((await request('GET', '/productos', undefined, readOnly)).status, 200);
  assert.equal((await request('POST', '/productos', { nombre: prefix, precio: 1 }, readOnly)).status, 403);
  assert.equal((await request('POST', '/pedidos', {}, readOnly)).status, 403);
  for (const body of [null, [], {}, { nombre: ' ', precio: 1 }, { nombre: prefix, precio: '1' }, { nombre: prefix, precio: -1 }, { nombre: prefix, precio: 0.001 }, { nombre: prefix, precio: 1e10 }, { nombre: prefix, precio: 1, disponible: 'true' }]) {
    assert.equal((await request('POST', '/productos', body)).status, 400);
  }
  assert.equal((await request('GET', '/productos/bad')).status, 400);
  assert.equal((await request('GET', `/productos/${randomUUID()}`)).status, 404);

  let result = await request('POST', '/productos', { nombre: prefix, precio: 0.10, descripcion: 'Con guarnición', categoria: 'Principal' });
  assert.equal(result.status, 201);
  const productoId = result.data.id;
  assert.equal(result.data.precio, 0.10);
  assert.equal(result.headers.get('location'), `/productos/${productoId}`);
  assert.ok((await request('GET', '/productos')).data.some((p) => p.id === productoId));
  assert.equal((await request('GET', `/productos/${productoId}`)).data.nombre, prefix);
  assert.equal((await request('PATCH', `/productos/${productoId}`, { precio: 0.20 }, null)).status, 401);
  assert.equal((await request('PATCH', `/productos/${productoId}`, { precio: 0.20 }, readOnly)).status, 403);
  assert.equal((await request('PATCH', '/productos/bad', { precio: 1 })).status, 400);
  assert.equal((await request('PATCH', `/productos/${randomUUID()}`, { precio: 1 })).status, 404);
  for (const body of [null, [], {}, { precio: null }, { precio: '1' }, { precio: -1 }, { precio: 0.001 }, { precio: 1e10 }, { precio: 1, nombre: 'Otro nombre' }]) {
    assert.equal((await request('PATCH', `/productos/${productoId}`, body)).status, 400);
  }
  assert.equal((await request('GET', `/productos/${productoId}`)).data.precio, 0.10);
  const correlationId = randomUUID();
  assert.equal((await request('GET', '/productos', undefined, token(), { 'x-correlation-id': correlationId })).headers.get('x-correlation-id'), correlationId);
  assert.equal((await request('GET', '/productos', undefined, token(), { 'x-correlation-id': 'bad' })).status, 400);

  const pedidoBody = { mesaId: mesa.id, items: [{ productoId, cantidad: 2, precioUnitario: 999 }], total: 999, estado: 'confirmado' };
  result = await request('POST', '/pedidos', pedidoBody);
  assert.equal(result.status, 201);
  const pedidoId = result.data.id;
  assert.equal(result.data.total, 0.20);
  assert.equal(result.data.items[0].precioUnitario, 0.10);
  assert.equal(result.data.estado, 'pendiente');
  assert.equal(result.data.confirmadoEn, null);
  assert.equal((await client.pedido.findUniqueOrThrow({ where: { id: pedidoId } })).total.toFixed(2), '0.20');
  assert.equal((await request('DELETE', `/productos/${productoId}`)).status, 409);

  const antesDelPrecio = (await request('GET', `/productos/${productoId}`)).data;
  result = await request('PATCH', `/productos/${productoId}`, { precio: 0.20 });
  assert.equal(result.status, 200);
  assert.equal(result.data.precio, 0.20);
  assert.deepEqual({ ...result.data, precio: antesDelPrecio.precio }, antesDelPrecio);
  assert.deepEqual((await request('GET', `/productos/${productoId}`)).data, result.data);
  result = await request('PUT', `/productos/${productoId}`, { nombre: prefix, precio: 0.20 });
  assert.equal(result.status, 200);
  assert.deepEqual({ ...result.data, precio: antesDelPrecio.precio }, antesDelPrecio);
  result = await request('PUT', `/pedidos/${pedidoId}`, { mesaId: mesa.id, items: [{ productoId, cantidad: 3 }] });
  assert.equal(result.status, 200);
  assert.equal(result.data.total, 0.30);
  assert.equal(result.data.items[0].precioUnitario, 0.10);
  const segundo = await request('POST', '/productos', { nombre: `${prefix}-2`, precio: 0 });
  assert.equal(segundo.status, 201);
  const segundoId = segundo.data.id;
  await request('PUT', `/productos/${segundoId}`, { nombre: `${prefix}-2`, precio: 0.05 });
  const update = { mesaId: mesa.id, items: [{ productoId, cantidad: 3 }, { productoId: segundoId, cantidad: 2 }] };
  result = await request('PUT', `/pedidos/${pedidoId}`, update);
  assert.equal(result.status, 200);
  assert.equal(result.data.total, 0.40);
  assert.equal(result.data.items.find((i) => i.productoId === segundoId).precioUnitario, 0.05);
  const snapshot = (await request('GET', `/pedidos/${pedidoId}`)).data;
  assert.equal((await request('PUT', `/pedidos/${pedidoId}`, { ...update, mesaId: randomUUID() })).status, 404);
  assert.deepEqual((await request('GET', `/pedidos/${pedidoId}`)).data, snapshot);
  await request('PUT', `/productos/${segundoId}`, { nombre: `${prefix}-2`, precio: 0.05, disponible: false });
  result = await request('PATCH', `/productos/${segundoId}`, { precio: 0 });
  assert.equal(result.status, 200);
  assert.equal(result.data.precio, 0);
  assert.equal(result.data.disponible, false);
  result = await request('PUT', `/productos/${segundoId}`, { nombre: `${prefix}-2`, precio: 0 });
  assert.equal(result.status, 200);
  assert.equal(result.data.disponible, false);
  result = await request('PUT', `/productos/${productoId}`, { nombre: prefix, precio: 0.20, categoria: null, descripcion: null });
  assert.equal(result.status, 200);
  assert.equal(result.data.categoria, null);
  assert.equal(result.data.descripcion, null);
  assert.equal((await request('PUT', `/pedidos/${pedidoId}`, update)).status, 409);
  assert.deepEqual((await request('GET', `/pedidos/${pedidoId}`)).data, snapshot);

  for (const body of [{ mesaId: mesa.id, items: [] }, { ...pedidoBody, items: [{ productoId, cantidad: 0 }] }, { ...pedidoBody, items: [{ productoId, cantidad: 1.5 }] }, { ...pedidoBody, items: [{ productoId, cantidad: 1 }, { productoId: productoId.toUpperCase(), cantidad: 2 }] }]) {
    assert.equal((await request('POST', '/pedidos', body)).status, 400);
  }
  assert.equal((await request('POST', '/pedidos', { ...pedidoBody, mesaId: randomUUID() })).status, 404);
  assert.equal((await request('POST', '/pedidos', { mesaId: mesa.id, items: [{ productoId: randomUUID(), cantidad: 1 }] })).status, 404);
  assert.equal((await request('POST', '/pedidos', { mesaId: mesa.id, items: [{ productoId: segundoId, cantidad: 1 }] })).status, 409);
  assert.equal(await client.pedido.count({ where: { mesaId: mesa.id } }), 1);
  const caro = await request('POST', '/productos', { nombre: `${prefix}-max`, precio: 9999999999.99 });
  assert.equal(caro.status, 201);
  assert.equal((await request('POST', '/pedidos', { mesaId: mesa.id, items: [{ productoId: caro.data.id, cantidad: 2147483647 }] })).status, 400);
  const malformed = await fetch(`${base}/productos`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: '{"secret":' });
  assert.equal(malformed.status, 400);
  assert.ok(!(await malformed.text()).includes('secret'));
  assert.equal((await request('GET', '/pedidos?estado=invalido')).status, 400);
  assert.equal((await request('GET', '/pedidos/bad')).status, 400);
  assert.equal((await request('GET', `/pedidos/${randomUUID()}`)).status, 404);
  assert.ok((await request('GET', '/pedidos?estado=pendiente')).data.some((p) => p.id === pedidoId));
  assert.equal((await request('DELETE', `/pedidos/${pedidoId}`)).status, 204);
  assert.equal((await request('GET', `/pedidos/${pedidoId}`)).status, 404);
  assert.equal(await client.itemPedido.count({ where: { pedidoId } }), 0);

  result = await request('POST', '/pedidos', pedidoBody);
  const cancelarId = result.data.id;
  const cancellations = await Promise.all([request('POST', `/pedidos/${cancelarId}/cancelar`), request('POST', `/pedidos/${cancelarId}/cancelar`)]);
  assert.deepEqual(cancellations.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await request('GET', `/pedidos/${cancelarId}`)).data.estado, 'cancelado');
  assert.equal((await request('PUT', `/pedidos/${cancelarId}`, pedidoBody)).status, 409);
  assert.equal((await request('DELETE', `/pedidos/${cancelarId}`)).status, 409);
  await client.pedido.update({ where: { id: cancelarId }, data: { estado: 'confirmado' } });
  assert.equal((await request('POST', `/pedidos/${cancelarId}/cancelar`)).status, 409);
  assert.equal((await request('PUT', `/pedidos/${cancelarId}`, pedidoBody)).status, 409);
  assert.equal((await request('DELETE', `/pedidos/${cancelarId}`)).status, 409);
  await client.pedido.delete({ where: { id: cancelarId } });
  assert.equal((await request('DELETE', `/productos/${productoId}`)).status, 204);
  assert.equal((await request('GET', `/productos/${productoId}`)).status, 404);
  assert.equal((await request('DELETE', `/productos/${segundoId}`)).status, 204);
  assert.equal((await request('DELETE', `/productos/${segundoId}`)).status, 404);
});
