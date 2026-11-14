# ADR 006: Observabilidad

## Estado
Aceptado (E2-08)

## Contexto
La consigna pide logs estructurados, seguimiento entre servicios y un dashboard con latencia p95, throughput y error rate. Todo debe ser reproducible con `docker compose`.

## Decisión
- **Logs JSON con pino** en API y worker: `time` ISO, `level`, `servicio`, `operacion`, `resultado`, `duracionMs` y `correlationId`. El `x-correlation-id` (aceptado o generado) se propaga al evento y a los logs del worker.
- **Métricas con prom-client** en `/metrics`: histograma de duración y contador por método, **ruta normalizada** y status; además métricas de dominio (confirmaciones, eventos, outbox pendiente, tableros conectados).
- **Prometheus v3.15.1 + Grafana 13.3.0** en Compose, con datasource y dashboard provisionados desde `observability/`.
- Error rate = 5xx / total, en ventana de 1 minuto; los 4xx (validación, permisos y 409 de negocio) se muestran aparte porque son rechazos esperados.

## Alternativas consideradas
- **Solo RabbitMQ Management + logs**: no da latencia ni error rate HTTP, que pide la consigna.
- **OpenTelemetry con trazas distribuidas**: más completo, pero es un bonus opcional y agrega un collector y un backend de trazas. El correlation ID en logs cubre el seguimiento requerido.

## Consecuencias
- Las etiquetas nunca contienen UUID (se evita una serie por recurso). Express restaura `baseUrl` cuando un error sale del router, así que la etiqueta se arma con el patrón de la ruta y los segmentos fijos del path.
- `/metrics`, Prometheus y la lectura anónima de Grafana no tienen autenticación: aptos para el entorno local de la demo, no para exponerlos públicamente.
- El dashboard permitió detectar y corregir el cuello de botella del publicador del outbox.
