# Verificación E2-05 — Confirmación multi-paso y outbox

**Fecha:** 14/11/2026. Cambios locales sobre `29c0247`.
**Entorno:** Docker Desktop 29.7.2, Node `24.22.1`, PostgreSQL `16.15`, RabbitMQ `4.3.6`.

| Comprobación | Resultado |
|---|---|
| Endpoint | `POST /pedidos/{pedidoId}/confirmar` con scope `confirm:pedidos`: sin token `401`; con `write:pedidos` pero sin `confirm:pedidos` `403`; UUID inválido `400`; inexistente `404`. |
| Validaciones | Estado distinto de `pendiente` (ya confirmado o cancelado) → `409 ESTADO_INCOMPATIBLE`; sin ítems → `409 PEDIDO_SIN_ITEMS`; producto no disponible → `409 PRODUCTO_NO_DISPONIBLE`. En cada rechazo, pedido, ítems y outbox quedan idénticos. |
| Total | Calculado con los precios capturados en `item_pedido`: tras subir el precio del catálogo a 99999, el total confirmado sigue siendo `2×8500.50 + 3×2500 = 24501.00`. |
| Atomicidad | Estado, total, `confirmado_en` y fila de outbox se escriben en la misma transacción; el evento repite `confirmado_en` como `occurredAt` y el `x-correlation-id` del request. |
| Concurrencia | Tres confirmaciones simultáneas → un `200`, dos `409` y **un solo** evento. Cinco carreras confirmación/cancelación → gana exactamente una, con evento solo si ganó la confirmación. Bloqueo `FOR UPDATE` del pedido y `FOR SHARE` de sus productos. |
| Orden de cocina | No se crea en la API (`ordenCocina` es `null` tras confirmar): la crea el worker al consumir el evento (E2-06). |
| Publicación real | Pedido del seed confirmado en el stack: la API publicó `pedido.confirmado` en ~38 ms, marcó `publicado_en` después del ack y el mensaje quedó en `cocina.pedido-confirmado`. |
| Fallo del broker | Con `broker` detenido, la confirmación respondió igual (`confirmado`) y el evento quedó con `publicado_en` NULL. Al iniciar el broker, el outbox quedó sin pendientes en ~12 s y la cola tenía el mensaje. |
| Topología | Cola quorum `cocina.pedido-confirmado` (`x-delivery-limit` 5, DLX `restaurante.eventos.dlx`) y DLQ `cocina.pedido-confirmado.dlq`, verificadas con `rabbitmqctl`. |
| Pruebas | `npm test`: 12/12 (incluye publicador de outbox y publicación con confirmación). `test:db`: 2/2. `test:api`: 2/2 (CRUD y confirmación). |
| OpenAPI | Redocly 1.34.5 válido; mismas 8 advertencias previas (URLs `localhost`, health sin 4XX). |

Contrato del evento y política de fallos: [docs/eventos.md](eventos.md).

Repetir:

```bash
docker compose up --build -d
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm test
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm run test:api
```

**Pendiente:** consumidor del worker, idempotencia en recepción y DLQ en uso
(E2-06); colección Postman con la confirmación (E2-09). Los dos mensajes de la
prueba manual siguen en la cola y se consumirán al implementar el worker.
