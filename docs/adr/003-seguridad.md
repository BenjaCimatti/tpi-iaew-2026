# ADR 003: Estrategia de seguridad

## Estado
Aceptado

## Contexto
La consigna exige OAuth 2.0 + JWT con Auth0 (o equivalente) como esquema principal, y un endpoint de ejemplo protegido con `x-api-key` a modo comparativo.

## Decisión
- **Authorization Server:** Auth0. Se configura una API (audience `https://api.pedidos-restaurante.local`), un cliente Machine to Machine, y los scopes del dominio.
- **Flujo OAuth:** `client_credentials` — el cliente M2M obtiene un access token y lo envía como `Authorization: Bearer <token>`.
- **Validación en la API:** middleware que verifica firma (vía JWKS de Auth0), `issuer`, `audience`, expiración y que el JWT contenga el/los scopes requeridos por el endpoint.
- **Scopes definidos:**
  - `read:pedidos`
  - `write:pedidos`
  - `confirm:pedidos`
  - `admin:productos`
  - `read:cocina`
- **Comparación con API key:** se agrega `GET /health-protegido` (o similar) protegido solo con header `x-api-key`, documentado como contraste frente al esquema OAuth 2.0/JWT — no reemplaza la protección de los endpoints de negocio.

## Alternativas consideradas
- **Roles simples en JWT propio (sin Auth0)**: más rápido de armar, pero la consigna pide explícitamente un Authorization Server tipo Auth0 y el flujo `client_credentials`, así que no cumpliría el mínimo obligatorio.

## Consecuencias
- Ningún secreto real se sube al repo; se documentan nombres de variables en `.env.example`.
- El README debe explicar paso a paso cómo configurar Auth0 (API, audience, issuer, cliente M2M, scopes) y cómo obtener/usar el token — esto es checklist obligatorio.
- Endpoints sensibles (confirmar pedido, administrar productos) requieren scope específico, no solo "estar autenticado".
