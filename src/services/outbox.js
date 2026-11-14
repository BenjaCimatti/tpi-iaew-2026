import { EXCHANGE } from '../messaging/topology.js';

// Publicador del outbox transaccional (entrega "al menos una vez"):
// 1. lee eventos con publicado_en NULL en orden de ocurrencia;
// 2. los publica y espera la confirmación (ack) de RabbitMQ;
// 3. recién entonces marca publicado_en.
// Si RabbitMQ no está disponible o no confirma, el evento queda pendiente y se
// reintenta con espera creciente (hasta maxIntervalMs). Si el proceso cae entre
// la confirmación y el UPDATE, el evento se vuelve a publicar: el consumidor es
// idempotente por pedidoId. La confirmación del pedido nunca se revierte por un
// fallo del broker.
export function createOutboxPublisher(client, broker, logger, { intervalMs = 1000, maxIntervalMs = 15000, batch = 50 } = {}) {
  let stopped = false;
  let wakeUp = () => {};
  let loop;

  async function publishPending() {
    if (!broker.ready) throw Object.assign(new Error('RabbitMQ no disponible'), { code: 'BROKER_NO_DISPONIBLE' });
    const eventos = await client.outbox.findMany({
      where: { publicadoEn: null },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: batch,
    });
    for (const evento of eventos) {
      if (stopped) break;
      const inicio = performance.now();
      await broker.publish(EXCHANGE, evento.eventType, Buffer.from(JSON.stringify(evento.payload)), {
        messageId: evento.id,
        type: evento.eventType,
        correlationId: evento.correlationId,
        timestamp: Math.floor(evento.occurredAt.getTime() / 1000),
        headers: { 'x-correlation-id': evento.correlationId, 'x-event-version': evento.version },
      });
      await client.outbox.update({ where: { id: evento.id }, data: { publicadoEn: new Date() } });
      logger.info({
        operacion: 'outbox.publicar', resultado: 'publicado', eventId: evento.id, eventType: evento.eventType,
        pedidoId: evento.pedidoId, correlationId: evento.correlationId, duracionMs: Math.round(performance.now() - inicio),
      }, 'Evento publicado en RabbitMQ');
    }
    return eventos.length;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wakeUp = () => { clearTimeout(timer); resolve(); };
    });
  }

  async function run() {
    let wait = intervalMs;
    let failing = false;
    while (!stopped) {
      try {
        const publicados = await publishPending();
        if (failing) logger.info({ operacion: 'outbox.publicar' }, 'Publicación del outbox restablecida');
        failing = false;
        wait = intervalMs;
        if (publicados === batch) continue;
      } catch (error) {
        if (stopped) break;
        if (!failing) logger.warn({ operacion: 'outbox.publicar', resultado: 'reintento', code: error.code }, 'No se pudo publicar el outbox; se reintentará');
        failing = true;
        wait = Math.min(wait * 2, maxIntervalMs);
      }
      await sleep(wait);
    }
  }

  return {
    start() {
      loop ??= run();
    },
    // Despierta el ciclo tras una confirmación para publicar sin esperar el intervalo.
    notify() {
      wakeUp();
    },
    publishPending,
    async stop() {
      stopped = true;
      wakeUp();
      await loop;
    },
  };
}
