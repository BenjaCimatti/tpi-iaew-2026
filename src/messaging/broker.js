import amqp from 'amqplib';
import { setTimeout as delay } from 'node:timers/promises';

const CONFIRM_TIMEOUT_MS = 5000;

// Mantiene una conexión AMQP con canal de confirmación (publisher confirms) y la
// reconstruye ante caídas. `setup(channel)` se ejecuta en cada (re)conexión,
// antes de marcar el broker como listo: declara la topología y registra
// consumidores, que RabbitMQ descarta al cerrarse el canal.
export function createBroker(url, service, logger, { setup } = {}) {
  const abort = new AbortController();
  let connection;
  let channel;
  let ready = false;

  async function reconnect() {
    while (!abort.signal.aborted) {
      try {
        connection = await amqp.connect(url, {
          timeout: 5000,
          clientProperties: { connection_name: service },
        });
        connection.on('error', (error) => {
          logger.warn({ code: error.code }, 'Error de conexión a RabbitMQ');
        });
        const closed = new Promise((resolve) => {
          connection.once('close', () => {
            ready = false;
            resolve();
          });
        });
        if (abort.signal.aborted) break;
        channel = await connection.createConfirmChannel();
        channel.on('error', (error) => {
          logger.warn({ code: error.code }, 'Error de canal RabbitMQ');
        });
        channel.once('close', () => {
          ready = false;
          connection.close().catch(() => {});
        });
        await setup?.(channel);
        ready = true;
        logger.info('Conectado a RabbitMQ; canal abierto');
        await closed;
      } catch (error) {
        if (!abort.signal.aborted) {
          logger.warn({ code: error.code }, 'RabbitMQ no disponible; se reintentará');
        }
      } finally {
        ready = false;
        await channel?.close().catch(() => {});
        await connection?.close().catch(() => {});
        channel = undefined;
        connection = undefined;
      }
      await delay(2000, undefined, { signal: abort.signal }).catch(() => {});
    }
  }

  const task = reconnect();
  return {
    get ready() { return ready; },
    // Resuelve únicamente cuando RabbitMQ confirma (ack) el mensaje persistente.
    publish(exchange, routingKey, content, options = {}) {
      if (!ready || !channel) return Promise.reject(new Error('RabbitMQ no disponible'));
      const current = channel;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('RabbitMQ no confirmó la publicación')), CONFIRM_TIMEOUT_MS);
        const done = (error) => {
          clearTimeout(timer);
          if (error) reject(error instanceof Error ? error : new Error('RabbitMQ rechazó la publicación'));
          else resolve();
        };
        try {
          current.publish(exchange, routingKey, content, { persistent: true, contentType: 'application/json', ...options }, done);
        } catch (error) {
          done(error);
        }
      });
    },
    async close() {
      abort.abort();
      await channel?.close().catch(() => {});
      await connection?.close().catch(() => {});
      await task;
    },
  };
}
