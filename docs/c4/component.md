# C4 - Nivel 3: Component

## Contenedor `api`

```mermaid
flowchart TB
  req["Request HTTP"]
  subgraph http["src/http + src/observability"]
    corr["Correlation ID<br/>(acepta o genera UUID)"]
    obs["httpObservability<br/>métricas + log JSON por request"]
    auth["authorization<br/>JWT RS256/JWKS + scope"]
    apikey["api-key<br/>(solo /health-protegido)"]
    err["errorHandler<br/>codigo · mensaje · correlationId"]
  end
  subgraph ctrl["src/controllers"]
    cprod["productos"]
    cped["pedidos<br/>(CRUD, cancelar, confirmar, entregar)"]
    ccoc["cocina<br/>(listar, consultar, avanzar)"]
    chealth["health · /metrics"]
  end
  subgraph svc["src/services"]
    sprod["productos"]
    sped["pedidos<br/>confirmación multi-paso"]
    scoc["cocina (API)<br/>transiciones + evento"]
    outbox["outbox publisher<br/>lote + publisher confirms"]
  end
  subgraph repo["src/repositories (Prisma)"]
    rprod["productos"]
    rped["pedidos<br/>FOR UPDATE / FOR SHARE"]
    rcoc["cocina"]
  end
  broker["messaging/broker<br/>confirm channel + reconexión"]
  db[("PostgreSQL")]
  rmq[["RabbitMQ"]]

  req --> corr --> obs --> auth --> ctrl
  req -. "/health-protegido" .-> apikey --> chealth
  cprod --> sprod --> rprod
  cped --> sped --> rped
  cped -- entregar --> scoc
  ccoc --> scoc --> rcoc
  rprod & rped & rcoc --> db
  outbox -- "lee pendientes / marca publicados" --> db
  outbox --> broker --> rmq
  ctrl -. errores .-> err
```

### Flujo multi-paso: confirmar pedido

1. `pedidos` controller recibe `POST /pedidos/{id}/confirmar`; `authorization`
   exige `confirm:pedidos`.
2. `pedidos` service, **en una transacción**:
   - bloquea el pedido (`SELECT … FOR UPDATE`) y exige estado `pendiente`;
   - exige al menos un ítem y bloquea sus productos (`FOR SHARE`), que deben
     existir y estar disponibles;
   - calcula el total con los **precios capturados** en los ítems (Decimal);
   - guarda estado `confirmado`, total y `confirmadoEn`;
   - inserta `pedido.confirmado` en `outbox` con el correlation ID del request.
3. Cualquier rechazo (`404`/`409`) revierte todo. Tras el commit se despierta al
   publicador del outbox, que publica con confirmación de RabbitMQ y recién
   entonces marca `publicado_en`.
4. El worker consume el evento y crea la `OrdenCocina` (ver abajo).

## Contenedor `worker`

```mermaid
flowchart LR
  rmq[["RabbitMQ"]]
  subgraph worker["worker (:3001)"]
    cons["messaging/consumer<br/>ACK tras persistir · DLQ ·<br/>x-reintentos"]
    scoc["services/cocina<br/>orden idempotente + snapshot"]
    sub["messaging/tablero<br/>cola exclusiva orden.actualizada"]
    gw["realtime/gateway<br/>WebSocket /ws/cocina<br/>auth por mensaje + read:cocina"]
    jwt["http/jwt<br/>verificador JWKS"]
    page["/tablero (HTML estático)"]
  end
  db[("PostgreSQL")]
  nav["Navegador"]

  rmq -- pedido.confirmado --> cons --> scoc --> db
  cons -- "orden.creada" --> gw
  rmq -- orden.actualizada --> sub --> gw
  gw -- snapshot --> scoc
  gw --> jwt
  nav --> page
  nav <-- "WebSocket" --> gw
```

Contratos: eventos en [eventos.md](../eventos.md) y WebSocket en
[websocket.md](../websocket.md).

Diagrama original de la Entrega 1 (solo API, con publicación directa del
evento): [imgs/component.png](imgs/component.png).
