# Verificación E2-04 — Auth0 y API key

**Fecha:** 13/11/2026. Cambios locales sobre `35b92fe`.
**Entorno:** Docker, Node `24.22.1`, PostgreSQL y tenant Auth0 real.

| Comprobación | Resultado |
|---|---|
| OAuth real | `client_credentials` emite JWT con los seis scopes; issuer/JWKS coinciden. |
| JWT real | Consultas `200`; sin token o firma alterada, `401`. |
| Scope insuficiente real | Segundo cliente M2M con solo `read:pedidos`: `GET /productos` devuelve `200` y `POST /productos`, `403`. Pedir menos scopes al cliente principal no los redujo. |
| JWT local firmado | Expiración, issuer/audience/algoritmo incorrectos y scope insuficiente rechazados en la integración HTTP. |
| API key | `/health-protegido`: válida `200`, ausente/incorrecta `401`, configuración ausente `503`; JWT no reemplaza la clave y la clave no habilita CRUD. |
| Pruebas | 9 unitarias y 1 integración HTTP/PostgreSQL aprobadas. Auth0 real: prueba principal y subprueba de solo lectura aprobadas, sin omisiones ni fallos. |
| Postman/Newman 6.2.3 | **21 requests, 30 assertions, 0 fallos**, con Auth0 real; CRUD crea y elimina sus propios registros. |
| Importación y errores | Sin entorno, OAuth no se envía y explica qué configurar; listados con `401` fallan assertions sin provocar TypeError de `.some()`. Body raw marcado como JSON. |
| OpenAPI | Redocly 2.78.0 válido; cinco advertencias por URLs `localhost`. |
| Secretos | Sin coincidencias de secretos en archivos publicables ni logs; API sin Client Secret, `.env` ni entorno privado de Postman. Entorno local ignorado y permisos `600`. |

Repetir con el stack levantado y `.env` configurado:

```bash
node --env-file=.env --test test/auth0.integration.js
```

Postman: importar colección y entorno privado; ejecutar **00**, luego **01–20**.
El `403` real usa `AUTH0_READONLY_CLIENT_ID` y `AUTH0_READONLY_CLIENT_SECRET` de `.env`.
La seguridad del stream se verificará al implementar WebSocket en **E2-07**.
Esta evidencia no demuestra confirmación, publicación/consumo ni integración de cocina.
