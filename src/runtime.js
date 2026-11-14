import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createBroker } from './messaging/broker.js';
import { declareTopology } from './messaging/topology.js';
import { createOutboxPublisher } from './services/outbox.js';
import { createCocinaService } from './services/cocina.js';
import { createPedidoConfirmadoConsumer } from './messaging/consumer.js';
import { createDatabase } from './repositories/database.js';
import { createHealthService } from './services/health.js';
import { createAuthorization } from './http/authorization.js';

export async function start(service) {
  const config = loadConfig(service);
  const logger = pino({ level: config.logLevel, base: { servicio: service } });
  const database = createDatabase(config.databaseUrl, logger);
  // El worker registra su consumidor en cada (re)conexión; la API solo declara la topología.
  const consumer = service === 'worker' ? createPedidoConfirmadoConsumer(createCocinaService(database.client), logger) : undefined;
  const broker = createBroker(config.rabbitmqUrl, service, logger, {
    setup: async (channel) => {
      await declareTopology(channel);
      await consumer?.register(channel);
    },
  });
  const outbox = service === 'api' ? createOutboxPublisher(database.client, broker, logger) : undefined;
  const abort = new AbortController();

  const databaseStartup = (async () => {
    while (!abort.signal.aborted) {
      try {
        await database.ping();
        logger.info('Conectado a PostgreSQL');
        return;
      } catch (error) {
        if (!abort.signal.aborted) {
          logger.warn({ code: error.code }, 'PostgreSQL no disponible; se reintentará');
        }
      }
      await delay(2000, undefined, { signal: abort.signal }).catch(() => {});
    }
  })();

  const app = createApp(createHealthService(database, broker, service), logger,
    service === 'api' ? {
      client: database.client, authorize: createAuthorization(config.jwt), apiKey: config.apiKey,
      onPedidoConfirmado: () => outbox.notify(),
    } : {});
  const server = app.listen(config.port, '0.0.0.0');
  outbox?.start();
  let stopping = false;

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Cerrando servicio');
    const deadline = setTimeout(() => {
      logger.error('Se agotó el tiempo de cierre');
      process.exit(1);
    }, 10000).unref();
    abort.abort();
    try {
      await new Promise((resolve) => server.close(resolve));
      await outbox?.stop();
      await Promise.all([broker.close(), databaseStartup]);
      await database.close();
      logger.info('Servicio cerrado');
    } catch (error) {
      logger.error({ code: error.code }, 'Error durante el cierre');
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  try {
    await once(server, 'listening');
    logger.info({ port: config.port }, 'Servidor HTTP iniciado');
  } catch (error) {
    await shutdown('error');
    throw error;
  }
}
