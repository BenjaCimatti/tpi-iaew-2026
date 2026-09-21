# C4 - Nivel 3: Component

Vista interna del contenedor **API REST** (el contenedor más relevante para el TPI).

```mermaid
C4Component
    title Componentes - API REST

    Container_Boundary(api, "API REST") {
        Component(authMw, "Auth Middleware", "Express middleware", "Valida JWT (firma, issuer, audience, expiración) y verifica scopes por endpoint. Valida x-api-key en la ruta de ejemplo")
        Component(productoCtrl, "ProductoController", "Express Router", "Expone CRUD de /productos")
        Component(pedidoCtrl, "PedidoController", "Express Router", "Expone CRUD de /pedidos y POST /pedidos/{id}/confirmar")
        Component(productoSvc, "ProductoService", "Servicio de dominio", "Reglas de negocio de productos")
        Component(pedidoSvc, "PedidoService", "Servicio de dominio", "Orquesta el flujo multi-paso: validar items, calcular total, cambiar estado, publicar evento")
        Component(repo, "Repositorios", "Capa de acceso a datos", "ProductoRepository, PedidoRepository sobre PostgreSQL")
        Component(publisher, "EventPublisher", "Cliente AMQP", "Publica pedido.confirmado en el broker")
        Component(logger, "Logger estructurado", "pino/winston", "Emite logs JSON con correlation ID para observabilidad")
    }

    ContainerDb(db, "PostgreSQL")
    ContainerQueue(broker, "RabbitMQ")
    System_Ext(auth0, "Auth0 (JWKS)")

    Rel(productoCtrl, authMw, "usa")
    Rel(pedidoCtrl, authMw, "usa")
    Rel(authMw, auth0, "obtiene claves públicas (JWKS)")
    Rel(productoCtrl, productoSvc, "usa")
    Rel(pedidoCtrl, pedidoSvc, "usa")
    Rel(productoSvc, repo, "usa")
    Rel(pedidoSvc, repo, "usa")
    Rel(pedidoSvc, publisher, "publica evento al confirmar")
    Rel(publisher, broker, "AMQP")
    Rel(repo, db, "SQL")
    Rel(pedidoCtrl, logger, "loguea request/response")
```

## Flujo multi-paso destacado (confirmar pedido)

1. `PedidoController` recibe `POST /pedidos/{id}/confirmar` con Bearer JWT (`scope: confirm:pedidos`).
2. `authMw` valida token y scope.
3. `PedidoService.confirmar(id)`:
   - Verifica que el pedido exista y no esté ya confirmado.
   - Valida que cada producto referenciado exista y esté disponible.
   - Calcula el total sumando `cantidad * precioUnitario`.
   - Cambia el estado del pedido a `confirmado`.
   - Persiste los cambios vía `PedidoRepository`.
   - Publica el evento `pedido.confirmado` vía `EventPublisher`.
4. El Worker de Cocina (fuera de este contenedor) consume el evento y genera la `OrdenCocina`.
