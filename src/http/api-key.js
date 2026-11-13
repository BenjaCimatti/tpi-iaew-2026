import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

export function requireApiKey(key) {
  const digest = (value) => createHash('sha256').update(value).digest();
  const expected = key ? digest(key) : undefined;
  return (request, _response, next) => {
    if (!expected) return next(new HttpError(503, 'API_KEY_NO_CONFIGURADA', 'Configurar API_KEY en el servidor'));
    const supplied = request.get('x-api-key');
    if (!supplied || !timingSafeEqual(expected, digest(supplied))) {
      const error = new HttpError(401, 'API_KEY_INVALIDA', 'API key ausente o inválida');
      error.headers = { 'WWW-Authenticate': 'ApiKey' };
      return next(error);
    }
    next();
  };
}
