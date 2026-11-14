import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createBroker } from './messaging/broker.js';
import { declareTopology } from './messaging/topology.js';
import { createOutboxPublisher } from './services/outbox.js';
import { createCocinaService, ordenJSON } from './services/cocina.js';
import { createPedidoConfirmadoConsumer } from './messaging/consumer.js';
import { createTableroSubscriber } from './messaging/tablero.js';
import { createCocinaGateway } from './realtime/gateway.js';
import { createTokenVerifier } from './http/jwt.js';
import { createDatabase } from './repositories/database.js';
import { createHealthService } from './services/health.js';
import { createAuthorization } from './http/authorization.js';

export async function start(service) {
  const config = loadConfig(service);
  const logger = pino({ level: config.logLevel, base: { servicio: service } });
  const database = createDatabase(config.databaseUrl, logger);
  // Worker = consumidor de cocina + gateway WebSocket en un mismo proceso.
  // orden.creada se emite en memoria tras persistir la orden; orden.actualizada
  // llega desde la API por RabbitMQ. Ambos consumidores se registran en cada
  // (re)conexión; la API solo declara la topología.
  let gateway;
  const difundir = (type, orden, evento) => gateway?.broadcast(type, { orden, eventId: evento.eventId, correlationId: evento.correlationId }) ?? 0;
  const cocina = service === 'worker' ? createCocinaService(database.client) : undefined;
  const suscriptores = service === 'worker' ? [
    createPedidoConfirmadoConsumer(cocina, logger, {
      onOrdenCreada(orden, evento) {
        const clientes = difundir('orden.creada', ordenJSON(orden), evento);
        logger.info({ operacion: 'ws.difundir', resultado: 'enviado', eventType: 'orden.creada', eventId: evento.eventId, pedidoId: evento.pedidoId, correlationId: evento.correlationId, clientes },
          'Orden creada difundida al tablero');
      },
    }),
    createTableroSubscriber((evento) => difundir('orden.actualizada', evento.data.orden, evento), logger),
  ] : [];
  const broker = createBroker(config.rabbitmqUrl, service, logger, {
    setup: async (channel) => {
      await declareTopology(channel);
      for (const suscriptor of suscriptores) await suscriptor.register(channel);
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
      onOutbox: () => outbox.notify(),
    } : { tablero: true });
  const server = app.listen(config.port, '0.0.0.0');
  if (service === 'worker') {
    gateway = createCocinaGateway({ server, verifyToken: createTokenVerifier(config.jwt), loadSnapshot: () => cocina.snapshot(), logger });
  }
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
      await gateway?.close();
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
