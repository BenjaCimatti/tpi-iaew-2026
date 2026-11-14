# Contrato de eventos asíncronos

La comunicación API → worker usa RabbitMQ. La API **no** publica directamente
desde el request: registra el evento en la tabla `outbox` dentro de la misma
transacción que confirma el pedido, y un publicador lo envía después del commit.

## Topología

Declarada de forma idempotente por API y worker al conectarse
([`src/messaging/topology.js`](../src/messaging/topology.js)), así un evento
publicado con el worker detenido queda retenido en la cola. RabbitMQ usa el
volumen `broker_data` y hostname fijo, por lo que colas y mensajes sobreviven a
la recreación del contenedor.

| Elemento | Nombre | Tipo / argumentos |
|---|---|---|
| Exchange de eventos | `restaurante.eventos` | `topic`, durable |
| Cola de cocina | `cocina.pedido-confirmado` | quorum, durable, `x-delivery-limit: 5` (red de seguridad), `x-dead-letter-exchange: restaurante.eventos.dlx` |
| Binding | `restaurante.eventos` → `cocina.pedido-confirmado` | routing key `pedido.confirmado` |
| Exchange de mensajes fallidos | `restaurante.eventos.dlx` | `topic`, durable |
| DLQ | `cocina.pedido-confirmado.dlq` | quorum, durable, binding `#` |

## `pedido.confirmado` — versión 1

Mensaje persistente (`deliveryMode: 2`), `contentType: application/json`.

Propiedades AMQP: `messageId` = `eventId`, `type` = `pedido.confirmado`,
`correlationId`, `timestamp` (segundos) y headers `x-correlation-id` y
`x-event-version`.

```json
{
  "eventId": "26dae69c-5fe3-4801-a3f5-df2677eb9330",
  "eventType": "pedido.confirmado",
  "version": 1,
  "occurredAt": "2026-11-14T18:42:38.452Z",
  "correlationId": "11111111-2222-4333-8444-555555555555",
  "pedidoId": "f3c59a3c-5a71-4c43-83f7-cd2f1bea68e8",
  "data": {
    "mesaId": "b3f1a2e0-1111-4a2b-9c3d-000000000001",
    "total": "16000.00",
    "items": [
      { "productoId": "a1c9f0e0-2222-4a2b-9c3d-000000000002", "nombre": "Milanesa napolitana", "cantidad": 1, "precioUnitario": "8500.00" }
    ]
  }
}
```

- `eventId` es el `id` de la fila de outbox: identifica el evento aunque se reenvíe.
- `occurredAt` coincide con `pedido.confirmado_en`.
- Importes como **string decimal con dos posiciones**, para no perder precisión
  en JSON (la API REST los expone como número).
- `nombre` se incluye para que cocina muestre la orden sin consultar el catálogo.
- Cambios incompatibles incrementan `version`; los consumidores deben rechazar
  versiones que no soportan.

## Garantías y política de fallos

**Productor (API).** Entrega *al menos una vez*:

1. La confirmación y la fila de outbox se guardan en una única transacción SQL.
   Si cualquiera falla, no queda ni el cambio de estado ni el evento.
2. El publicador ([`src/services/outbox.js`](../src/services/outbox.js)) lee los
   eventos con `publicado_en IS NULL` en orden de `occurred_at`, los publica por
   un canal de confirmación y **solo después del ack** de RabbitMQ marca
   `publicado_en`.
3. Si RabbitMQ está caído o no confirma en 5 s, el evento queda pendiente y se
   reintenta con espera creciente (1 s → 15 s máx.). **La confirmación del
   pedido no se revierte por un fallo del broker**: el pedido queda
   `confirmado` y la orden de cocina aparece cuando el broker vuelve.
4. Si el proceso cae entre el ack y el `UPDATE`, el evento se reenvía. Por eso
   el consumidor debe ser idempotente.

La transacción SQL **no** incluye al broker ni a la creación de la orden de
cocina: esa orden la crea el worker al consumir el evento (consistencia eventual).

**Consumidor (worker).** [`src/messaging/consumer.js`](../src/messaging/consumer.js)
y [`src/services/cocina.js`](../src/services/cocina.js), prefetch 10:

| Situación | Acción | Resultado en log |
|---|---|---|
| Evento válido, pedido `confirmado` sin orden | Crea `OrdenCocina` `recibida`, luego **ACK** | `orden_creada` |
| Evento repetido (misma u otra entrega para el pedido) | No crea nada, **ACK** | `duplicado` |
| JSON inválido, tipo/versión no soportados, UUID o fecha inválidos | **NACK sin reencolar** → DLQ | `rechazado_dlq` + `codigo` |
| Pedido inexistente, `pendiente` o `cancelado` | **NACK sin reencolar** → DLQ | `rechazado_dlq` + `codigo` |
| Fallo transitorio (DB caída, timeout) | Espera 1, 2, 4, 8, 10… s, republica una copia con `x-reintentos`+1 confirmada por el broker y luego **ACK** del original | `reintento` + `intento` |
| Más de 10 reintentos | **NACK sin reencolar** → DLQ | `agotado_dlq` |

- La idempotencia la garantiza PostgreSQL: `INSERT ... ON CONFLICT (pedido_id)
  DO NOTHING` sobre la restricción única de `orden_cocina.pedido_id`, también
  ante entregas concurrentes.
- Si el canal se cierra antes del ACK, RabbitMQ reentrega el mensaje y el
  resultado es `duplicado`.
- **Por qué un contador propio:** en RabbitMQ 4.3, un `basic.nack` con
  `requeue=true` no incrementa `x-delivery-count` (comprobado con la DB caída:
  todas las entregas llegaban como primer intento), de modo que el
  `x-delivery-limit` de la cola no limitaba los reintentos. El límite de 5 de la
  cola queda como red de seguridad para entregas fallidas sin NACK.
- Los mensajes de la DLQ se revisan desde RabbitMQ Management y se pueden
  reprocesar moviéndolos a `cocina.pedido-confirmado` (*Move messages*). Como
  alternativa, poner `publicado_en = NULL` en la fila de outbox hace que la API
  vuelva a publicar el evento.
- Cada log del consumidor incluye `eventId`, `pedidoId`, `correlationId`,
  `intento` y `duracionMs`.
