import amqp from 'amqplib';
import { setTimeout as delay } from 'node:timers/promises';

export function createBroker(url, service, logger) {
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
        channel = await connection.createChannel();
        channel.on('error', (error) => {
          logger.warn({ code: error.code }, 'Error de canal RabbitMQ');
        });
        channel.once('close', () => {
          ready = false;
          connection.close().catch(() => {});
        });
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
    async close() {
      abort.abort();
      await channel?.close().catch(() => {});
      await connection?.close().catch(() => {});
      await task;
    },
  };
}
