# Verificación E2-03 — CRUD y contrato

**Fecha:** 12–13/11/2026. Cambios locales sobre la base `35b92fe`.
**Entorno:** Docker, Node `24.22.1`, PostgreSQL `16.15`, Prisma `7.10.1`.

| Comprobación | Resultado |
|---|---|
| Productos y Pedidos | Crear/listar/consultar/editar/eliminar por HTTP, persistidos en PostgreSQL. |
| Reglas de negocio | Precios históricos, total decimal del servidor, referencias, disponibilidad y cambios solo en `pendiente`. PATCH de producto modifica solo precio y conserva los demás campos. |
| Atomicidad y concurrencia | PUT rechazado conserva el pedido; dos cancelaciones simultáneas producen `200` y `409`. |
| Modificar precio (13/11) | PATCH con solo `precio` conserva los otros campos, incluida disponibilidad falsa. PUT conserva categoría/descripción/disponibilidad omitidas; `null` explícito vacía los campos de texto opcionales. Rechazos y persistencia comprobados por HTTP. Colección actual: 21 requests/30 assertions sin fallos con Auth0 real. |
| JWT/scopes | Firma, issuer, audience, expiración y algoritmo verificados; rechazos `401`/`403`. Emisor/JWKS de prueba local. |
| Errores | Validación `400`, inexistencia `404`, conflictos `409`; cuerpo uniforme y correlation ID. |
| Pruebas | 7 unitarias aprobadas y 1 integración HTTP con múltiples escenarios, sin registros residuales. |
| Postman/Newman | **16 requests, 22 assertions, 0 fallos**, con JWT local y PostgreSQL real. |
| OpenAPI 3.1 | Redocly `2.78.0`: válido; advertencias únicamente por URLs `localhost`. `confirmadoEn` admite `null`. |

Para repetir con los servicios levantados:

```bash
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm test
docker compose run --rm --no-deps -T -v "$PWD/test:/app/test:ro" api npm run test:api
```

Colección: [colección Postman](../postman/pedidos-restaurante.postman_collection.json) (antes `e2-03.postman_collection.json`).
**Actualización E2-04:** tenant/M2M, token real y `tokenUrl` verificados; [evidencia](verificacion-e2-04.md).
La API normal exige JWT: sin token `401`; con Bearer y Auth0 sin configurar, `503`.
API key implementada en E2-04. Confirmación, cocina y publicación siguen en sus bloques.
