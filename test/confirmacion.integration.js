import assert from 'node:assert/strict';
import { generateKeyPairSync, randomInt, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createAuthorization } from '../src/http/authorization.js';
import { createDatabase } from '../src/repositories/database.js';

test('Confirmación: atomicidad, outbox, precios capturados, rechazos y concurrencia', { timeout: 30000 }, async (t) => {
  const logger = { error() {}, warn() {} };
  const database = createDatabase(process.env.DATABASE_URL, logger);
  const client = database.client;
  const prefix = `e205-${randomUUID()}`;
  const mesa = await client.mesa.create({ data: { numero: randomInt(1000000, 2000000000), capacidad: 4 } });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'e205-test', alg: 'RS256', use: 'sig' };
  const jwks = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ keys: [key] }));
  }).listen(0, '127.0.0.1');
  await once(jwks, 'listening');
  const issuer = `http://127.0.0.1:${jwks.address().port}/`;
  const audience = 'urn:e205:test';
  let notificaciones = 0;
  const app = createApp(async () => ({ estado: 'ok' }), logger, {
    client, authorize: createAuthorization({ issuer, jwksUri: `${issuer}jwks`, audience }),
    onPedidoConfirmado: () => { notificaciones++; },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => jwks.close(resolve))]);
    try {
      // Si el stack está levantado, su API/worker pueden publicar y consumir estos
      // eventos durante la limpieza: se reintenta hasta que no queden referencias.
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
      await client.producto.deleteMany({ where: { nombre: { startsWith: prefix } } });
      await client.mesa.delete({ where: { id: mesa.id } });
    } finally {
      await database.close();
    }
  });

  function token(scope = 'read:pedidos write:pedidos admin:productos confirm:pedidos') {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const parts = `${encode({ alg: 'RS256', kid: key.kid, typ: 'JWT' })}.${encode({ iss: issuer, aud: audience, sub: 'test', iat: now, exp: now + 600, scope })}`;
    return `${parts}.${sign('RSA-SHA256', Buffer.from(parts), privateKey).toString('base64url')}`;
  }
  async function request(method, path, body, { bearer = token(), headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? null : await response.json();
    if (response.status >= 400) assert.equal(data.correlationId, response.headers.get('x-correlation-id'));
    return { status: response.status, data };
  }
  const producto = async (precio, disponible = true) => (await request('POST', '/productos', { nombre: `${prefix}-${randomUUID()}`, precio, disponible })).data;
  const pedido = async (items) => (await request('POST', '/pedidos', { mesaId: mesa.id, items })).data;
  const confirmar = (id, options) => request('POST', `/pedidos/${id}/confirmar`, undefined, options);
  const eventos = (pedidoId) => client.outbox.findMany({ where: { pedidoId } });
  const snapshot = (id) => client.pedido.findUniqueOrThrow({ where: { id }, include: { items: true, ordenCocina: true } });

  const milanesa = await producto(8500.50);
  const flan = await producto(2500);
  const p1 = await pedido([{ productoId: milanesa.id, cantidad: 2 }, { productoId: flan.id, cantidad: 3 }]);

  // Un cambio de precio posterior a la creación no altera el total confirmado.
  assert.equal((await request('PATCH', `/productos/${milanesa.id}`, { precio: 99999 })).status, 200);

  // Permisos: sin token 401; con write:pedidos pero sin confirm:pedidos 403.
  assert.equal((await confirmar(p1.id, { bearer: null })).status, 401);
  assert.equal((await confirmar(p1.id, { bearer: token('read:pedidos write:pedidos') })).status, 403);
  assert.equal((await confirmar('bad')).status, 400);
  assert.equal((await confirmar(randomUUID())).status, 404);
  assert.equal((await eventos(p1.id)).length, 0);

  const correlationId = randomUUID();
  let result = await confirmar(p1.id, { headers: { 'x-correlation-id': correlationId } });
  assert.equal(result.status, 200);
  assert.equal(result.data.estado, 'confirmado');
  assert.equal(result.data.total, 24501);
  assert.ok(!Number.isNaN(Date.parse(result.data.confirmadoEn)));
  assert.equal(notificaciones, 1);
  const guardado = await snapshot(p1.id);
  assert.equal(guardado.total.toFixed(2), '24501.00');
  assert.equal(guardado.ordenCocina, null, 'la orden de cocina la crea el worker, no la API');
  const [evento] = await eventos(p1.id);
  assert.equal(evento.eventType, 'pedido.confirmado');
  assert.equal(evento.correlationId, correlationId);
  assert.equal(evento.publicadoEn, null);
  assert.equal(evento.occurredAt.getTime(), guardado.confirmadoEn.getTime());
  assert.deepEqual(evento.payload, {
    eventId: evento.id, eventType: 'pedido.confirmado', version: 1, occurredAt: guardado.confirmadoEn.toISOString(), correlationId,
    pedidoId: p1.id,
    data: {
      mesaId: mesa.id, total: '24501.00',
      items: [
        { productoId: milanesa.id, nombre: milanesa.nombre, cantidad: 2, precioUnitario: '8500.50' },
        { productoId: flan.id, nombre: flan.nombre, cantidad: 3, precioUnitario: '2500.00' },
      ].sort((a, b) => a.productoId.localeCompare(b.productoId)),
    },
  });

  // Reconfirmar y operar sobre un pedido confirmado devuelve 409 sin generar otro evento.
  assert.equal((await confirmar(p1.id)).status, 409);
  assert.equal((await request('POST', `/pedidos/${p1.id}/cancelar`)).status, 409);
  assert.equal((await request('DELETE', `/pedidos/${p1.id}`)).status, 409);
  assert.equal((await eventos(p1.id)).length, 1);
  assert.equal(notificaciones, 1);

  // Rechazos de negocio sin cambios parciales.
  async function rechazo(id, codigo) {
    const antes = await snapshot(id);
    result = await confirmar(id);
    assert.equal(result.status, 409);
    assert.equal(result.data.codigo, codigo);
    assert.deepEqual(await snapshot(id), antes);
    assert.equal((await eventos(id)).length, 0);
  }
  const p2 = await pedido([{ productoId: flan.id, cantidad: 1 }]);
  await request('PUT', `/productos/${flan.id}`, { nombre: flan.nombre, precio: 2500, disponible: false });
  await rechazo(p2.id, 'PRODUCTO_NO_DISPONIBLE');
  await request('PUT', `/productos/${flan.id}`, { nombre: flan.nombre, precio: 2500, disponible: true });

  const p3 = await pedido([{ productoId: flan.id, cantidad: 1 }]);
  await client.itemPedido.deleteMany({ where: { pedidoId: p3.id } });
  await rechazo(p3.id, 'PEDIDO_SIN_ITEMS');

  await request('POST', `/pedidos/${p2.id}/cancelar`);
  await rechazo(p2.id, 'ESTADO_INCOMPATIBLE');

  // Dos confirmaciones simultáneas: un solo efecto y un solo evento.
  const p4 = await pedido([{ productoId: flan.id, cantidad: 2 }]);
  const simultaneas = await Promise.all([confirmar(p4.id), confirmar(p4.id), confirmar(p4.id)]);
  assert.deepEqual(simultaneas.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal((await eventos(p4.id)).length, 1);

  // Confirmación y cancelación simultáneas: gana exactamente una.
  for (let i = 0; i < 5; i++) {
    const p = await pedido([{ productoId: flan.id, cantidad: 1 }]);
    const [c, x] = await Promise.all([confirmar(p.id), request('POST', `/pedidos/${p.id}/cancelar`)]);
    assert.deepEqual([c.status, x.status].sort(), [200, 409]);
    const final = await snapshot(p.id);
    assert.equal(final.estado, c.status === 200 ? 'confirmado' : 'cancelado');
    assert.equal((await eventos(p.id)).length, c.status === 200 ? 1 : 0);
  }
});
