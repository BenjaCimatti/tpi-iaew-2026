# Verificación E2-06 — RabbitMQ y consumidor de cocina

**Fecha:** 14/11/2026. Cambios locales sobre `29c0247`.
**Entorno:** Docker Desktop 29.7.2, Node `24.22.1`, PostgreSQL `16.15`, RabbitMQ `4.3.6`.

| Comprobación | Resultado |
|---|---|
| Flujo completo | Pedido confirmado → outbox → RabbitMQ → worker → `orden_cocina` en estado `recibida`. Logs `outbox.publicar` (API) y `cocina.consumir` (worker) con el mismo `eventId`, `pedidoId` y `correlationId`. |
| Idempotencia real | Se reenviaron eventos ya procesados (`publicado_en = NULL`): el worker registró `duplicado` y siguió habiendo una orden por pedido. |
| Idempotencia concurrente | Cinco procesamientos simultáneos del mismo pedido contra PostgreSQL: una sola orden creada; todos devuelven la misma. |
| Worker detenido | Con el worker detenido se confirmó un pedido; el mensaje quedó en la cola y se procesó al iniciar el worker. |
| Broker recreado | Con el mensaje pendiente se recreó el contenedor de RabbitMQ (`--force-recreate`): la cola conservó el mensaje gracias al volumen `broker_data` y el worker creó la orden. |
| DB caída | Con PostgreSQL detenido, el worker registró los intentos 1, 2 y 3 como `reintento` con espera creciente; al volver la DB, el intento 4 creó la orden. Ningún mensaje se perdió ni fue a la DLQ. |
| DLQ | JSON inválido → `rechazado_dlq` `JSON_INVALIDO`; pedido inexistente → `rechazado_dlq` `PEDIDO_INEXISTENTE`. Ambos quedaron en `cocina.pedido-confirmado.dlq`. Pedidos `pendiente`/`cancelado` se rechazan sin crear orden (prueba de DB). |
| Reintentos limitados | Más de 10 reintentos → `agotado_dlq` (prueba unitaria). Sin confirmación de la copia republicada, el original vuelve a la cola. |
| Pruebas | `npm test`: 17/17. `test:db`: 3/3 (incluye cocina). `test:api`: 2/2, ejecutadas con API y worker procesando eventos en paralelo. |

## Problemas encontrados y corregidos

1. **RabbitMQ sin volumen.** Al recrear el contenedor del broker se perdieron dos
   mensajes durables de la cola. Se agregaron `hostname: broker` y el volumen
   `broker_data`. Los dos eventos se recuperaron desde el outbox poniendo
   `publicado_en = NULL`: la API los reenvió y el worker creó las órdenes.
2. **`x-delivery-count` no se incrementa con NACK + requeue en RabbitMQ 4.3.**
   Con la DB caída todas las entregas llegaban como primer intento, así que el
   límite de la cola no se aplicaba y un fallo persistente hubiera reintentado
   sin fin. Se reemplazó por un contador propio `x-reintentos` (ver
   [eventos.md](eventos.md)).

## Repetir

```bash
docker compose up --build -d
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm test
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm run test:db
docker compose logs worker | grep cocina.consumir
```

Para la prueba de DB caída: `docker compose stop worker`, confirmar un pedido,
`docker compose stop db`, `docker compose up -d --no-deps worker`, esperar unos
segundos y `docker compose start db`. `docker compose start worker` sin
`--no-deps` vuelve a levantar la DB y anula la prueba.

**Pendiente:** endpoints de cocina, WebSocket y tablero (E2-07); requests de
Postman con espera acotada de la orden (E2-09). La DLQ local contiene los dos
mensajes inválidos de esta prueba.
