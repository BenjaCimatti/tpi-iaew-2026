import assert from 'node:assert/strict';
import test from 'node:test';

test('Auth0 real: client_credentials, JWT, scopes y separación de API key', { timeout: 45000 }, async (t) => {
  const { AUTH0_DOMAIN: domain, AUTH0_AUDIENCE: audience, AUTH0_CLIENT_ID: clientId, AUTH0_CLIENT_SECRET: clientSecret, API_KEY: apiKey } = process.env;
  assert.ok(domain && audience && clientId && clientSecret && apiKey, 'Completar Auth0 y API_KEY en .env');
  assert.ok(/^[a-z0-9.-]+$/i.test(domain), 'AUTH0_DOMAIN debe contener solo el dominio');
  const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
  async function token(scope, id = clientId, secret = clientSecret) {
    const response = await fetch(`https://${domain}/oauth/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: id, client_secret: secret, audience, scope }),
    });
    assert.equal(response.status, 200, 'Auth0 debe emitir token; revisar credenciales, audience y autorización M2M');
    const body = await response.json();
    assert.ok(body.token_type === 'Bearer' && typeof body.access_token === 'string', 'Respuesta OAuth inválida');
    return body.access_token;
  }
  async function request(path, expected, headers = {}, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, {
      method, signal: AbortSignal.timeout(15000), headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, expected, `${method} ${path}`);
    await response.arrayBuffer();
  }

  const scopes = ['read:pedidos', 'write:pedidos', 'confirm:pedidos', 'admin:productos', 'read:cocina', 'write:cocina'];
  const full = await token(scopes.join(' '));
  let claims;
  try { claims = JSON.parse(Buffer.from(full.split('.')[1], 'base64url').toString()); }
  catch { throw new Error('Auth0 no emitió un JWT legible'); }
  assert.ok(scopes.every(scope => claims.scope?.split(' ').includes(scope)), 'Faltan scopes autorizados en el cliente M2M');
  assert.ok(claims.exp > Date.now() / 1000, 'Token emitido vencido');
  await request('/productos', 200, { Authorization: `Bearer ${full}` });
  await request('/pedidos', 200, { Authorization: `Bearer ${full}` });
  await request('/productos', 401);
  const parts = full.split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
  await request('/productos', 401, { Authorization: `Bearer ${parts.join('.')}` });

  await request('/health-protegido', 200, { 'x-api-key': apiKey });
  await request('/health-protegido', 401);
  await request('/health-protegido', 401, { 'x-api-key': `${apiKey}-incorrecta` });
  await request('/health-protegido', 401, { Authorization: `Bearer ${full}` });
  await request('/productos', 401, { 'x-api-key': apiKey });

  const { AUTH0_READONLY_CLIENT_ID: readId, AUTH0_READONLY_CLIENT_SECRET: readSecret } = process.env;
  await t.test('Solo lectura real: consulta 200 y escritura 403', {
    skip: !readId || !readSecret ? 'Completar AUTH0_READONLY_CLIENT_ID y AUTH0_READONLY_CLIENT_SECRET' : false,
  }, async () => {
    const readOnly = await token('read:pedidos', readId, readSecret);
    let readClaims;
    try { readClaims = JSON.parse(Buffer.from(readOnly.split('.')[1], 'base64url').toString()); }
    catch { throw new Error('Auth0 no emitió un JWT legible para solo lectura'); }
    assert.equal(readClaims.scope, 'read:pedidos', 'El cliente de prueba debe tener solo read:pedidos');
    await request('/productos', 200, { Authorization: `Bearer ${readOnly}` });
    await request('/productos', 403, { Authorization: `Bearer ${readOnly}`, 'Content-Type': 'application/json' }, 'POST', {});
  });
});
