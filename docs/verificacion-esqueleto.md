# Verificación del esqueleto — Entrega 1

**Registro histórico:** 12/11/2026, 17:31–17:33 (Argentina).
**Commit base:** `248f766637debdc1e33d0ce190580817dd40be3a`, con cambios documentales locales.
**Entorno:** macOS ARM64, Docker `29.8.2`, Compose `v5.6.0`.

| Comprobación | Resultado |
|---|---|
| `docker compose config --quiet` | Válido; advertencia por `version` obsoleto. |
| `docker compose up -d` y `docker compose ps` | Cuatro servicios activos; DB/broker saludables. |
| HTTP en `localhost:3000` | `200`, cuerpo `API placeholder - reemplazar en Entrega 2`. |
| HTTP en `localhost:15672` | `200`; login del panel no probado. |
| Conexiones AMQP | Ninguna listada; API/worker eran `http-echo`. |
| `docker compose down` | Código `0`; contenedores/red eliminados y volumen PostgreSQL conservado. |

**Límite:** se comprobó el arranque del esqueleto, sin conexiones de aplicación a
DB/broker ni integración de negocio. El `.env` local se conservó.

Ejecución actual del proyecto: [README](../README.md#ejecución-local).
