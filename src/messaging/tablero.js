import { EXCHANGE, ORDEN_ACTUALIZADA } from './topology.js';

// Suscripción del gateway a los cambios de estado publicados por la API.
// Cola exclusiva y temporal por proceso: es una difusión en vivo, no trabajo a
// procesar. Si el gateway estuvo caído, el snapshot al reconectar recupera el estado.
export function createTableroSubscriber(onOrden, logger) {
  return {
    async register(channel) {
      const { queue } = await channel.assertQueue('', { exclusive: true, autoDelete: true, durable: false });
      await channel.bindQueue(queue, EXCHANGE, ORDEN_ACTUALIZADA);
      await channel.consume(queue, (message) => {
        if (!message) return;
        try {
          const evento = JSON.parse(message.content.toString('utf8'));
          if (evento.eventType !== ORDEN_ACTUALIZADA || evento.version !== 1 || !evento.data?.orden?.id) throw new Error('Evento inválido');
          const clientes = onOrden(evento);
          logger.info({
            operacion: 'ws.difundir', resultado: 'enviado', eventType: evento.eventType, eventId: evento.eventId,
            pedidoId: evento.pedidoId, correlationId: evento.correlationId, estado: evento.data.orden.estado, clientes,
          }, 'Actualización de orden difundida al tablero');
        } catch {
          logger.warn({ operacion: 'ws.difundir', resultado: 'descartado', messageId: message.properties.messageId }, 'Evento de tablero inválido descartado');
        }
      }, { noAck: true });
    },
  };
}
