# ADR 005: Consistencia entre la base de datos y el broker

## Estado
Aceptado (E2-05)

## Contexto
Confirmar un pedido cambia su estado en PostgreSQL **y** debe generar el evento `pedido.confirmado` en RabbitMQ. Una transacción SQL no incluye al broker: si se publica antes del commit y la transacción falla, cocina recibe un pedido que no está confirmado; si se publica después y el proceso cae, el pedido queda confirmado sin orden de cocina.

## Decisión
**Outbox transaccional + consumidor idempotente.**

- La confirmación (estado, total, `confirmadoEn`) y la fila del evento en la tabla `outbox` se guardan en la **misma transacción**, con el pedido bloqueado (`FOR UPDATE`) y sus productos con `FOR SHARE`.
- Un publicador en la API lee los pendientes, los publica por lote con publisher confirms y marca `publicado_en` **solo después** de la confirmación del broker. Si el broker no está disponible, reintenta con espera creciente.
- El worker crea la orden con `INSERT … ON CONFLICT (pedido_id) DO NOTHING` sobre la restricción única de `orden_cocina.pedido_id` y hace ACK después de persistir.
- Los cambios de estado de cocina y la entrega usan el mismo mecanismo (`orden.actualizada`).

## Alternativas consideradas
- **Publicar directo desde el request**: más simple, pero con los dos modos de falla del contexto.
- **Transacción distribuida (2PC)**: RabbitMQ no la ofrece y agrega mucha complejidad.

## Consecuencias
- **Consistencia eventual**: la respuesta HTTP de la confirmación no incluye la orden de cocina; aparece unos milisegundos después (26 ms de demora media de publicación bajo carga, E2-08).
- Entrega **al menos una vez**: un evento puede reenviarse (caída entre el ack del broker y el `UPDATE`). Se garantiza un efecto idempotente, no una entrega exactamente una vez.
- Con el broker caído, los pedidos se siguen confirmando; los eventos se publican al volver (comprobado: unos 12 s después de iniciar el broker).
- Publicar de a un evento resultó lento bajo carga (303 pendientes y 6 s de demora); se pasó a publicación por lote ([verificación E2-08](../verificacion-e2-08.md)).
