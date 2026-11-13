export function loadConfig(service, env = process.env) {
  for (const [name, protocols] of [
    ['DATABASE_URL', ['postgres:', 'postgresql:']],
    ['RABBITMQ_URL', ['amqp:', 'amqps:']],
  ]) {
    let url;
    try {
      url = new URL(env[name]);
    } catch {
      throw new Error(`${name} debe ser una URL válida`);
    }
    if (!protocols.includes(url.protocol) || !url.hostname) {
      throw new Error(`${name} tiene un protocolo o host inválido`);
    }
  }

  const portName = service === 'api' ? 'PORT' : 'WORKER_PORT';
  const port = Number(env[portName] ?? (service === 'api' ? 3000 : 3001));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${portName} debe ser un entero entre 1 y 65535`);
  }
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(logLevel)) {
    throw new Error('LOG_LEVEL inválido');
  }
  let jwt;
  if (env.AUTH0_DOMAIN && !env.AUTH0_DOMAIN.includes('TU_DOMINIO') && env.AUTH0_AUDIENCE) {
    if (!/^[a-z0-9.-]+$/i.test(env.AUTH0_DOMAIN)) throw new Error('AUTH0_DOMAIN debe contener solo el dominio, sin https:// ni ruta');
    jwt = { issuer: `https://${env.AUTH0_DOMAIN}/`, jwksUri: `https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`, audience: env.AUTH0_AUDIENCE };
  }
  const apiKey = env.API_KEY && !env.API_KEY.startsWith('reemplazar_') ? env.API_KEY : undefined;
  return { port, logLevel, databaseUrl: env.DATABASE_URL, rabbitmqUrl: env.RABBITMQ_URL, jwt, apiKey };
}
