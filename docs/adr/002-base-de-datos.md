# ADR 002: Motor de base de datos

## Estado
Aceptado

## Contexto
El dominio tiene entidades claramente relacionadas (Pedido -> Items -> Producto, Pedido -> OrdenCocina) y necesitamos transacciones consistentes al confirmar un pedido (validar, calcular total y cambiar estado en una sola operación).

## Decisión
Usamos **PostgreSQL** (SQL relacional).
Para E2 se eligen **Prisma ORM y Prisma Migrate `7.10.1`** para acceso a datos y migraciones; CLI, cliente y adaptador PostgreSQL se fijan en la misma versión. E2-02 incorpora esquema, migración, seed y conexión mediante Prisma.
La convención de nombres es JSON en `camelCase` y tablas/columnas SQL en `snake_case`, con mapeo explícito en Prisma.

## Alternativas consideradas
- **MongoDB (NoSQL)**: más flexible para iterar el esquema, pero las relaciones Pedido-Item-Producto y la necesidad de una transacción atómica al confirmar el pedido se resuelven mejor con integridad referencial y transacciones ACID de un motor relacional.

## Consecuencias
- Necesitamos versionar el esquema Prisma y sus migraciones SQL, y un script de seed con Prisma para productos y mesas de ejemplo.
- El `docker-compose.yml` incluye el servicio `db` con volumen persistente y healthcheck, y `migrate` como tarea previa a API/worker. El seed se ejecuta explícitamente.
- Los productos referenciados por ítems no se eliminan; sus precios históricos se guardan en los ítems. Un pedido tiene cero o una orden, con unicidad por `pedido_id`.
- El cliente se genera con la CLI en Docker; el código generado no se versiona. Node 24 ejecuta el cliente TypeScript generado sin incorporar un compilador adicional ([soporte nativo de Node](https://nodejs.org/docs/latest-v24.x/api/typescript.html)).
- El modelo de datos completo está en `docs/modelo-datos.md`.
