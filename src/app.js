import express from 'express';
import { randomUUID } from 'node:crypto';
import { healthController } from './controllers/health.js';
import { productoController } from './controllers/productos.js';
import { pedidoController } from './controllers/pedidos.js';
import { createProductoService } from './services/productos.js';
import { createPedidoService } from './services/pedidos.js';
import { errorHandler, HttpError } from './http/errors.js';
import { UUID } from './http/validation.js';
import { createAuthorization } from './http/authorization.js';
import { requireApiKey } from './http/api-key.js';

export function createApp(checkHealth, logger, { client, authorize = createAuthorization(), apiKey, onPedidoConfirmado } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    const supplied = request.get('x-correlation-id');
    request.correlationId = supplied && UUID.test(supplied) ? supplied.toLowerCase() : randomUUID();
    response.set('x-correlation-id', request.correlationId);
    next(supplied && !UUID.test(supplied) ? new HttpError(400, 'ENTRADA_INVALIDA', 'x-correlation-id debe ser UUID') : undefined);
  });
  app.use(express.json({ limit: '64kb' }));
  app.get(['/', '/health'], healthController(checkHealth));
  if (client) {
    app.get('/health-protegido', requireApiKey(apiKey), healthController(checkHealth));
    app.use('/productos', productoController(createProductoService(client), authorize));
    app.use('/pedidos', pedidoController(createPedidoService(client, { onConfirmed: onPedidoConfirmado }), authorize));
  }
  app.use((_request, response) => {
    response.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'Ruta inexistente', correlationId: _request.correlationId });
  });
  app.use(errorHandler(logger));
  return app;
}
