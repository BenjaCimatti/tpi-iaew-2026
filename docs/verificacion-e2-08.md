# Verificación E2-08 — Logs, métricas y dashboard

**Fecha:** 14/11/2026. Cambios locales sobre `26939db` (rama `entrega-2/asincronia`).
**Entorno:** Docker Desktop 29.7.2, Node `24.22.1`, Prometheus `v3.15.1`, Grafana `13.3.0`.

| Comprobación | Resultado |
|---|---|
| Recolección | Prometheus con targets `api` y `worker` en estado `up`, scrape cada 5 s. |
| Provisión | Datasource y dashboard **Pedidos en Restaurante — API** cargados desde `observability/` al iniciar Grafana, sin configuración manual. |
| Indicadores obligatorios | p95, throughput y error rate con datos reales bajo tráfico (ver capturas). Ventana `rate[1m]`; error = 5xx; 4xx aparte. |
| Etiquetas | Rutas normalizadas (`/pedidos/:pedidoId`, `/pedidos/:pedidoId/confirmar`), incluso en respuestas de error; ningún UUID en `/metrics` (prueba unitaria). |
| Logs | JSON con `time` ISO, `level`, `servicio`, `operacion`, `resultado`, `duracionMs` y `correlationId`; healthchecks en `debug`. |
| Correlación | Un `x-correlation-id` aparece en la request HTTP, la confirmación, `outbox.publicar` (API), `cocina.consumir` y `ws.difundir` (worker). |
| Dominio | Confirmaciones aceptadas/rechazadas por código, eventos publicados y procesados, outbox pendiente, tableros conectados y RabbitMQ. |
| Pruebas | `npm test`: 24/24 (métricas, logs y publicador por lote). `test:db`: 3/3. `test:api`: 3/3. |

## Tráfico de validación

Ocho clientes concurrentes durante 40 s con token real de Auth0. Cada iteración
hace dos lecturas, crea y confirma un pedido, lo reconfirma (`409` esperado) y
envía un pedido vacío (`400` esperado). **No** es la prueba de carga formal de
E2-09 (JMeter/Postman); solo valida que el dashboard refleja tráfico real.

| Ejecución | Requests | p95 | Throughput | 5xx | Outbox pendiente máx. | Demora de publicación media / máx. |
|---|---|---|---|---|---|---|
| Publicador de a un evento | 12 708 | 45,7 ms | 273,7 req/s | 0 % | 303 | 2,88 s / 5,97 s |
| Publicador por lote | 26 544 | 22,7 ms | 503,7 req/s | 0 % | 4 | 0,026 s / 1,02 s |

Capturas: [antes](img/dashboard-carga-antes.png) y [después](img/dashboard-carga.png).

## Problemas encontrados y corregidos

1. **Etiqueta de ruta incompleta en errores.** Cuando un error sale del router,
   Express restaura `baseUrl` y la etiqueta quedaba `/:pedidoId`. Ahora el prefijo
   se toma del path real y el patrón de la ruta.
2. **Error rate "sin datos".** Sin ningún 5xx la serie no existe y el panel no
   mostraba 0 %. Se usa `or vector(0)`.
3. **Outbox lento bajo carga.** El dashboard mostró 303 eventos pendientes: el
   publicador esperaba confirmación y hacía un `UPDATE` por evento. Ahora publica
   el lote, espera las confirmaciones juntas y marca con un `UPDATE`; si alguna
   falla, solo se marcan las confirmadas.

## Seguimiento por correlation ID (ejemplo real)

```bash
docker compose logs api worker --no-log-prefix | grep c0f5bef9-3640-4cf4-aba8-b2724ec3f196
```

Ver el resultado en el [README](../README.md#observabilidad-logs-métricas-y-dashboard--e2-08).
