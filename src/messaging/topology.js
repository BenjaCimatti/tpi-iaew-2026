// Topología compartida por API (productor) y worker (consumidor). Ambos la
// declaran de forma idempotente al conectarse, para que un mensaje publicado
// antes de que arranque el worker quede retenido en la cola durable.
export const EXCHANGE = 'restaurante.eventos';
export const DLX = 'restaurante.eventos.dlx';
export const COLA_COCINA = 'cocina.pedido-confirmado';
export const DLQ_COCINA = 'cocina.pedido-confirmado.dlq';
export const PEDIDO_CONFIRMADO = 'pedido.confirmado';
// Cambios de estado de cocina/entrega: los recibe el gateway WebSocket del worker
// con una cola exclusiva y temporal (difusión en vivo; el snapshot cubre lo perdido).
export const ORDEN_ACTUALIZADA = 'orden.actualizada';
// Reintentos del consumidor ante fallos transitorios antes de enviar a la DLQ
// (con espera 1, 2, 4, 8 y luego 10 s: ~75 s de tolerancia a una caída de DB).
export const MAX_REINTENTOS = 10;
// Red de seguridad del broker (entregas fallidas sin NACK, p. ej. canal cerrado).
// Cambiarlo exige borrar la cola: RabbitMQ rechaza redeclararla con otros argumentos.
export const MAX_ENTREGAS = 5;

export async function declareTopology(channel) {
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(DLX, 'topic', { durable: true });
  await channel.assertQueue(DLQ_COCINA, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await channel.bindQueue(DLQ_COCINA, DLX, '#');
  await channel.assertQueue(COLA_COCINA, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum', 'x-delivery-limit': MAX_ENTREGAS, 'x-dead-letter-exchange': DLX },
  });
  await channel.bindQueue(COLA_COCINA, EXCHANGE, PEDIDO_CONFIRMADO);
}
