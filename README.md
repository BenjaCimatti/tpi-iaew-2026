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

- Docker y Docker Compose, con el motor iniciado (por ejemplo, Docker Desktop).
- Node.js 20+ (solo si se corre la API fuera de Docker durante el desarrollo).
- Una cuenta gratuita en [Auth0](https://auth0.com) (o equivalente) para la Entrega 2.

## Variables de entorno

Desde la raíz del repositorio, copiar `.env.example` a `.env` y completar los
valores. Si ya existe `.env`, conservarlo para no sobrescribir la configuración local:

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

## Ejecución local del esqueleto

Los valores de ejemplo de PostgreSQL y RabbitMQ permiten levantar el esqueleto.
Los placeholders actuales no usan Auth0 ni validan la API key; esas integraciones
siguen pendientes para la Entrega 2.

1. Levantar los servicios desde la raíz del repositorio:

   ```bash
   docker compose up -d
   ```

2. Revisar su estado:

   ```bash
   docker compose ps
   ```

   Deben aparecer `api`, `worker`, `db` y `broker` en ejecución. `db` y `broker`
   deben indicar `healthy`; si todavía están en `starting`, esperar y repetir la
   consulta. Para diagnosticar errores, usar `docker compose logs`.

3. Consultar [http://localhost:3000](http://localhost:3000) desde el navegador o
   la terminal:

   ```bash
   curl -i http://localhost:3000
   ```

   La respuesta esperada es HTTP `200` con
   `API placeholder - reemplazar en Entrega 2`.

4. Abrir RabbitMQ Management en
   [http://localhost:15672](http://localhost:15672). Con `.env.example`, el usuario
   y la contraseña son `restaurante` / `restaurante`; si se cambiaron, usar los
   valores de `RABBITMQ_USER` y `RABBITMQ_PASSWORD` de `.env`.

5. Detener y eliminar los contenedores y la red del proyecto:

   ```bash
   docker compose down
   ```

   Este comando conserva el volumen de PostgreSQL y sus datos.

**Alcance de la comprobación:** API y worker son servicios `http-echo`. Una
respuesta HTTP del placeholder y los healthchecks de PostgreSQL/RabbitMQ solo
demuestran que el esqueleto arranca. No prueban conexiones de API/worker a la DB
o al broker, publicación/consumo de `pedido.confirmado` ni creación de órdenes
de cocina.

Resultado de la ejecución: [verificación del esqueleto](docs/verificacion-esqueleto.md).

## Decisiones técnicas principales

Ver [`docs/adr/`](docs/adr/).

## Limitaciones conocidas y mejoras futuras

- Esta entrega (Entrega 1) incluye solo el diseño y un esqueleto ejecutable con
  servicios placeholder; la lógica real de negocio se implementa en la Entrega 2.

## Tag / release y commit de esta entrega

- Tag: `v1.0.0`
- Commit: 8b3aa05d8e8463ff1a8b62c14aef7604aa1032f3
