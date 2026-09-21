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
- Necesitamos un servidor WebSocket (puede vivir en el mismo proceso que la API o en un contenedor aparte).
- El contrato OpenAPI cubre solo la parte REST; el WebSocket se documenta aparte en el README (eventos que emite, formato de mensaje).
- Si el tiempo aprieta, el Webhook queda como plan B: es la integración más rápida de armar (un POST simulado a un endpoint que loguea el payload).
