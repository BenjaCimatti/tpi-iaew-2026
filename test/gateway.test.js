import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import WebSocket from 'ws';
import { createTokenVerifier, TokenError } from '../src/http/jwt.js';
import { CIERRE, createCocinaGateway, WS_PATH } from '../src/realtime/gateway.js';

const logger = { info() {}, warn() {}, error() {} };

async function iniciar(t, opciones = {}) {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const tokens = {
    lector: { sub: 'lector', scopes: new Set(['read:cocina']), expiresAt: Date.now() + 60000 },
    corto: { sub: 'corto', scopes: new Set(['read:cocina']), expiresAt: Date.now() + 300 },
    pedidos: { sub: 'pedidos', scopes: new Set(['read:pedidos', 'write:cocina']), expiresAt: Date.now() + 60000 },
  };
  const gateway = createCocinaGateway({
    server, logger, authTimeoutMs: 200,
    verifyToken: async (token) => {
      if (!tokens[token]) throw new TokenError('NO_AUTORIZADO', 'Access token inválido');
      return tokens[token];
    },
    loadSnapshot: opciones.loadSnapshot ?? (async () => [{ id: 'o1', estado: 'recibida' }]),
  });
  t.after(async () => {
    await gateway.close();
    await new Promise((resolve) => server.close(resolve));
  });
  return { gateway, url: `ws://127.0.0.1:${server.address().port}${WS_PATH}` };
}

// Cliente que acumula mensajes y permite esperar el siguiente o el cierre.
async function cliente(url) {
  const ws = new WebSocket(url);
  const mensajes = [];
  const esperas = [];
  ws.on('message', (data) => {
    mensajes.push(JSON.parse(data));
    esperas.splice(0).forEach((resolve) => resolve());
  });
  const cerrado = once(ws, 'close').then(([code, reason]) => ({ code, reason: reason.toString() }));
  await once(ws, 'open');
  return {
    ws, mensajes, cerrado,
    send: (mensaje) => ws.send(typeof mensaje === 'string' ? mensaje : JSON.stringify(mensaje)),
    async siguiente(type) {
      for (;;) {
        const encontrado = mensajes.find((m) => m.type === type);
        if (encontrado) return encontrado;
        await new Promise((resolve) => esperas.push(resolve));
      }
    },
  };
}

test('WebSocket: autenticación por mensaje, scope read:cocina, snapshot y difusión solo a autenticados', async (t) => {
  const { gateway, url } = await iniciar(t);
  const autorizado = await cliente(url);
  const pendiente = await cliente(url);
  autorizado.send({ type: 'auth', token: 'lector' });
  assert.ok(Date.parse((await autorizado.siguiente('auth.ok')).expiresAt) > Date.now());
  assert.deepEqual((await autorizado.siguiente('snapshot')).ordenes, [{ id: 'o1', estado: 'recibida' }]);
  assert.equal(gateway.clientes, 1);

  assert.equal(gateway.broadcast('orden.creada', { orden: { id: 'o2' }, correlationId: 'c1' }), 1);
  const creada = await autorizado.siguiente('orden.creada');
  assert.deepEqual(creada, { type: 'orden.creada', orden: { id: 'o2' }, correlationId: 'c1' });
  assert.equal(pendiente.mensajes.length, 0, 'sin autenticar no recibe eventos');

  autorizado.send({ type: 'ping' });
  await autorizado.siguiente('pong');
  // Renovar el token no vuelve a enviar el snapshot.
  autorizado.send({ type: 'auth', token: 'lector' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(autorizado.mensajes.filter((m) => m.type === 'snapshot').length, 1);
  assert.equal(autorizado.mensajes.filter((m) => m.type === 'auth.ok').length, 2);

  // Sin mensaje de autenticación a tiempo: 4408.
  assert.equal((await pendiente.cerrado).code, CIERRE.TIMEOUT_AUTENTICACION);
});

test('WebSocket: rechaza token inválido (4401), scope insuficiente (4403) y mensajes no soportados (4400)', async (t) => {
  const { gateway, url } = await iniciar(t);
  const invalido = await cliente(url);
  invalido.send({ type: 'auth', token: 'alterado' });
  assert.deepEqual(await invalido.cerrado, { code: CIERRE.NO_AUTORIZADO, reason: 'NO_AUTORIZADO' });
  assert.equal(invalido.mensajes[0].codigo, 'NO_AUTORIZADO');

  const sinScope = await cliente(url);
  sinScope.send({ type: 'auth', token: 'pedidos' });
  assert.equal((await sinScope.cerrado).code, CIERRE.SIN_PERMISO);

  const basura = await cliente(url);
  basura.send('{no json');
  assert.equal((await basura.cerrado).code, CIERRE.ENTRADA_INVALIDA);

  const pingSinAuth = await cliente(url);
  pingSinAuth.send({ type: 'ping' });
  assert.equal((await pingSinAuth.cerrado).code, CIERRE.ENTRADA_INVALIDA);
  assert.equal(gateway.clientes, 0);
});

test('WebSocket: cierra la conexión al vencer el token y si falla el snapshot', async (t) => {
  const { url } = await iniciar(t);
  const corto = await cliente(url);
  corto.send({ type: 'auth', token: 'corto' });
  await corto.siguiente('auth.ok');
  assert.deepEqual(await corto.cerrado, { code: CIERRE.NO_AUTORIZADO, reason: 'TOKEN_EXPIRADO' });

  const conFallo = await iniciar(t, { loadSnapshot: async () => { throw new Error('db caída'); } });
  const c = await cliente(conFallo.url);
  c.send({ type: 'auth', token: 'lector' });
  assert.equal((await c.cerrado).code, 1011);
  assert.equal(c.mensajes.at(-1).codigo, 'SNAPSHOT_NO_DISPONIBLE');
});

test('JWT del stream: firma RS256 con JWKS, issuer, audience, expiración y scopes', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'ws-test', alg: 'RS256', use: 'sig' };
  const jwks = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ keys: [key] }));
  }).listen(0, '127.0.0.1');
  await once(jwks, 'listening');
  t.after(() => new Promise((resolve) => jwks.close(resolve)));
  const issuer = `http://127.0.0.1:${jwks.address().port}/`;
  const audience = 'urn:ws:test';
  const verify = createTokenVerifier({ issuer, audience, jwksUri: `${issuer}jwks` });
  const now = Math.floor(Date.now() / 1000);
  function token(claims = {}) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const parts = `${encode({ alg: 'RS256', kid: key.kid, typ: 'JWT' })}.${encode({ iss: issuer, aud: audience, sub: 'm2m', iat: now, exp: now + 600, scope: 'read:cocina write:cocina', ...claims })}`;
    return `${parts}.${sign('RSA-SHA256', Buffer.from(parts), privateKey).toString('base64url')}`;
  }
  const identidad = await verify(token());
  assert.deepEqual([...identidad.scopes].sort(), ['read:cocina', 'write:cocina']);
  assert.equal(identidad.expiresAt, (now + 600) * 1000);
  assert.ok((await verify(token({ scope: undefined, permissions: ['read:cocina'] }))).scopes.has('read:cocina'));

  const codigo = (codigoEsperado) => (error) => error instanceof TokenError && error.codigo === codigoEsperado;
  await assert.rejects(verify(token({ exp: now - 10 })), codigo('TOKEN_EXPIRADO'));
  await assert.rejects(verify(token({ aud: 'otra' })), codigo('NO_AUTORIZADO'));
  await assert.rejects(verify(token({ iss: 'https://otro/' })), codigo('NO_AUTORIZADO'));
  await assert.rejects(verify(`${token().slice(0, -4)}AAAA`), codigo('NO_AUTORIZADO'));
  await assert.rejects(verify(undefined), codigo('NO_AUTORIZADO'));
  await assert.rejects(createTokenVerifier(undefined)('x'), codigo('AUTH_NO_CONFIGURADA'));
});
