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
total, cambiar estado y registrar el evento `pedido.confirmado` en el outbox; el
worker genera luego la orden de cocina).

**Alcance implementado (Entrega 2):** API REST con OAuth 2.0/JWT y scopes, CRUD de
Productos y Pedidos, endpoint comparativo con `x-api-key`, confirmación con outbox,
RabbitMQ y worker de cocina, tablero WebSocket en tiempo real, logs JSON
correlacionados, Prometheus/Grafana, colección Postman y prueba de carga JMeter.
Los mozos operan con un cliente de confianza (Postman); no hay frontend completo.

| Servicio | URL |
|---|---|
| API REST | http://localhost:3000 |
| Worker: tablero y WebSocket | http://localhost:3001/tablero · `ws://localhost:3001/ws/cocina` |
| RabbitMQ Management | http://localhost:15672 |
| Grafana | http://localhost:3002 |
| Prometheus | http://localhost:9090 |

## Arquitectura en un vistazo

Ver diagramas C4 completos en `docs/c4/`:
- [`context.md`](docs/c4/context.md) — actores y Auth0 (emite tokens; la API los valida localmente con JWKS).
- [`container.md`](docs/c4/container.md) — api, worker (consumidor + gateway WebSocket), migrate, PostgreSQL, RabbitMQ, Prometheus y Grafana.
- [`component.md`](docs/c4/component.md) — componentes internos de la API y del worker.

```
Postman ─► api :3000 ─(transacción: pedido + outbox)─► PostgreSQL
              │ publisher confirms
              ▼
          RabbitMQ ─► worker :3001 ─► orden_cocina ─► WebSocket ─► tablero
              ▲                                         ▲
api (cocina/entrega) ─ orden.actualizada ───────────────┘
Prometheus ◄─ /metrics (api, worker) ─► Grafana :3002
```

Decisiones técnicas documentadas como ADRs en [`docs/adr/`](docs/adr/):
1. [Estilo de API (REST + WebSocket)](docs/adr/001-estilo-api.md)
2. [Base de datos (PostgreSQL)](docs/adr/002-base-de-datos.md)
3. [Seguridad (Auth0 + OAuth 2.0/JWT + API key)](docs/adr/003-seguridad.md)
4. [Broker de asincronía (RabbitMQ)](docs/adr/004-broker-asincronia.md)
5. [Consistencia: outbox transaccional y consumidor idempotente](docs/adr/005-outbox-consistencia.md)
6. [Observabilidad (pino, Prometheus, Grafana)](docs/adr/006-observabilidad.md)

Contratos asíncronos: [eventos RabbitMQ](docs/eventos.md) y [WebSocket](docs/websocket.md).

Modelo de datos: [`docs/modelo-datos.md`](docs/modelo-datos.md).
Contrato de API: [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.1).

## Requisitos previos

- Docker y Docker Compose, con el motor iniciado (por ejemplo, Docker Desktop).
- Node.js `24.22.1` (solo para desarrollo fuera de Docker; versión en `.nvmrc`).
- Una cuenta gratuita en [Auth0](https://auth0.com) (o equivalente) para la Entrega 2.

## Variables de entorno

Desde la raíz del repositorio, copiar `.env.example` a `.env` y completar los
valores. Si ya existe `.env`, conservarlo para no sobrescribir la configuración local:

```bash
cp .env.example .env
```

| Variable | Descripción |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Inicialización de PostgreSQL; deben coincidir con `DATABASE_URL` |
| `DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | Credenciales locales del broker; deben coincidir con `RABBITMQ_URL` |
| `RABBITMQ_URL` | Cadena de conexión al broker |
| `PORT` / `WORKER_PORT` | Puertos para ejecución con npm; Compose fija `3000` y `3001` respectivamente |
| `LOG_LEVEL` | Nivel de logs JSON; por defecto `info` |
| `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` | Datos de la API configurada en Auth0 |
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | Credenciales del cliente Machine to Machine |
| `API_KEY` | Clave de ejemplo para el endpoint protegido con `x-api-key` |

## Configuración de Auth0 — E2-04

1. En el Dashboard, ir a **Applications → APIs → Create API** y usar:

   | Campo | Valor |
   |---|---|
   | Name | `Pedidos Restaurante API` |
   | Identifier / audience | `https://api.pedidos-restaurante.local` (sin barra final) |
   | Signing Algorithm | `RS256` |

   El Identifier identifica la API dentro del token; no tiene que ser una URL
   pública ni coincidir con `http://localhost:3000`.

2. En **Permissions** de esa API, agregar estos scopes con sus descripciones:

   | Scope | Descripción |
   |---|---|
   | `read:pedidos` | Consultar productos y pedidos |
   | `write:pedidos` | Crear, editar, eliminar y cancelar pedidos pendientes |
   | `confirm:pedidos` | Confirmar pedidos |
   | `admin:productos` | Administrar productos |
   | `read:cocina` | Consultar cocina |
   | `write:cocina` | Actualizar estados de cocina |

3. Crear en **Applications → Applications** una aplicación **Machine to Machine**
   llamada `Pedidos Restaurante Postman`, elegir esta API y autorizar los seis
   scopes. Si ya existe una aplicación M2M de prueba para esta API, se puede reutilizar.

4. En Settings de la aplicación, copiar Domain, Client ID y Client Secret al `.env`
   local: `AUTH0_DOMAIN` (solo dominio, sin `https://` ni barra final),
   `AUTH0_CLIENT_ID` y `AUTH0_CLIENT_SECRET`. Conservar
   `AUTH0_AUDIENCE=https://api.pedidos-restaurante.local`. La API verifica contra
   el issuer `https://<AUTH0_DOMAIN>/` y el JWKS de ese mismo dominio.

5. En Postman, importar la colección y un entorno basado en
   [auth0.example.postman_environment.json](postman/auth0.example.postman_environment.json).
   Completar localmente `auth0Domain`, `auth0ClientId`, `auth0ClientSecret`,
   `auth0Audience` y `apiKey` con los valores de `.env`, y seleccionar ese entorno.
   Si existe `postman/auth0.local.postman_environment.json`, ya contiene la
   configuración privada de este equipo y puede importarse directamente.
   Ese archivo contiene secretos: está excluido de Git y no se debe compartir.
   Importar la colección sola no carga `.env`. En el selector de entorno de arriba
   a la derecha elegir **TPI — Auth0 local (privado)**; no dejar **No environment**
   ni seleccionar el entorno de ejemplo vacío. Si aparece `https:///oauth/token`,
   falta el valor activo de `auth0Domain`. Se puede comprobar pasando el cursor
   sobre `{{auth0Domain}}` en la URL de la request **00**.
   `accessToken` se completa automáticamente en la colección; no crear una variable
   homónima en el entorno porque ocultaría el token obtenido.

6. Ejecutar **00 Obtener token Auth0**: hace `POST https://<dominio>/oauth/token`
   con `grant_type: client_credentials`. Debe devolver `200`, `access_token`,
   `token_type: Bearer` y `expires_in`. El script guarda el token sin imprimirlo.
   Después de cambiar `.env`, recrear API con `docker compose up -d api`.
   Ejecutar el resto de la colección en orden (ver [Postman](#colección-postman-y-prueba-de-carga--e2-09)).

Para comprobar `403`, crear otro cliente M2M autorizado **únicamente** con
`read:pedidos` y completar `auth0ReadonlyClientId`/`auth0ReadonlyClientSecret` en
el entorno privado: las requests **36–37** obtienen ese token y verifican el `403`
al confirmar un pedido. Sin esas variables, 36–37 se omiten.
Cambiar solo `auth0Scopes` no garantiza un token reducido: en el tenant probado,
Auth0 devuelve todos los permisos autorizados al cliente. No compartir ni
versionar Client Secret o access tokens; los JSON de ejemplo conservan valores vacíos.

El tenant real y el recorrido completo ya se verificaron: **38 requests y
59 assertions sin fallos** (E2-09). Además, el cliente de solo lectura consulta con `200`
y recibe `403` al intentar crear un producto. El detalle de pruebas negativas está en
[verificación E2-04](docs/verificacion-e2-04.md).
Referencias: [API y firma](https://auth0.com/docs/get-started/apis/api-settings),
[permisos](https://auth0.com/docs/get-started/apis/add-api-permissions) y
[flujo M2M](https://auth0.com/docs/get-started/authentication-and-authorization-flow/client-credentials-flow/call-your-api-using-the-client-credentials-flow).

## Ejecución local

Los valores de ejemplo de PostgreSQL y RabbitMQ permiten levantar API y worker.
Las conexiones dentro de Docker usan `db` y `broker`, no `localhost`. Los puertos
`3000`, `3001`, `3002`, `5432`, `5672`, `9090` y `15672` deben estar libres en el equipo.

Auth0 sigue siendo un **servicio externo**: Compose no lo despliega. La obtención
de tokens y la consulta de JWKS requieren conectividad con Auth0. Los endpoints
`/` y `/health` son públicos. Los CRUD verifican JWT/scopes. Sin token responden `401`; con un Bearer
y el dominio de ejemplo todavía configurado responden `503 AUTH_NO_CONFIGURADA`.
`GET /health-protegido` requiere `x-api-key`: válida devuelve salud (`200` si las
dependencias están disponibles); ausente/incorrecta devuelve `401`. Esa clave no autoriza los CRUD.

1. Construir y levantar los servicios desde la raíz del repositorio:

   ```bash
   docker compose up --build -d
   ```

2. Revisar su estado:

   ```bash
   docker compose ps
   ```

   Deben aparecer `api`, `worker`, `db` y `broker` en ejecución y `healthy`, y `prometheus` y `grafana` en ejecución;
   si todavía están en `starting`, esperar y repetir la
   consulta. Para diagnosticar errores, usar `docker compose logs`.

   El servicio `migrate` aplica las migraciones antes de iniciar API/worker y
   termina con código `0`; es normal verlo como `Exited (0)` en
   `docker compose ps -a`. Si falla, consultar `docker compose logs migrate`.

3. Consultar [http://localhost:3000](http://localhost:3000) desde el navegador o
   la terminal:

   ```bash
   curl -i http://localhost:3000/health
   curl -i http://localhost:3001/health
   ```

   La API responde HTTP `200` con:

   ```json
   {"servicio":"api","estado":"ok","dependencias":{"db":"up","broker":"up"}}
   ```

   El worker devuelve la misma estructura con `"servicio":"worker"`. `/` también
   responde con el estado de salud. Si falla una dependencia, devuelve `503` y
   marca esa dependencia como `down`. PostgreSQL se comprueba mediante Prisma con `SELECT 1` y
   RabbitMQ mediante una conexión y un canal AMQP reales. Las aplicaciones
   reintentan conexiones cada dos segundos; el pool PostgreSQL vuelve a conectar
   en las consultas posteriores y RabbitMQ reconstruye la conexión y el canal.

4. Abrir RabbitMQ Management en
   [http://localhost:15672](http://localhost:15672). Con `.env.example`, el usuario
   y la contraseña son `restaurante` / `restaurante`; si se cambiaron, usar los
   valores de `RABBITMQ_USER` y `RABBITMQ_PASSWORD` de `.env`.

5. Detener y eliminar los contenedores y la red del proyecto:

   ```bash
   docker compose down
   ```

   Este comando conserva los volúmenes de PostgreSQL y RabbitMQ (colas y
   mensajes pendientes).

API y worker se construyen con `api/Dockerfile` y `worker/Dockerfile`. Comparten
el manifiesto, el lockfile y el código de conexión/salud en `src/`, organizado en
controller, service y repository. Ambos cierran HTTP, AMQP y el pool de DB al
recibir `SIGTERM`/`SIGINT`. El puerto `3001` es del proceso worker/gateway: sirve
`/health`, el tablero (`/tablero`) y el WebSocket (`/ws/cocina`). El worker recibe
`AUTH0_DOMAIN`/`AUTH0_AUDIENCE` para validar tokens del stream, nunca secretos M2M.

**Alcance de la comprobación:** el healthcheck solo comprueba conexiones a
DB/broker. El flujo de negocio (confirmación → RabbitMQ → orden de cocina) se
describe en [Confirmación y flujo asincrónico](#confirmación-y-flujo-asincrónico--e2-05e2-06).
El tablero WebSocket se describe en [Cocina y tablero](#cocina-y-tablero-en-tiempo-real--e2-07)
y las métricas en [Observabilidad](#observabilidad-logs-métricas-y-dashboard--e2-08).

Evidencia: [verificación de E2-01](docs/verificacion-e2-01.md),
[E2-05](docs/verificacion-e2-05.md), [E2-06](docs/verificacion-e2-06.md),
[E2-07](docs/verificacion-e2-07.md), [E2-08](docs/verificacion-e2-08.md) y
[verificación de E2-02](docs/verificacion-e2-02.md).
Ver también [verificación de E2-03](docs/verificacion-e2-03.md).
Seguridad: [verificación de E2-04](docs/verificacion-e2-04.md).
Registro histórico de Entrega 1: [verificación del esqueleto](docs/verificacion-esqueleto.md).

## Base de datos, migraciones y datos de demo

`docker compose up --build -d` aplica automáticamente las migraciones pendientes
mediante el servicio `migrate`. No borra las tablas ni carga datos de demo cada vez
que arranca. El SQL versionado está en `prisma/migrations/`.

Con los servicios levantados, cargar el seed y consultar el estado del esquema:

```bash
docker compose exec api npm run db:seed
docker compose exec api npm run db:status
```

El seed crea cuatro productos y tres mesas. Se puede repetir: no duplica los IDs
ni sobrescribe precios, nombres o estados existentes. Se ejecuta en una transacción;
si hay un conflicto con datos existentes, falla y revierte esa ejecución completa.
No crea pedidos confirmados ni órdenes de cocina simuladas.

| Producto | ID fijo | Precio inicial |
|---|---|---|
| Milanesa napolitana | `a1c9f0e0-2222-4a2b-9c3d-000000000001` | 8500.00 |
| Hamburguesa completa | `a1c9f0e0-2222-4a2b-9c3d-000000000002` | 7500.00 |
| Papas fritas | `a1c9f0e0-2222-4a2b-9c3d-000000000003` | 3500.00 |
| Agua mineral | `a1c9f0e0-2222-4a2b-9c3d-000000000004` | 1500.00 |

Las mesas 1, 2 y 3 tienen los IDs `b3f1a2e0-1111-4a2b-9c3d-000000000001`,
`b3f1a2e0-1111-4a2b-9c3d-000000000002` y
`b3f1a2e0-1111-4a2b-9c3d-000000000003` respectivamente, con capacidades 4, 4 y 6.

Para consultar los datos directamente, sin depender de endpoints todavía pendientes:

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, nombre, precio FROM producto ORDER BY nombre; SELECT id, numero, capacidad FROM mesa ORDER BY numero;"'
```

Para volver a aplicar migraciones pendientes de forma explícita:

```bash
docker compose exec api npm run db:migrate
```

Para reinicializar **toda la base local** con datos de demo desde cero:

**Esto borra todos los datos de los volúmenes del proyecto, incluidos los
pedidos y los mensajes pendientes en RabbitMQ.
No hace falta hacerlo para repetir el seed ni para actualizar migraciones.**

```bash
docker compose down --volumes
docker compose up --build -d
docker compose exec api npm run db:seed
```

### Salud desde Postman

Usar **GET** y **Authorization → No Auth**:

| Consulta | Resultado esperado |
|---|---|
| `http://localhost:3000/health` | `200`, servicio `api`, `estado: ok`, DB/broker `up` |
| `http://localhost:3001/health` | `200`, servicio `worker`, `estado: ok`, DB/broker `up` |

Estas consultas comprueban conexiones, no el contenido de las tablas. Las
verificaciones de migraciones, seed e integridad se hacen con los comandos de DB
y pruebas de la sección siguiente.

## CRUD y Postman — E2-03

| Recurso | Operaciones | Scope |
|---|---|---|
| Productos | `GET /productos`, `GET /productos/{productoId}` | `read:pedidos` |
| Productos | `POST /productos`, `PUT /productos/{productoId}`, `PATCH /productos/{productoId}`, `DELETE /productos/{productoId}` | `admin:productos` |
| Pedidos | `GET /pedidos`, `GET /pedidos/{pedidoId}` | `read:pedidos` |
| Pedidos | `POST /pedidos`, `PUT /pedidos/{pedidoId}`, `DELETE /pedidos/{pedidoId}` | `write:pedidos` |
| Cancelación | `POST /pedidos/{pedidoId}/cancelar` | `write:pedidos` |

Crear devuelve `201` con `Location`; consultar/editar/cancelar, `200`; eliminar,
`204`. Los UUID, cantidades, importes, JSON y estados se validan. Los errores
devuelven `codigo`, `mensaje` y `correlationId`; el header `x-correlation-id`
acepta un UUID o se genera automáticamente. Los conflictos devuelven `409`.

Para modificar solo el precio, usar `PATCH /productos/{productoId}` con Body raw/JSON:

```json
{ "precio": 1800 }
```

Devuelve `200` con el producto actualizado y conserva sus otros campos. Requiere
`admin:productos`; acepta únicamente `precio`, numérico, no negativo y con hasta
dos decimales. La request **07 Modificar precio del catálogo** ya usa este formato.
`PUT` requiere nombre y precio; conserva descripción, categoría y disponibilidad
si se omiten. Para vaciar descripción o categoría, enviar explícitamente `null`.

Solo se editan, eliminan o cancelan pedidos `pendiente`. Cancelar conserva el
registro. PUT reemplaza mesa e ítems; conserva el precio capturado de productos
retenidos y toma el precio actual de productos nuevos. Los precios unitarios,
total y estado enviados en el body no alteran los valores calculados por el
servidor. No repetir el mismo producto en los ítems.

Importar [la colección](postman/pedidos-restaurante.postman_collection.json) en Postman,
seleccionar el entorno privado y ejecutarla en orden (detalle en
[Colección Postman y prueba de carga](#colección-postman-y-prueba-de-carga--e2-09)).
Las requests **00–20** cubren token, ambos CRUD y API key.
Comprueba persistencia, precios históricos, conflicto de borrado y rechazos. `baseUrl`
es `http://localhost:3000`; `mesaId` usa la mesa 1 del seed. La colección captura
los IDs de los recursos que crea y los elimina al terminar el recorrido exitoso.

La request **00** guarda el token para las siguientes. Abrir **Scripts → Post-response**
para ver sus comprobaciones y **Test Results** para ver los resultados.
Los `400`/`401`/`409` previstos también deben pasar sus assertions; no son fallos del recorrido.

Para comprobar cancelación manualmente, crear un pedido y ejecutar
`POST /pedidos/{pedidoId}/cancelar`: devuelve `200` y estado `cancelado`.
Intentar editarlo, eliminarlo o cancelarlo otra vez devuelve `409`.

## Confirmación y flujo asincrónico — E2-05/E2-06

`POST /pedidos/{pedidoId}/confirmar` (scope `confirm:pedidos`) confirma un pedido
`pendiente` en una única transacción: valida ítems y productos disponibles,
calcula el total con los precios capturados, guarda estado/total/`confirmadoEn`
y registra el evento `pedido.confirmado` en la tabla `outbox`. Responde `200`
con el pedido confirmado; reconfirmar, pedido cancelado, sin ítems o con un
producto no disponible devuelven `409` sin modificar nada.

```
API ──(misma transacción)──► pedido + outbox ──► publicador ──► RabbitMQ
                                                                 │ restaurante.eventos
                                                                 ▼ pedido.confirmado
                         orden_cocina (recibida) ◄── worker ◄── cocina.pedido-confirmado
                                                                 │ fallidos
                                                                 ▼
                                                     cocina.pedido-confirmado.dlq
```

La orden de cocina se crea **después**, en el worker (consistencia eventual):
la transacción SQL no incluye al broker. Garantías:

- El evento se marca publicado solo tras la confirmación de RabbitMQ. Con el
  broker caído, la confirmación del pedido funciona igual y el evento se publica
  al volver el broker.
- El worker hace ACK después de guardar la orden. Un evento repetido no crea
  otra orden (unicidad de `orden_cocina.pedido_id`).
- Mensajes inválidos o de pedidos inexistentes van directo a la DLQ. Fallos
  transitorios (DB caída) se reintentan hasta 10 veces con espera creciente
  (~75 s) y luego van a la DLQ.

Detalle del contrato y de la política de fallos: [docs/eventos.md](docs/eventos.md).

Para comprobar el efecto, confirmar un pedido y consultar la orden creada:

```bash
docker compose exec db psql -U restaurante -d restaurante   -c "select pedido_id, estado, creado_en from orden_cocina order by creado_en desc limit 5"
docker compose logs worker | grep cocina.consumir
```

La API registra `outbox.publicar` y el worker `cocina.consumir`, ambos con
`eventId`, `pedidoId` y el mismo `correlationId` del request de confirmación.
En RabbitMQ Management ([http://localhost:15672](http://localhost:15672)) se ven
la cola de cocina, su consumidor y la DLQ.

## Cocina y tablero en tiempo real — E2-07

| Operación | Ruta | Scope |
|---|---|---|
| Listar / consultar órdenes | `GET /cocina/ordenes[?estado=]`, `GET /cocina/ordenes/{ordenId}` | `read:cocina` |
| Avanzar estado | `PATCH /cocina/ordenes/{ordenId}` con `{"estado":"en_preparacion"}` o `{"estado":"lista"}` | `write:cocina` |
| Entregar pedido listo | `POST /pedidos/{pedidoId}/entregar` | `write:pedidos` |
| Tablero WebSocket | `ws://localhost:3001/ws/cocina` | `read:cocina` |

Cocina avanza `recibida → en_preparacion → lista` y el pedido acompaña
(`en_preparacion`, `listo`); el mozo lo entrega (`entregado`). Saltos o
retrocesos devuelven `409`. `write:pedidos` no modifica cocina.

**Tablero:** abrir [http://localhost:3001/tablero](http://localhost:3001/tablero),
pegar un access token con `read:cocina` (request **00** de Postman) y conectar.
Al confirmar un pedido la orden aparece en *Recibidas*; cada `PATCH` la mueve de
columna sin recargar y la entrega la retira. El token se envía en el primer
mensaje del WebSocket (no en la URL), se valida igual que en la API y la
conexión se cierra al vencer. Sin token, con token inválido o sin `read:cocina`,
la conexión se rechaza (`4408`/`4401`/`4403`). Al reconectar, el tablero recibe
el estado actual desde la DB. Contrato completo: [docs/websocket.md](docs/websocket.md).

## Colección Postman y prueba de carga — E2-09

[`postman/pedidos-restaurante.postman_collection.json`](postman/pedidos-restaurante.postman_collection.json),
**38 requests / 59 assertions**, sin datos creados a mano (usa el seed y captura
los IDs que crea):

| Requests | Cobertura |
|---|---|
| 00 | Token Auth0 (`client_credentials`) |
| 01–16 | CRUD de productos y pedidos, precios históricos, conflicto de borrado, filtro inválido, `401` sin token |
| 17–20 | API key válida/ausente/inválida y separación del JWT |
| 21–29 | Confirmación, reconfirmación `409`, **espera acotada de la orden creada por el worker** (hasta 10 × 500 ms), salto de estado `409`, cocina `en_preparacion`/`lista`, cancelación rechazada y entrega |
| 30–35 | Pedido inexistente `404`, cantidad inválida `400`, producto no disponible `409`, token alterado `401` |
| 36–37 | `403` con el cliente de solo lectura (opcional) |

Con Newman, desde la raíz:

```bash
npx newman@6.2.3 run postman/pedidos-restaurante.postman_collection.json   -e postman/auth0.local.postman_environment.json
```

**Prueba de carga (JMeter):** `bash load/run.sh` (20 usuarios, 20 s de rampa,
120 s; en Windows usar Git Bash). Obtiene el token antes de la carga y ejecuta
[`load/pedidos.jmx`](load/pedidos.jmx) con `alpine/jmeter:5.6.3` dentro de la red
de Compose. Resultado de referencia: **86 501 requests, 0 % de errores, p95 42 ms,
721 req/s**, todas las confirmaciones con orden de cocina. Escenario, objetivos
propios, interpretación y limitaciones: [docs/carga.md](docs/carga.md).

## Observabilidad: logs, métricas y dashboard — E2-08

| Servicio | URL | Acceso |
|---|---|---|
| Grafana | [http://localhost:3002](http://localhost:3002) | Lectura sin login; admin con `GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD` (`admin`/`admin` por defecto) |
| Prometheus | [http://localhost:9090](http://localhost:9090) | Sin autenticación (solo local) |
| Métricas | `http://localhost:3000/metrics`, `http://localhost:3001/metrics` | Formato Prometheus |

El dashboard **Pedidos en Restaurante — API** se provisiona desde
[`observability/`](observability/) y abre como inicio de Grafana. Muestra:

- **Latencia p95** (`histogram_quantile` sobre `http_request_duration_seconds`).
- **Throughput** en requests/segundo.
- **Error rate** = respuestas **5xx** / total. Los 4xx (validación, 401/403 y 409
  de negocio) son rechazos esperados y se muestran aparte.
- Ventana de cálculo de **1 minuto** (`rate[1m]`), con scrape cada 5 s. Se
  excluyen `/health`, `/metrics`, `/` y rutas inexistentes, para que los
  healthchecks de Docker no distorsionen los indicadores.
- Además: percentiles por ruta, confirmaciones aceptadas/rechazadas por código,
  eventos publicados/procesados, outbox pendiente, tableros conectados y
  conexión a RabbitMQ.

Las etiquetas usan la **ruta normalizada** (`/pedidos/:pedidoId`), nunca el path
con UUID. Captura bajo carga: [docs/img/dashboard-carga.png](docs/img/dashboard-carga.png).

**Logs JSON** (pino) en API y worker: `time` ISO, `level`, `servicio`,
`operacion`, `resultado`, `duracionMs` y `correlationId`. Cada request HTTP se
registra al terminar; `/health` y `/metrics` solo en nivel `debug`. El
`correlationId` del header `x-correlation-id` (o el generado) viaja en el evento
y aparece en los logs del worker:

```bash
docker compose logs api worker --no-log-prefix | grep <correlationId>
```

```json
{"level":"info","servicio":"api","operacion":"POST /pedidos","metodo":"POST","ruta":"/pedidos","status":201,"resultado":"ok","duracionMs":10.4,"correlationId":"c0f5bef9-3640-4cf4-aba8-b2724ec3f196"}
{"level":"info","servicio":"api","operacion":"POST /pedidos/:pedidoId/confirmar","metodo":"POST","ruta":"/pedidos/:pedidoId/confirmar","status":200,"resultado":"ok","duracionMs":8.7,"correlationId":"c0f5bef9-3640-4cf4-aba8-b2724ec3f196"}
{"level":"info","servicio":"api","operacion":"outbox.publicar","resultado":"publicado","eventId":"cdcf57e9-84f5-4b11-9447-58fcd145ed14","eventType":"pedido.confirmado","pedidoId":"fe8ddb3a-2482-4cb8-a2ac-d2f72efc03cc","correlationId":"c0f5bef9-3640-4cf4-aba8-b2724ec3f196","lote":1,"duracionMs":6}
{"level":"info","servicio":"worker","operacion":"cocina.consumir","messageId":"cdcf57e9-84f5-4b11-9447-58fcd145ed14","intento":1,"eventId":"cdcf57e9-84f5-4b11-9447-58fcd145ed14","pedidoId":"fe8ddb3a-2482-4cb8-a2ac-d2f72efc03cc","correlationId":"c0f5bef9-3640-4cf4-aba8-b2724ec3f196","resultado":"orden_creada","ordenId":"2a647303-
{"level":"info","servicio":"worker","operacion":"ws.difundir","resultado":"enviado","eventType":"orden.creada","eventId":"cdcf57e9-84f5-4b11-9447-58fcd145ed14","pedidoId":"fe8ddb3a-2482-4cb8-a2ac-d2f72efc03cc","correlationId":"c0f5bef9-3640-4cf4-aba8-b2724ec3f196","clientes":0}
```

## Pruebas y desarrollo

Después de construir las imágenes, ejecutar las pruebas con la misma versión de
Node usada por los servicios, sin necesitar DB/broker:

```bash
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm test
```

Con la base migrada, ejecutar además las pruebas de Prisma e integridad SQL:

```bash
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm run test:db
```

Estas pruebas usan transacciones que se revierten al terminar; no dejan pedidos,
eventos ni cambios de catálogo de prueba en la base. Los tests se montan como solo
lectura porque no forman parte de las imágenes de producción.

Para probar los CRUD HTTP con PostgreSQL y un emisor JWT/JWKS local, sin cuenta Auth0:

```bash
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm run test:api
```

Esta prueba verifica firma/issuer/audience/expiración/scopes, ambos CRUD, atomicidad
y cancelaciones concurrentes. Crea registros propios y los elimina al terminar;
no cambia el catálogo ni las mesas del seed. El emisor y sus claves solo existen
dentro del test; la API normal mantiene su configuración Auth0.

Para comprobar Auth0 real y API key, con `.env` configurado y el stack levantado:

```bash
node --env-file=.env --test test/auth0.integration.js
```

Para incluir el caso `403`, completar `AUTH0_READONLY_CLIENT_ID` y
`AUTH0_READONLY_CLIENT_SECRET` del cliente de solo lectura; sin ellas ese caso
se informa omitido. Solo consulta datos y envía un body vacío en el rechazo `403`.
Las credenciales M2M se usan desde un cliente de confianza; no se pasan a la API,
al worker ni a las imágenes, y no deben incluirse en el futuro tablero del navegador.

Para desarrollo local, usar `nvm use` (si se usa nvm), `npm ci`, `npm run db:generate`
y `npm test`. `npm run db:migrate`, `npm run db:seed` y `npm run test:db` requieren
una `DATABASE_URL` accesible desde ese proceso.
Los scripts `npm run start:api` y `npm run start:worker` cargan `.env`. Si las
dependencias corren en Docker y Node en el host, ajustar las URLs de esas
ejecuciones a `localhost`; conservar `db`/`broker` para las ejecuciones en Compose.

## Decisiones técnicas principales

Ver [`docs/adr/`](docs/adr/).

## Limitaciones conocidas y mejoras futuras

- E2-01 a E2-07 incorporan infraestructura, datos, CRUD protegidos con Auth0, API key,
  confirmación con outbox, consumidor de cocina, endpoints de cocina y tablero
  WebSocket, logs JSON correlacionados, métricas Prometheus y dashboard Grafana.
  Colección Postman de 38 requests y prueba de carga JMeter con reporte (E2-09).
- `GET /cocina/ordenes` no tiene paginación: con muchos datos acumulados la
  respuesta crece (ver [docs/carga.md](docs/carga.md#limitaciones)).
- `/metrics`, Prometheus y la lectura anónima de Grafana no tienen autenticación:
  son adecuados para el entorno local, no para exponerlos públicamente.
- El tablero solo muestra órdenes y estados; los cambios se hacen por la API
  (Postman). Un único proceso worker sirve el WebSocket: escalarlo a varias
  réplicas funcionaría (cada una tiene su cola exclusiva), pero no se probó.
- Entrega de eventos *al menos una vez*: el efecto es idempotente, no hay entrega
  exactamente una vez. Los mensajes en la DLQ se revisan y reprocesan manualmente
  desde RabbitMQ Management.
- Con la API y el worker levantados, ejecutar `test:api` hace que estos procesen
  los eventos de prueba; la limpieza del test lo contempla.

## Tag / release y commit de esta entrega

| Entrega | Tag | Commit |
|---|---|---|
| Entrega 1 | `v1.0.0` | `8b3aa05d8e8463ff1a8b62c14aef7604aa1032f3` |
| Entrega 2 | Pendiente: nombre a confirmar con la cátedra (`v1.0.0` ya está usado por E1) | Se registra en las notas de la release de GitHub |

Un archivo versionado no puede contener el SHA del mismo commit que lo incluye:
el SHA evaluable de la Entrega 2 es el que apunta el tag, y figura en la release.
