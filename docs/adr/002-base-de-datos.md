# ADR 002: Motor de base de datos

## Estado
Aceptado

## Contexto
El dominio tiene entidades claramente relacionadas (Pedido -> Items -> Producto, Pedido -> OrdenCocina) y necesitamos transacciones consistentes al confirmar un pedido (validar, calcular total y cambiar estado en una sola operación).

## Decisión
Usamos **PostgreSQL** (SQL relacional).

## Alternativas consideradas
- **MongoDB (NoSQL)**: más flexible para iterar el esquema, pero las relaciones Pedido-Item-Producto y la necesidad de una transacción atómica al confirmar el pedido se resuelven mejor con integridad referencial y transacciones ACID de un motor relacional.

## Consecuencias
- Necesitamos migraciones versionadas (ej. con Prisma, TypeORM o Knex) y un script de seed con productos y mesas de ejemplo.
- El `docker-compose.yml` incluye un servicio `postgres` con volumen persistente y healthcheck.
- El modelo de datos completo está en `docs/modelo-datos.md`.
