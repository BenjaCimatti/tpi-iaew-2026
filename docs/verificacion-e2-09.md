# Verificación E2-09 — Postman, pruebas y carga

**Fecha:** 14/11/2026. Cambios locales sobre `945e50c` (rama `entrega-2/asincronia`).

| Comprobación | Resultado |
|---|---|
| Colección Postman/Newman 6.2.3 | **38 requests, 59 assertions, 0 fallos** contra Auth0 real, incluido el `403` con el cliente de solo lectura. La orden de cocina apareció en el primer intento de la espera acotada. |
| Espera acotada | Con el worker detenido, la request 24 se repitió 10 veces y falló con "Sin orden tras 10 intentos: revisar worker y RabbitMQ". |
| Cobertura | Ambos CRUD, reglas de estado, confirmación, efecto eventual del worker, cocina, entrega, `401` (sin token y alterado), `403`, API key inválida, producto inexistente/no disponible, cantidad inválida, reconfirmación y conflicto de borrado. |
| Pruebas automatizadas | `npm test` 24/24, `test:db` 3/3, `test:api` 3/3: cálculo del total, transiciones, atomicidad, confirmaciones concurrentes, carrera confirmar/cancelar, consumidor idempotente, gateway y métricas. |
| Carga JMeter | 20 usuarios, 120 s: **86 501 requests, 0 % de errores, p95 42 ms, 721 req/s**; 21 618 confirmaciones con orden de cocina. Reporte: [carga.md](carga.md). |

## Problemas encontrados y corregidos en la colección

1. `data` es una variable global (obsoleta) del sandbox de Postman: los scripts
   nuevos usan `body`.
2. Alterar el **último** carácter de la firma no invalida un JWT RS256: en
   base64url ese carácter solo lleva bits de relleno, y `A`/`B` decodifican la
   misma firma. La request 35 altera un carácter del medio.
