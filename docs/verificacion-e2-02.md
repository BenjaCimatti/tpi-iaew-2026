# Verificación E2-02 — Datos

**Fecha:** 12/11/2026. **Commit base:** `35b92fe`, cambios locales de E2-01/E2-02.
**Entorno:** macOS ARM64, Node `24.22.1`, PostgreSQL `16.15`, Prisma `7.10.1`.

| Comprobación | Resultado |
|---|---|
| Build y migración inicial | Código `0`; tablas del dominio y outbox creadas. `migrate` terminó antes de API/worker. |
| Estado y checksum | Una migración aplicada, sin pendientes; checksum coincide con el SQL local. |
| Seed inicial y repetido | **4 productos y 3 mesas**, mismos IDs/fechas; conserva modificaciones y no duplica registros. |
| Seed con conflicto, en DB aislada | Código `1`/`P2002`; rollback completo de la carga y conservación de datos previos. |
| Pruebas | **6 existentes + 2 de DB aprobadas**; las de DB incluyen 26 rechazos SQL, decimales, precios históricos, FK, unicidad y borrados protegidos. |
| Persistencia y recuperación | Copia limpia con volumen nuevo; datos conservados tras `down`/`up`. Al reiniciar DB, salud pasó de `503` a `200`. |
| Cierre y limpieza de pruebas | API/worker terminaron con código `0`; se eliminaron solo recursos aislados. Las pruebas no dejaron cambios. |

Para repetir, con los servicios levantados:

```bash
docker compose exec api npm run db:status
docker compose exec api npm run db:seed
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm run test:db
```

**Postman:** GET sin autenticación a `http://localhost:3000/health` y
`http://localhost:3001/health`: ambos `200`, con DB/broker `up`. Comprueban
conexiones, no el contenido del seed.

**Estado final:** aplicación local levantada y saludable; `.env` y volumen original conservados.
**Pendiente:** CRUD HTTP, seguridad y flujo de negocio; outbox todavía no publica eventos.
Consultas SQL, IDs y reinicialización: [README](../README.md#base-de-datos-migraciones-y-datos-de-demo).
