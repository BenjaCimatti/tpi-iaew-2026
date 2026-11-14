# C4 - Nivel 1: Context

Quién usa el sistema y con qué sistemas externos interactúa (implementación de la Entrega 2).

```mermaid
flowchart LR
  mozo["👤 Mozo / Administrador<br/><i>usa un cliente de confianza<br/>(Postman / Newman)</i>"]
  cocina["👤 Cocina<br/><i>navegador</i>"]
  sistema["<b>Plataforma de pedidos<br/>en restaurante</b><br/>CRUD de productos y pedidos,<br/>confirmación, órdenes de cocina<br/>y tablero en tiempo real"]
  auth0["<b>Auth0</b><br/><i>sistema externo</i><br/>Authorization Server OAuth 2.0"]

  mozo -- "client_credentials<br/>(client id + secret)" --> auth0
  auth0 -- "access token JWT RS256<br/>con scopes" --> mozo
  mozo -- "REST/JSON + Bearer JWT<br/>(productos, pedidos, cocina)" --> sistema
  cocina -- "Tablero: WebSocket +<br/>token con read:cocina" --> sistema
  sistema -- "descarga y cachea las claves<br/>públicas (JWKS)" --> auth0
```

## Notas

- El sistema es una caja única en este nivel; el detalle de procesos está en
  [container.md](container.md).
- **Auth0 emite los tokens; no valida cada request.** La API y el gateway
  WebSocket validan el JWT **localmente** (firma RS256, issuer, audience,
  expiración y scopes) con las claves públicas del JWKS de Auth0, que se
  descargan y se cachean.
- Los mozos y administradores operan con un cliente M2M de confianza (Postman en
  la demo). Un frontend completo no forma parte del alcance mínimo.
- El tablero de cocina no contiene secretos: se pega un access token con
  `read:cocina`, obtenido desde ese cliente de confianza.
- **Cambio respecto de la Entrega 1:** se quitó el servicio externo de
  notificaciones por webhook. La consigna exige una sola integración adicional y
  se eligió WebSocket ([ADR 001](../adr/001-estilo-api.md)).

Diagrama original de la Entrega 1 (incluía el webhook): [imgs/context.png](imgs/context.png).
