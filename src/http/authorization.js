import { auth, requiredScopes } from 'express-oauth2-jwt-bearer';
import { HttpError } from './errors.js';

export function createAuthorization(options) {
  const verify = options ? auth({ ...options, tokenSigningAlg: 'RS256' }) : (request, _response, next) => {
    next(request.get('authorization')
      ? new HttpError(503, 'AUTH_NO_CONFIGURADA', 'Completar Auth0 en E2-04')
      : new HttpError(401, 'NO_AUTORIZADO', 'Se requiere un access token válido'));
  };
  return (scope) => [verify, requiredScopes(scope)];
}
