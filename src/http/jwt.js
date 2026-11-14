import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

export class TokenError extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

// Verificador para canales sin middleware HTTP (WebSocket). Aplica las mismas
// reglas que la API REST: firma RS256 contra el JWKS de Auth0, issuer, audience
// y expiración. Devuelve los scopes y la expiración para cerrar la conexión a tiempo.
export function createTokenVerifier(options) {
  if (!options) {
    return async () => { throw new TokenError('AUTH_NO_CONFIGURADA', 'Auth0 no está configurado en el servidor'); };
  }
  const jwks = createRemoteJWKSet(new URL(options.jwksUri));
  return async function verify(token) {
    if (typeof token !== 'string' || !token) throw new TokenError('NO_AUTORIZADO', 'Se requiere un access token');
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer: options.issuer, audience: options.audience, algorithms: ['RS256'] }));
    } catch (error) {
      if (error instanceof errors.JWTExpired) throw new TokenError('TOKEN_EXPIRADO', 'El access token expiró');
      throw new TokenError('NO_AUTORIZADO', 'Access token inválido');
    }
    if (typeof payload.exp !== 'number') throw new TokenError('NO_AUTORIZADO', 'El access token debe tener expiración');
    const scopes = new Set([
      ...(typeof payload.scope === 'string' ? payload.scope.split(' ') : []),
      ...(Array.isArray(payload.permissions) ? payload.permissions : []),
    ].filter(Boolean));
    return { sub: payload.sub, scopes, expiresAt: payload.exp * 1000 };
  };
}
