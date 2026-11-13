import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

const env = {
  DATABASE_URL: 'postgresql://user:secret@db:5432/restaurante',
  RABBITMQ_URL: 'amqp://user:secret@broker:5672',
};

test('configuración: Auth0 pendiente y opciones JWT sin exponer secretos', () => {
  assert.equal(loadConfig('api', { ...env, AUTH0_DOMAIN: 'TU_DOMINIO.auth0.com', AUTH0_AUDIENCE: 'urn:test' }).jwt, undefined);
  assert.deepEqual(loadConfig('api', { ...env, AUTH0_DOMAIN: 'restaurante.example.auth0.com', AUTH0_AUDIENCE: 'urn:test' }).jwt, {
    issuer: 'https://restaurante.example.auth0.com/',
    jwksUri: 'https://restaurante.example.auth0.com/.well-known/jwks.json',
    audience: 'urn:test',
  });
  assert.throws(() => loadConfig('api', { ...env, AUTH0_DOMAIN: 'https://secret@example.com/', AUTH0_AUDIENCE: 'urn:test' }), (error) => !error.message.includes('secret'));
});

test('configuración: puertos por servicio y valores explícitos', () => {
  assert.equal(loadConfig('api', env).port, 3000);
  assert.equal(loadConfig('worker', env).port, 3001);
  assert.equal(loadConfig('worker', { ...env, WORKER_PORT: '4001' }).port, 4001);
  assert.equal(loadConfig('api', { ...env, API_KEY: 'reemplazar_con_una_clave' }).apiKey, undefined);
  assert.equal(loadConfig('api', { ...env, API_KEY: 'private-test-key' }).apiKey, 'private-test-key');
});

test('configuración: rechaza URLs, puertos y nivel de log inválidos sin revelar secretos', () => {
  for (const invalid of [
    { DATABASE_URL: undefined },
    { DATABASE_URL: 'https://user:secret@db' },
    { RABBITMQ_URL: 'http://user:secret@broker' },
    { PORT: '' },
    { PORT: '3000.5' },
    { PORT: '65536' },
    { LOG_LEVEL: 'secret' },
  ]) {
    assert.throws(() => loadConfig('api', { ...env, ...invalid }), (error) => {
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});
