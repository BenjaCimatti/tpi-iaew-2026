# Tablero de cocina en tiempo real (WebSocket)

Integración adicional elegida (ADR 001). El WebSocket no forma parte del
contrato OpenAPI: se documenta aquí.

| | |
|---|---|
| Proceso | `worker` (mismo proceso que el consumidor de RabbitMQ), puerto `3001` |
| Endpoint | `ws://localhost:3001/ws/cocina` |
| Tablero | [http://localhost:3001/tablero](http://localhost:3001/tablero) |
| Permiso | JWT de Auth0 con scope `read:cocina` |
| Tamaño máximo de mensaje | 16 KB |

## Arquitectura

```
                           ┌──────────────── worker (3001) ────────────────┐
RabbitMQ pedido.confirmado ─► consumidor ─► orden_cocina ─► orden.creada ─┐ │
                           │                                              ▼ │
API PATCH /cocina/ordenes  │                                 gateway WS ──┼─► tablero
API POST  /pedidos/…/entregar                                    ▲        │
   └► outbox ─► RabbitMQ orden.actualizada ─► cola exclusiva ────┘        │
                           └───────────────────────────────────────────────┘
```

- `orden.creada` se emite en memoria **después** de persistir la orden en la DB.
- `orden.actualizada` lo genera la API (otro proceso) en la misma transacción
  que el cambio de estado, vía outbox y RabbitMQ. El gateway lo recibe con una
  cola exclusiva y temporal: API y worker no comparten memoria.
- Si el gateway estuvo desconectado, no se reenvían los eventos perdidos: al
  conectar o reconectar, cada cliente recibe un **snapshot** desde la DB.

## Autenticación y expiración

El navegador no puede enviar el header `Authorization` en un WebSocket. Por eso
el token se envía en el **primer mensaje**, no en la URL, para que no quede en
logs de acceso ni en el historial:

1. El cliente abre la conexión y envía, dentro de los 5 s,
   `{"type":"auth","token":"<access token>"}`.
2. El gateway valida el JWT con las mismas reglas que la API: firma RS256
   contra el JWKS de Auth0, issuer, audience y expiración. Además exige el scope
   `read:cocina`.
3. Responde `auth.ok` con la expiración del token y luego un `snapshot`.
4. Al vencer el token, el servidor cierra con `4401 TOKEN_EXPIRADO`. Para
   renovarlo sin reconectar, el cliente puede enviar otro mensaje `auth` antes
   del vencimiento.

El tablero **no** contiene credenciales: se pega un access token obtenido desde
un cliente de confianza (Postman o `curl`). El client secret M2M nunca llega al
navegador. El token solo se mantiene en memoria de la pestaña.

## Mensajes

Cliente → servidor:

| `type` | Campos | Uso |
|---|---|---|
| `auth` | `token` | Autenticar o renovar |
| `ping` | — | Comprobación de vida de la aplicación (responde `pong`) |

Servidor → cliente:

| `type` | Campos |
|---|---|
| `auth.ok` | `expiresAt` (ISO) |
| `snapshot` | `ordenes` (órdenes de pedidos no entregados ni cancelados), `at` |
| `orden.creada` | `orden`, `eventId`, `correlationId` |
| `orden.actualizada` | `orden`, `eventId`, `correlationId` |
| `pong` | — |
| `error` | `codigo`, `mensaje` (precede a un cierre) |

`orden` tiene la misma forma que `GET /cocina/ordenes/{ordenId}`:

```json
{
  "type": "orden.actualizada",
  "eventId": "0b6f2a77-6a8e-4a3f-9f0e-7a2d1f1c9b10",
  "correlationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "orden": {
    "id": "85097133-1ecd-4acd-b4ca-dda0b89fa719",
    "pedidoId": "f3c59a3c-5a71-4c43-83f7-cd2f1bea68e8",
    "estado": "en_preparacion",
    "pedidoEstado": "en_preparacion",
    "mesa": 1,
    "items": [{ "productoId": "a1c9f0e0-2222-4a2b-9c3d-000000000002", "nombre": "Milanesa napolitana", "cantidad": 2 }],
    "creadoEn": "2026-11-14T18:42:39.000Z",
    "actualizadoEn": "2026-11-14T18:45:10.000Z"
  }
}
```

El cliente aplica una orden solo si su `actualizadoEn` es igual o posterior al
que ya conoce (el snapshot y los eventos pueden intercalarse) y la retira cuando
`pedidoEstado` es `entregado`.

## Códigos de cierre

| Código | Motivo |
|---|---|
| `4400` | Mensaje no soportado, JSON inválido o `ping` sin autenticar |
| `4401` | Token ausente, inválido, vencido (`TOKEN_EXPIRADO`) o Auth0 no configurado |
| `4403` | Token válido sin `read:cocina` |
| `4408` | No se envió `auth` en 5 s |
| `1011` | No se pudo cargar el snapshot (DB no disponible) |
| `1001` | El servidor se está cerrando |

El tablero no reintenta ante `4400`/`4401`/`4403`, porque el mismo token
fallaría otra vez: pide uno nuevo. Ante los demás cierres reintenta con espera
creciente (hasta 15 s) y recibe un nuevo snapshot.

## Estados de cocina y del pedido

| Acción | Permiso | Orden | Pedido |
|---|---|---|---|
| Worker consume `pedido.confirmado` | — | `recibida` | `confirmado` |
| `PATCH /cocina/ordenes/{id}` `{"estado":"en_preparacion"}` | `write:cocina` | `en_preparacion` | `en_preparacion` |
| `PATCH /cocina/ordenes/{id}` `{"estado":"lista"}` | `write:cocina` | `lista` | `listo` |
| `POST /pedidos/{id}/entregar` | `write:pedidos` | `lista` (sale del tablero) | `entregado` |

Solo se avanza un paso por vez; saltos y retrocesos devuelven
`409 TRANSICION_INVALIDA`. Un pedido que salió de `pendiente` ya no se edita,
elimina ni cancela. Los cambios bloquean primero el pedido y luego la orden, para
evitar deadlocks con la entrega y la cancelación.

## Probar

1. Levantar el stack y obtener un token con `read:cocina` (request **00** de
   Postman, o):

   ```bash
   set -a; . ./.env; set +a
   curl -s "https://$AUTH0_DOMAIN/oauth/token" -H 'content-type: application/json' \
     -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"$AUTH0_CLIENT_ID\",\"client_secret\":\"$AUTH0_CLIENT_SECRET\",\"audience\":\"$AUTH0_AUDIENCE\"}"
   ```

2. Abrir [http://localhost:3001/tablero](http://localhost:3001/tablero), pegar el
   `access_token` y conectar. El indicador muestra la hora de vencimiento.
3. Crear y confirmar un pedido desde Postman: la orden aparece en **Recibidas**.
4. `PATCH /cocina/ordenes/{id}` con `en_preparacion` y luego `lista`: la tarjeta
   cambia de columna sin recargar. `POST /pedidos/{id}/entregar` la retira.
5. El registro inferior muestra cada evento con su `correlationId`. En los logs:
   `docker compose logs worker | grep ws.`
