# Pedidos en Restaurante con Cocina - TPI IAEW 2026

## Proyecto, dominio e integrantes

- **Dominio elegido:** Pedidos en restaurante con cocina (Dominio 1).
- **Integrantes:** _completar nombre y rol de cada integrante_.
- **Repositorio:** _completar link_.

## Descripción del problema y alcance

Plataforma que permite registrar pedidos desde una mesa, confirmarlos (validando
productos y calculando el total), enviarlos automáticamente a cocina mediante un
evento asincrónico, y hacer seguimiento del avance de preparación en un tablero
en tiempo real.

**Entidades principales:** Producto, Mesa, Pedido, ItemPedido, OrdenCocina.
**CRUD mínimo:** Productos y Pedidos.
**Transacción multi-paso:** confirmar pedido (validar ítems y productos, calcular
total, cambiar estado, publicar evento `pedido.confirmado`, generar orden de cocina).

## Arquitectura en un vistazo

Ver diagramas C4 completos en `docs/c4/`:
- [`context.md`](docs/c4/context.md) — actores y sistemas externos (Auth0, notificaciones).
- [`container.md`](docs/c4/container.md) — API REST, Worker de cocina, Gateway WebSocket, PostgreSQL, RabbitMQ.
- [`component.md`](docs/c4/component.md) — componentes internos de la API.

Decisiones técnicas documentadas como ADRs en [`docs/adr/`](docs/adr/):
1. [Estilo de API (REST + WebSocket)](docs/adr/001-estilo-api.md)
2. [Base de datos (PostgreSQL)](docs/adr/002-base-de-datos.md)
3. [Seguridad (Auth0 + OAuth 2.0/JWT + API key)](docs/adr/003-seguridad.md)
4. [Broker de asincronía (RabbitMQ)](docs/adr/004-broker-asincronia.md)

Modelo de datos: [`docs/modelo-datos.md`](docs/modelo-datos.md).
Contrato de API: [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.1).

## Requisitos previos

- Docker y Docker Compose.
- Node.js 20+ (solo si se corre la API fuera de Docker durante el desarrollo).
- Una cuenta gratuita en [Auth0](https://auth0.com) (o equivalente) para la Entrega 2.

## Variables de entorno

Copiar `.env.example` a `.env` y completar los valores:

```bash
cp .env.example .env
```

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `RABBITMQ_URL` | Cadena de conexión al broker |
| `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` | Datos de la API configurada en Auth0 |
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | Credenciales del cliente Machine to Machine |
| `API_KEY` | Clave de ejemplo para el endpoint protegido con `x-api-key` |

> No se suben secretos reales al repositorio. `.env` está en `.gitignore`.

## Configuración de Auth0 (a completar en Entrega 2)

_TODO: pasos concretos una vez creada la cuenta —_
1. Crear una API en Auth0 con identifier `AUTH0_AUDIENCE`.
2. Definir los scopes: `read:pedidos`, `write:pedidos`, `confirm:pedidos`, `admin:productos`, `read:cocina`.
3. Crear una aplicación Machine to Machine y autorizarla contra esa API con esos scopes.
4. Completar `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` en `.env`.

## Cómo obtener un token (client_credentials) — Entrega 2

```bash
curl --request POST \
  --url https://$AUTH0_DOMAIN/oauth/token \
  --header 'content-type: application/json' \
  --data '{
    "client_id": "'"$AUTH0_CLIENT_ID"'",
    "client_secret": "'"$AUTH0_CLIENT_SECRET"'",
    "audience": "'"$AUTH0_AUDIENCE"'",
    "grant_type": "client_credentials"
  }'
```

## Cómo probar endpoints protegidos — Entrega 2

```bash
curl http://localhost:3000/pedidos \
  -H "Authorization: Bearer <access_token>"
```

## Cómo probar el ejemplo con x-api-key — Entrega 2

```bash
curl http://localhost:3000/health-protegido \
  -H "x-api-key: $API_KEY"
```

## Levantar el proyecto localmente

```bash
docker compose up --build
```

Esto levanta (por ahora, con placeholders — ver Entrega 2):
- `api` en `http://localhost:3000`
- `db` (PostgreSQL) en `localhost:5432`
- `broker` (RabbitMQ) — AMQP en `5672`, panel de administración en `http://localhost:15672`

## Cómo cargar datos iniciales — Entrega 2

_TODO: comando de migración + seed (ej. `npm run migrate && npm run seed`)._

## Cómo ejecutar pruebas — Entrega 2

_TODO: Postman collection en `docs/postman/` y comando para correrla con Newman._

## Cómo disparar el flujo asincrónico — Entrega 2

_TODO: `POST /pedidos/{id}/confirmar` publica `pedido.confirmado`; ver la cola en
el panel de RabbitMQ (`http://localhost:15672`) y el efecto (OrdenCocina creada) en la respuesta del worker._

## Cómo probar la integración elegida (WebSocket) — Entrega 2

_TODO: cómo conectarse al Gateway WebSocket y qué mensajes esperar cuando cambia el estado de una orden._

## Cómo observar el sistema — Entrega 2

_TODO: logs JSON con correlation ID, dashboard con p95/throughput/error rate._

## Endpoints principales

Ver contrato completo en [`docs/openapi.yaml`](docs/openapi.yaml). Resumen:

| Método | Ruta | Scope requerido |
|---|---|---|
| GET | `/productos` | `read:pedidos` |
| POST | `/productos` | `admin:productos` |
| GET | `/pedidos` | `read:pedidos` |
| POST | `/pedidos` | `write:pedidos` |
| POST | `/pedidos/{id}/confirmar` | `confirm:pedidos` |
| GET | `/health-protegido` | `x-api-key` |

## Decisiones técnicas principales

Ver [`docs/adr/`](docs/adr/).

## Limitaciones conocidas y mejoras futuras

- Esta entrega (Entrega 1) incluye solo el diseño y un esqueleto ejecutable con
  servicios placeholder; la lógica real de negocio se implementa en la Entrega 2.
- _completar a medida que surjan limitaciones reales durante la implementación._

## Tag / release y commit de esta entrega

- Tag: `v1.0.0`
- Commit: _completar con el hash antes de subir el .zip a Moodle_
