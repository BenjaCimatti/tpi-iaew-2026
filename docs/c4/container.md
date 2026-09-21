# C4 - Nivel 2: Container

Vista de los "contenedores" (servicios desplegables) que componen la plataforma.

```mermaid
C4Container
    title Contenedores - Pedidos de Restaurante

    Person(mesero, "Mesero/Cliente")
    Person(cocinero, "Cocina")

    System_Boundary(sistema, "Plataforma de Pedidos") {
        Container(api, "API REST", "Node.js / Express", "Expone endpoints de productos y pedidos, valida JWT/scopes, orquesta la confirmación de pedidos")
        Container(worker, "Worker de Cocina", "Node.js", "Consume eventos pedido.confirmado desde el broker y genera la Orden de Cocina")
        Container(ws, "Gateway WebSocket", "Node.js / ws", "Difunde en tiempo real el estado de las órdenes al tablero de cocina")
        ContainerDb(db, "Base de datos", "PostgreSQL", "Persiste Productos, Pedidos, Items, Órdenes de Cocina")
        ContainerQueue(broker, "Broker de mensajes", "RabbitMQ", "Transporta el evento pedido.confirmado entre API y Worker")
    }

    System_Ext(auth0, "Auth0", "OAuth 2.0 / JWT")
    System_Ext(notif, "Notificaciones (mock)", "Webhook receiver")

    Rel(mesero, api, "CRUD productos, crear/confirmar pedidos", "HTTPS/JSON + Bearer JWT")
    Rel(cocinero, ws, "Recibe actualizaciones de órdenes", "WebSocket")
    Rel(api, db, "Lee/escribe", "SQL")
    Rel(api, auth0, "Valida JWT (JWKS) / M2M token", "HTTPS")
    Rel(api, broker, "Publica pedido.confirmado", "AMQP")
    Rel(worker, broker, "Consume pedido.confirmado", "AMQP")
    Rel(worker, db, "Crea OrdenCocina", "SQL")
    Rel(worker, ws, "Emite actualización de estado", "interno")
    Rel(worker, notif, "Notifica pedido confirmado", "Webhook")
```

## Notas

- El "Worker de Cocina" y el "Gateway WebSocket" pueden vivir en el mismo proceso al principio (simplificación válida para el TPI); igual conviene dibujarlos separados porque son responsabilidades distintas.
- El endpoint protegido con `x-api-key` (requisito de la consigna) vive dentro del mismo contenedor API, como una ruta aparte de ejemplo — no hace falta un contenedor nuevo.
