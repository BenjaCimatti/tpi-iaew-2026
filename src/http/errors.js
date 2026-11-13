export class HttpError extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

export function errorHandler(logger) {
  return (error, request, response, _next) => {
    let status = error.status ?? 500;
    let codigo = error.codigo;
    let mensaje = error.codigo ? error.message : undefined;
    if (error.code === 'P2025') {
      status = 404; codigo = 'NO_ENCONTRADO'; mensaje = 'Recurso inexistente';
    } else if (['P2002', 'P2003'].includes(error.code)) {
      status = 409; codigo = 'CONFLICTO_DATOS'; mensaje = 'El recurso está referenciado o entra en conflicto con datos existentes';
    } else if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code)) {
      status = 503; codigo = 'DB_NO_DISPONIBLE'; mensaje = 'Base de datos no disponible';
    }
    if (!codigo) {
      const defaults = {
        400: ['ENTRADA_INVALIDA', 'Solicitud o JSON inválido'],
        401: ['NO_AUTORIZADO', 'Se requiere un access token válido'],
        403: ['SIN_PERMISO', 'El token no tiene el scope requerido'],
        413: ['CUERPO_DEMASIADO_GRANDE', 'El cuerpo supera el tamaño permitido'],
      };
      [codigo, mensaje] = defaults[status] ?? ['ERROR_INTERNO', 'Error interno'];
    }
    if (status === 401 || error.headers?.['WWW-Authenticate']) response.set('WWW-Authenticate', error.headers?.['WWW-Authenticate'] ?? 'Bearer');
    if (status >= 500) logger.error({ code: error.code, correlationId: request.correlationId }, 'Error al atender solicitud');
    response.status(status).json({ codigo, mensaje, correlationId: request.correlationId });
  };
}
