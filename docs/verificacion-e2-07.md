# Verificación E2-07 — Cocina y tablero WebSocket

**Fecha:** 14/11/2026. Cambios locales sobre `4ce3901` (rama `entrega-2/asincronia`).
**Entorno:** Docker Desktop 29.7.2, Node `24.22.1`, PostgreSQL `16.15`, RabbitMQ `4.3.6`.

| Comprobación | Resultado |
|---|---|
| Endpoints de cocina | `GET /cocina/ordenes` y `/{id}` con `read:cocina`; `PATCH /cocina/ordenes/{id}` con `write:cocina`. Sin token `401`; `write:pedidos` o solo `read:cocina` → `403` al modificar; estado inválido `400`; inexistente `404`. |
| Transiciones | `recibida → en_preparacion → lista`; saltar a `lista`, retroceder o repetir → `409 TRANSICION_INVALIDA` sin evento. El pedido acompaña: `en_preparacion` y `listo`. |
| Entrega | `POST /pedidos/{id}/entregar` (`write:pedidos`): solo desde `listo` (`409` desde pendiente, en preparación o ya entregado; `403` con token de cocina). |
| Outbox | Cada cambio registra `orden.actualizada` en la misma transacción, con el `x-correlation-id` del request y la orden completa; secuencia `en_preparacion`, `listo`, `entregado`. |
| Concurrencia | Dos `PATCH` simultáneos a la misma orden: un `200`, un `409` y un solo evento. Bloqueo pedido → orden. |
| Stack real: flujo | Pedido confirmado → worker crea la orden → `en_preparacion` → `lista` → `entregado`. El worker registró `cocina.consumir orden_creada` y cuatro `ws.difundir` (`orden.creada` y tres `orden.actualizada`) con el mismo `correlationId`; los tres últimos llegaron desde la API por RabbitMQ. |
| Stack real: rechazos | Contra `ws://worker:3001/ws/cocina`: sin `auth` → `4408`; token alterado → `4401`; `auth` sin token → `4401`; mensaje no soportado → `4400`. `GET /tablero` → `200 text/html`. |
| Gateway (pruebas con cliente `ws`) | Autenticado recibe `auth.ok`, `snapshot` y eventos; no autenticado no recibe eventos; sin `read:cocina` → `4403`; vencimiento del token → `4401 TOKEN_EXPIRADO`; renovación sin nuevo snapshot; fallo de DB en snapshot → `1011`. |
| JWT del stream | Firma RS256 con JWKS local, issuer, audience, expiración, `scope` y `permissions`; Auth0 sin configurar → rechazo. |
| Pruebas | `npm test`: 21/21. `test:db`: 3/3. `test:api`: 3/3 (CRUD, confirmación y cocina). |
| OpenAPI | Redocly válido; mismas 8 advertencias previas. WebSocket documentado en [websocket.md](websocket.md). |

## No verificado todavía

- **Tablero en el navegador con un token real de Auth0.** El `.env` local no
  tiene `AUTH0_CLIENT_ID`/`AUTH0_CLIENT_SECRET`, así que no se obtuvo un token
  real. La difusión a clientes autenticados está cubierta por las pruebas del
  gateway, y el flujo real llegó al gateway (con 0 clientes conectados). Falta
  abrir `/tablero` con un token real, confirmar un pedido y avanzar su estado
  (pasos en [websocket.md](websocket.md#probar)).
- Requests de cocina y entrega en la colección Postman (E2-09).
- Diagramas C4 con el gateway y el tablero (E2-10).
