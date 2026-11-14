# C4 - Nivel 2: Container

Procesos desplegables definidos en [`docker-compose.yml`](../../docker-compose.yml).

```mermaid
flowchart TB
  cliente["👤 Cliente de confianza<br/>(Postman / Newman / JMeter)"]
  navegador["👤 Tablero de cocina<br/>(navegador)"]
  auth0["Auth0<br/><i>externo</i>"]

  subgraph compose["docker compose"]
    api["<b>api</b> · Node 24 + Express 5<br/>:3000<br/>REST, JWT/scopes, API key,<br/>confirmación, outbox, /metrics"]
    worker["<b>worker</b> · Node 24<br/>:3001<br/>consumidor de cocina +<br/>gateway WebSocket + /tablero"]
    migrate["<b>migrate</b><br/>Prisma Migrate<br/><i>tarea de arranque</i>"]
    db[("<b>db</b> · PostgreSQL 16<br/>:5432")]
    broker[["<b>broker</b> · RabbitMQ 4.3<br/>:5672 · panel :15672"]]
    prom["<b>prometheus</b> v3.15<br/>:9090"]
    graf["<b>grafana</b> 13.3<br/>:3002"]
  end

  cliente -- "HTTPS a Auth0: client_credentials" --> auth0
  cliente -- "HTTP/JSON + Bearer" --> api
  navegador -- "GET /tablero<br/>WebSocket /ws/cocina" --> worker
  api -. "JWKS (cacheado)" .-> auth0
  worker -. "JWKS (cacheado)" .-> auth0
  migrate -- "aplica migraciones" --> db
  api -- "SQL (Prisma)<br/>pedido + outbox en una transacción" --> db
  api -- "publica pedido.confirmado<br/>y orden.actualizada<br/>(publisher confirms)" --> broker
  broker -- "cola cocina.pedido-confirmado<br/>(quorum, DLQ)" --> worker
  broker -- "cola exclusiva<br/>orden.actualizada" --> worker
  worker -- "SQL: orden_cocina<br/>(idempotente)" --> db
  prom -- "scrape /metrics cada 5 s" --> api
  prom -- "scrape /metrics" --> worker
  graf -- "PromQL" --> prom
```

## Notas

- **worker = consumidor + gateway WebSocket en un mismo proceso** (puerto 3001).
  `orden.creada` se emite en memoria después de persistir la orden.
  `orden.actualizada` la genera la API (otro proceso) y llega por RabbitMQ: los
  procesos no comparten memoria.
- **Consistencia:** la confirmación y el evento se guardan juntos en PostgreSQL
  (outbox). La orden de cocina se crea después, de forma eventual
  ([ADR 005](../adr/005-outbox-consistencia.md)).
- El endpoint con `x-api-key` (`GET /health-protegido`) es una ruta del
  contenedor `api`, no un contenedor aparte.
- `migrate` usa la imagen de la API, termina con código 0 y recién entonces
  arrancan `api` y `worker`. El seed se ejecuta manualmente (`npm run db:seed`).
- Volúmenes persistentes: `db_data`, `broker_data` (hostname fijo `broker`),
  `prometheus_data` y `grafana_data`.
- `jmeter` (perfil `carga`) solo se usa para la prueba de carga y no arranca con
  `docker compose up`.

Diagrama original de la Entrega 1: [imgs/container.png](imgs/container.png).
