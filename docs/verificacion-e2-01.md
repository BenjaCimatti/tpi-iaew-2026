# Verificación E2-01 — Infraestructura

**Fecha:** 12/11/2026. **Commit base:** `35b92fe`, cambios locales sin commit propio.
**Entorno:** macOS ARM64, Docker CLI `29.9.3`, Compose `v5.7.0`, Node `24.22.1`,
PostgreSQL `16.15` y RabbitMQ `4.3.6`.

| Comprobación | Resultado |
|---|---|
| Configuración y builds propios | Código `0`; API/worker reemplazaron los dos `http-echo`. |
| Pruebas automatizadas | **6 aprobadas, 0 fallidas**: configuración, salud, errores y reconexión AMQP. |
| Estado y HTTP | Cuatro servicios saludables; ambos `/health` y el panel RabbitMQ respondieron `200`. |
| AMQP real | Dos conexiones, `api` y `worker`, con un canal cada una. |
| Dependencias apagadas al inicio y durante ejecución | `/health` respondió `503`; al recuperarlas volvió a `200`, sin reiniciar API/worker. |
| Cierre con `SIGTERM` | Ambos procesos finalizaron con código `0`. |
| Copia limpia con `.env.example` | Arranque correcto con volumen nuevo; no fue un clon de un commit que incluyera los cambios. |
| Configuración y datos locales | `.env` excluido de la imagen; volumen original conservado y recursos temporales eliminados. |

Para repetir las pruebas después del build:

```bash
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm test
```

**Límite del bloque:** conexiones de infraestructura; el worker todavía no consume
mensajes de negocio. Al cerrar esta verificación los servicios quedaron detenidos.
**Pendiente:** revisar la deprecación de `prom-client@15.1.3` al implementar E2-08.

Instrucciones y estado actual: [README](../README.md).
