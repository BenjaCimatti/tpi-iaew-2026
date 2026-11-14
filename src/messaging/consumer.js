import { setTimeout as delay } from 'node:timers/promises';
import { COLA_COCINA, MAX_REINTENTOS } from './topology.js';
import { EventoInvalido, validarPedidoConfirmado } from '../services/cocina.js';

const PREFETCH = 10;

// Consumidor de cocina.pedido-confirmado:
// - ACK solo después de persistir la orden (o de comprobar que ya existía).
// - Mensaje inválido o pedido inexistente/incompatible → NACK sin reencolar → DLQ.
// - Fallo transitorio (p. ej. DB caída) → espera creciente, republica una copia
//   con x-reintentos+1 (confirmada por el broker) y luego hace ACK del original.
//   Superados MAX_REINTENTOS → NACK sin reencolar → DLQ. Se usa un contador
//   propio porque en RabbitMQ 4 un NACK con requeue no incrementa
//   x-delivery-count (comprobado), y el límite de la cola no se aplicaría.
// onResultado(resultado): para métricas (orden_creada, duplicado, rechazado_dlq, reintento, agotado_dlq).
export function createPedidoConfirmadoConsumer(cocina, logger, { onOrdenCreada = () => {}, onResultado = () => {}, backoffMs = 1000, maxBackoffMs = 10000 } = {}) {
  async function handle(channel, message) {
    if (!message) return; // RabbitMQ canceló el consumidor; el broker reconectará.
    const inicio = performance.now();
    const reintentos = Number(message.properties.headers?.['x-reintentos'] ?? 0);
    const intento = (Number.isInteger(reintentos) && reintentos >= 0 ? reintentos : 0) + 1;
    const contexto = { operacion: 'cocina.consumir', messageId: message.properties.messageId, intento };
    const settle = (action) => {
      try {
        action();
      } catch (error) {
        // Canal cerrado: RabbitMQ reentregará el mensaje y el efecto es idempotente.
        logger.warn({ ...contexto, code: error.code }, 'No se pudo confirmar el mensaje; se reentregará');
      }
    };
    let evento;
    let resultado;
    try {
      evento = validarPedidoConfirmado(JSON.parse(message.content.toString('utf8')));
      Object.assign(contexto, { eventId: evento.eventId, pedidoId: evento.pedidoId, correlationId: evento.correlationId });
      resultado = await cocina.procesarPedidoConfirmado(evento);
    } catch (error) {
      const duracionMs = Math.round(performance.now() - inicio);
      if (error instanceof SyntaxError || error instanceof EventoInvalido) {
        settle(() => channel.nack(message, false, false));
        onResultado('rechazado_dlq');
        logger.warn({ ...contexto, resultado: 'rechazado_dlq', codigo: error.codigo ?? 'JSON_INVALIDO', duracionMs }, 'Evento rechazado y enviado a la DLQ');
        return;
      }
      if (intento > MAX_REINTENTOS) {
        settle(() => channel.nack(message, false, false));
        onResultado('agotado_dlq');
        logger.error({ ...contexto, resultado: 'agotado_dlq', code: error.code, duracionMs }, 'Reintentos agotados; mensaje enviado a la DLQ');
        return;
      }
      onResultado('reintento');
      logger.error({ ...contexto, resultado: 'reintento', code: error.code, duracionMs }, 'Fallo transitorio al procesar el evento; se reintentará');
      await delay(Math.min(backoffMs * 2 ** (intento - 1), maxBackoffMs), undefined, { ref: false });
      try {
        await republish(channel, message, intento);
        settle(() => channel.ack(message));
      } catch {
        // Sin confirmación de la copia: se devuelve el original a la cola.
        settle(() => channel.nack(message, false, true));
      }
      return;
    }
    const { creada, orden } = resultado;
    settle(() => channel.ack(message));
    onResultado(creada ? 'orden_creada' : 'duplicado');
    logger.info({ ...contexto, resultado: creada ? 'orden_creada' : 'duplicado', ordenId: orden.id, duracionMs: Math.round(performance.now() - inicio) },
      creada ? 'Orden de cocina creada' : 'Evento repetido: la orden ya existía');
    if (!creada) return;
    try {
      // Emisión posterior a la persistencia (WebSocket en E2-07); un fallo aquí no afecta al mensaje.
      await onOrdenCreada(orden, evento);
    } catch (error) {
      logger.warn({ ...contexto, code: error.code }, 'No se pudo notificar la orden creada');
    }
  }

  function republish(channel, message, reintentos) {
    const { headers = {}, ...properties } = message.properties;
    return new Promise((resolve, reject) => {
      channel.sendToQueue(COLA_COCINA, message.content, { ...properties, persistent: true, headers: { ...headers, 'x-reintentos': reintentos } },
        (error) => (error ? reject(error) : resolve()));
    });
  }

  return {
    handle,
    // Se ejecuta en cada (re)conexión desde el setup del broker.
    async register(channel) {
      await channel.prefetch(PREFETCH);
      await channel.consume(COLA_COCINA, (message) => void handle(channel, message), { noAck: false });
    },
  };
}
