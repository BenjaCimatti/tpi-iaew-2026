import assert from 'node:assert/strict';
import { generateKeyPairSync, randomInt, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/http/authorization.js';
import { createDatabase } from '../src/repositories/database.js';

test('Cocina HTTP: scopes, transiciones, sincronización del pedido, outbox, entrega y concurrencia', { timeout: 30000 }, async (t) => {
  const logger = { error() {}, warn() {} };
  const database = createDatabase(process.env.DATABASE_URL, logger);
  const client = database.client;
  const mesa = await client.mesa.create({ data: { numero: randomInt(1000000, 2000000000), capacidad: 4 } });
  const producto = await client.producto.create({ data: { nombre: `e207-${randomUUID()}`, precio: '1500.00' } });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'e207-test', alg: 'RS256', use: 'sig' };
  const jwks = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ keys: [key] }));
  }).listen(0, '127.0.0.1');
  await once(jwks, 'listening');
  const issuer = `http://127.0.0.1:${jwks.address().port}/`;
  const audience = 'urn:e207:test';
  let avisos = 0;
  const app = createApp(async () => ({ estado: 'ok' }), logger, {
    client, authorize: createAuthorization({ issuer, jwksUri: `${issuer}jwks`, audience }), onOutbox: () => { avisos++; },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => jwks.close(resolve))]);
    try {
      const pedidos = { pedido: { mesaId: mesa.id } };
      for (let intento = 1; ; intento++) {
        try {
          await client.outbox.deleteMany({ where: pedidos });
          await client.ordenCocina.deleteMany({ where: pedidos });
          await client.pedido.deleteMany({ where: { mesaId: mesa.id } });
          break;
        } catch (error) {
          if (intento === 5) throw error;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      await client.producto.delete({ where: { id: producto.id } });
      await client.mesa.delete({ where: { id: mesa.id } });
    } finally {
      await database.close();
    }
  });

  function token(scope) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const parts = `${encode({ alg: 'RS256', kid: key.kid, typ: 'JWT' })}.${encode({ iss: issuer, aud: audience, sub: 'test', iat: now, exp: now + 600, scope })}`;
    return `${parts}.${sign('RSA-SHA256', Buffer.from(parts), privateKey).toString('base64url')}`;
  }
  const cocinero = token('read:cocina write:cocina');
  const lector = token('read:cocina');
  const mozo = token('read:pedidos write:pedidos confirm:pedidos');
  async function request(method, path, bearer, body, headers = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status >= 400) assert.equal(data.correlationId, response.headers.get('x-correlation-id'));
    return { status: response.status, data };
  }
  // Pedido confirmado con su orden "recibida", como la dejaría el worker.
  async function ordenRecibida() {
    const pedido = await client.pedido.create({
      data: { mesaId: mesa.id, estado: 'confirmado', total: '3000.00', confirmadoEn: new Date(), items: { create: { productoId: producto.id, cantidad: 2, precioUnitario: '1500.00' } } },
    });
    return client.ordenCocina.create({ data: { pedidoId: pedido.id } });
  }
  const patch = (id, estado, bearer = cocinero, headers) => request('PATCH', `/cocina/ordenes/${id}`, bearer, { estado }, headers);
  const pedidoDe = (orden) => client.pedido.findUniqueOrThrow({ where: { id: orden.pedidoId } });
  const eventos = (orden) => client.outbox.findMany({ where: { pedidoId: orden.pedidoId }, orderBy: { occurredAt: 'asc' } });

  const orden = await ordenRecibida();

  // Consultas con read:cocina; sin token 401; con scopes de pedidos 403.
  assert.equal((await request('GET', '/cocina/ordenes', null)).status, 401);
  assert.equal((await request('GET', '/cocina/ordenes', mozo)).status, 403);
  let result = await request('GET', '/cocina/ordenes?estado=recibida', lector);
  assert.equal(result.status, 200);
  const listada = result.data.find((o) => o.id === orden.id);
  assert.deepEqual(listada, {
    id: orden.id, pedidoId: orden.pedidoId, estado: 'recibida', pedidoEstado: 'confirmado', mesa: mesa.numero,
    items: [{ productoId: producto.id, nombre: producto.nombre, cantidad: 2 }],
    creadoEn: orden.creadoEn.toISOString(), actualizadoEn: orden.actualizadoEn.toISOString(),
  });
  assert.equal((await request('GET', '/cocina/ordenes?estado=otro', lector)).status, 400);
  assert.deepEqual((await request('GET', `/cocina/ordenes/${orden.id}`, lector)).data, listada);
  assert.equal((await request('GET', '/cocina/ordenes/bad', lector)).status, 400);
  assert.equal((await request('GET', `/cocina/ordenes/${randomUUID()}`, lector)).status, 404);

  // Cambios solo con write:cocina: write:pedidos o read:cocina no alcanzan.
  assert.equal((await patch(orden.id, 'en_preparacion', mozo)).status, 403);
  assert.equal((await patch(orden.id, 'en_preparacion', lector)).status, 403);
  assert.equal((await patch(orden.id, 'cocinando')).status, 400);
  assert.equal((await request('PATCH', `/cocina/ordenes/${orden.id}`, cocinero, [])).status, 400);
  assert.equal((await patch(randomUUID(), 'en_preparacion')).status, 404);
  result = await patch(orden.id, 'lista');
  assert.equal(result.status, 409);
  assert.equal(result.data.codigo, 'TRANSICION_INVALIDA');
  assert.equal((await eventos(orden)).length, 0);
  assert.equal(avisos, 0);

  // recibida → en_preparacion: el pedido pasa a en_preparacion y se registra el evento.
  const correlationId = randomUUID();
  result = await patch(orden.id, 'en_preparacion', cocinero, { 'x-correlation-id': correlationId });
  assert.equal(result.status, 200);
  assert.equal(result.data.estado, 'en_preparacion');
  assert.equal(result.data.pedidoEstado, 'en_preparacion');
  assert.equal((await pedidoDe(orden)).estado, 'en_preparacion');
  assert.equal(avisos, 1);
  let [evento] = await eventos(orden);
  assert.equal(evento.eventType, 'orden.actualizada');
  assert.equal(evento.correlationId, correlationId);
  assert.deepEqual(evento.payload, {
    eventId: evento.id, eventType: 'orden.actualizada', version: 1, occurredAt: evento.occurredAt.toISOString(),
    correlationId, pedidoId: orden.pedidoId, data: { orden: result.data },
  });

  // Mientras el pedido está en preparación, el mozo no puede cancelarlo, editarlo ni entregarlo.
  assert.equal((await request('POST', `/pedidos/${orden.pedidoId}/cancelar`, mozo)).status, 409);
  assert.equal((await request('POST', `/pedidos/${orden.pedidoId}/entregar`, mozo)).status, 409);
  assert.equal((await patch(orden.id, 'recibida')).status, 409, 'sin retrocesos');

  // en_preparacion → lista: el pedido queda listo.
  result = await patch(orden.id, 'lista');
  assert.equal(result.status, 200);
  assert.equal(result.data.pedidoEstado, 'listo');
  assert.equal((await patch(orden.id, 'lista')).status, 409);

  // Entrega: write:pedidos, solo desde listo; el evento informa pedidoEstado entregado.
  assert.equal((await request('POST', `/pedidos/${orden.pedidoId}/entregar`, cocinero)).status, 403);
  assert.equal((await request('POST', `/pedidos/${randomUUID()}/entregar`, mozo)).status, 404);
  result = await request('POST', `/pedidos/${orden.pedidoId}/entregar`, mozo);
  assert.equal(result.status, 200);
  assert.equal(result.data.estado, 'entregado');
  assert.equal((await request('POST', `/pedidos/${orden.pedidoId}/entregar`, mozo)).status, 409);
  const todos = await eventos(orden);
  assert.deepEqual(todos.map((e) => e.payload.data.orden.pedidoEstado), ['en_preparacion', 'listo', 'entregado']);
  assert.equal(avisos, 3);
  // Una orden de un pedido entregado deja de figurar entre las activas del tablero, pero sigue consultable.
  assert.equal((await request('GET', `/cocina/ordenes/${orden.id}`, lector)).data.pedidoEstado, 'entregado');

  // Dos cocineros avanzan la misma orden a la vez: un 200, un 409 y un solo evento.
  const otra = await ordenRecibida();
  const simultaneos = await Promise.all([patch(otra.id, 'en_preparacion'), patch(otra.id, 'en_preparacion')]);
  assert.deepEqual(simultaneos.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await eventos(otra)).length, 1);

  // Un pedido pendiente no se entrega.
  const pendiente = await client.pedido.create({ data: { mesaId: mesa.id, items: { create: { productoId: producto.id, cantidad: 1, precioUnitario: '1500.00' } } } });
  assert.equal((await request('POST', `/pedidos/${pendiente.id}/entregar`, mozo)).status, 409);
});
