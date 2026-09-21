# C4 - Nivel 1: Context

Vista de alto nivel: quién usa el sistema y con qué sistemas externos interactúa.

```mermaid
C4Context
    title Contexto del sistema - Pedidos de Restaurante

    Person(mesero, "Mesero/Cliente", "Registra pedidos desde una mesa o toma el pedido del cliente")
    Person(cocinero, "Cocina", "Ve y actualiza el avance de preparación de los pedidos")
    Person(admin, "Administrador", "Gestiona el catálogo de productos")

    System(sistema, "Plataforma de Pedidos de Restaurante", "Permite registrar pedidos, confirmarlos, enviarlos a cocina y hacer seguimiento del avance")

    System_Ext(auth0, "Auth0", "Identity provider: emite y valida tokens OAuth 2.0 / JWT")
    System_Ext(notificaciones, "Servicio de Notificaciones (simulado)", "Recibe eventos vía webhook para avisar cambios de estado")

    Rel(mesero, sistema, "Crea y confirma pedidos", "HTTPS/JSON")
    Rel(cocinero, sistema, "Consulta y actualiza órdenes de cocina", "WebSocket / HTTPS")
    Rel(admin, sistema, "Administra productos", "HTTPS/JSON")
    Rel(sistema, auth0, "Valida tokens JWT / obtiene tokens M2M", "OAuth 2.0")
    Rel(sistema, notificaciones, "Notifica pedido confirmado / listo", "Webhook")
```

## Notas

- El "sistema" es una caja única desde este nivel: todavía no importa si es un monolito o varios servicios.
- Auth0 es el Authorization Server externo (client_credentials para clientes M2M, validación de JWT en la API).
- El servicio de notificaciones puede ser un mock simple (otro endpoint que loguea el webhook recibido) — no hace falta un proveedor real.
