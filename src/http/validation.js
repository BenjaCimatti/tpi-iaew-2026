import { HttpError } from './errors.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function invalid(message) {
  throw new HttpError(400, 'ENTRADA_INVALIDA', message);
}

export function uuid(value, field = 'id') {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(`${field} debe ser UUID`);
  return value.toLowerCase();
}

export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Se requiere un objeto JSON');
}

export function text(value, field, required = false) {
  if (!required && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || (required && !value.trim())) invalid(`${field} debe ser texto${required ? ' no vacío' : ''}`);
  return value.trim();
}
