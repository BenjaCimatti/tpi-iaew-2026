# ADR 001: Estilo de API principal

## Estado
Aceptado

## Contexto
La consigna exige una API REST sobre HTTP con contrato OpenAPI 3.1 como base, más una integración adicional a elegir entre Webhook, gRPC o WebSocket.

## Decisión
Usamos **REST sobre HTTP/JSON** como estilo principal para el CRUD de Productos y Pedidos, documentado con OpenAPI 3.1.
Como integración adicional elegimos **WebSocket**, para difundir en tiempo real el avance de las órdenes al tablero de cocina.

## Alternativas consideradas
- **gRPC como integración adicional**: más apropiado para comunicación servicio-a-servicio (ej. consultar stock), pero no aporta valor visible en una demo de 10 minutos frente al tablero de cocina en vivo.
- **Webhook como integración adicional**: más simple de implementar, pero el WebSocket es más vistoso en la defensa (se ve el pedido aparecer en tiempo real) y encaja naturalmente con "mostrar avance de preparación", que pide el enunciado del dominio.

## Consecuencias
- El contrato OpenAPI cubre solo la parte REST; el WebSocket se documenta en [docs/websocket.md](../websocket.md).
- El Webhook de notificaciones del diseño de E1 **se descartó**: la consigna exige una sola integración adicional.

## Implementación (E2-07)
- El gateway WebSocket vive en el **proceso `worker`** (puerto 3001), junto al consumidor de RabbitMQ: `orden.creada` se emite en memoria apenas se persiste la orden, sin otro salto de red.
- Los cambios de estado los hace la API (otro proceso); llegan al gateway como evento `orden.actualizada` por RabbitMQ, con una cola exclusiva. No se asume memoria compartida.
- Autenticación del stream: el token va en el primer mensaje (no en la URL, para no quedar en logs), se valida con JWKS igual que en la API, exige `read:cocina` y la conexión se cierra al vencer. Al conectar se envía un snapshot desde la DB, así no hace falta reenviar eventos perdidos.
- Contra: un único proceso worker atiende el WebSocket. Escalarlo a varias réplicas es posible (cada una tiene su cola exclusiva), pero no se probó.
