# Pedidos en Restaurante con Cocina - TPI IAEW 2026

## Proyecto, dominio e integrantes

- **Dominio elegido:** Pedidos en restaurante con cocina (Dominio 1).
- **Integrantes:** 
  - Benjamin Cimatti 94312
  - Candela Etchechoury 407630
  - Lucio Morales Demaria 94289
  - Octavio Testa 94177
- **Repositorio:** https://github.com/BenjaCimatti/tpi-iaew-2026

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



## Decisiones técnicas principales

Ver [`docs/adr/`](docs/adr/).

## Limitaciones conocidas y mejoras futuras

- Esta entrega (Entrega 1) incluye solo el diseño y un esqueleto ejecutable con
  servicios placeholder; la lógica real de negocio se implementa en la Entrega 2.

## Tag / release y commit de esta entrega

- Tag: `v1.0.0`
- Commit: _completar con el hash antes de subir el .zip a Moodle_
