# ADR 004: Broker de mensajería

## Estado
Aceptado

## Contexto
Al confirmar un pedido, la generación de la Orden de Cocina y la notificación no deben bloquear la respuesta HTTP al mesero. Necesitamos un flujo productor -> broker -> consumidor.

## Decisión
Usamos **RabbitMQ**. La API publica el evento `pedido.confirmado` en un exchange; un Worker consume ese evento, genera la `OrdenCocina` y dispara la actualización del tablero (WebSocket) y la notificación (Webhook simulado).

## Alternativas consideradas
- **Kafka**: pensado para alto throughput y streams de eventos, es más pesado de operar (Zookeeper/KRaft) para un caso de un solo tipo de evento con volumen bajo como este TPI.
- **SQS/EventBridge**: requieren cuenta AWS y credenciales; complican la ejecución 100% local con `docker-compose up`, que es un requisito explícito de la consigna.

RabbitMQ tiene una imagen oficial liviana, panel de administración incluido (`management` image) útil para mostrar evidencia en la demo, y encaja bien con el patrón productor/consumidor simple que pide el enunciado.

## Consecuencias
- El `docker-compose.yml` incluye el servicio `rabbitmq` con el plugin de management habilitado (puerto 15672) para poder mostrar la cola y los mensajes en la demo.
- Se define una única cola/exchange para `pedido.confirmado` en esta primera entrega; se puede ampliar más adelante (ej. `pedido.cancelado`) si da tiempo.
