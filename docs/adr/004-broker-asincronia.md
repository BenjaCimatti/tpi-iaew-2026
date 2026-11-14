# ADR 004: Broker de mensajería

## Estado
Aceptado (actualizado en E2-05/E2-06)

## Contexto
Al confirmar un pedido, la generación de la Orden de Cocina no debe bloquear la respuesta HTTP al mozo. Necesitamos un flujo productor -> broker -> consumidor.

## Decisión
Usamos **RabbitMQ 4.3**. La API publica `pedido.confirmado` en el exchange `restaurante.eventos` (topic); el worker lo consume y crea la `OrdenCocina`. Los cambios de estado de cocina se publican como `orden.actualizada` y los recibe el gateway WebSocket.

## Alternativas consideradas
- **Kafka**: pensado para alto throughput y streams de eventos, es más pesado de operar (Zookeeper/KRaft) para un caso de pocos tipos de evento y volumen bajo como este TPI.
- **SQS/EventBridge**: requieren cuenta AWS y credenciales; complican la ejecución 100% local con `docker compose up`, que es un requisito explícito de la consigna.

RabbitMQ tiene una imagen oficial liviana y un panel de administración incluido (`management`), útil para mostrar evidencia en la demo, y encaja con el patrón productor/consumidor que pide el enunciado.

## Consecuencias
- Topología declarada por API y worker al conectarse: cola **quorum** durable `cocina.pedido-confirmado` con DLX hacia `cocina.pedido-confirmado.dlq`, y una cola exclusiva por gateway para `orden.actualizada`. Detalle en [docs/eventos.md](../eventos.md).
- **Publisher confirms**: el productor considera publicado un evento solo cuando RabbitMQ lo confirma (outbox, [ADR 005](005-outbox-consistencia.md)).
- **Consumidor**: ACK después de persistir; mensajes inválidos o de pedidos inexistentes van a la DLQ; fallos transitorios se reintentan hasta 10 veces con espera creciente mediante el header propio `x-reintentos`. En RabbitMQ 4.3 un `nack` con requeue no incrementa `x-delivery-count` (comprobado), así que el límite de la cola no alcanzaba.
- RabbitMQ usa volumen persistente y hostname fijo: sin ellos, recrear el contenedor perdía los mensajes en cola (ocurrió en las pruebas de E2-06).
- El Webhook de notificaciones previsto en E1 se descartó ([ADR 001](001-estilo-api.md)).
