import { Router } from 'express';

export const pedidoJSON = (pedido) => ({
  id: pedido.id, mesaId: pedido.mesaId, estado: pedido.estado, total: Number(pedido.total),
  items: pedido.items.map(({ productoId, cantidad, precioUnitario }) => ({ productoId, cantidad, precioUnitario: Number(precioUnitario) })),
  creadoEn: pedido.creadoEn, confirmadoEn: pedido.confirmadoEn,
});

export function pedidoController(service, authorize, cocina, metrics) {
  const router = Router();
  router.get('/', ...authorize('read:pedidos'), async (request, response) => response.json((await service.list(request.query.estado)).map(pedidoJSON)));
  router.post('/', ...authorize('write:pedidos'), async (request, response) => {
    const pedido = await service.create(request.body);
    response.location(`/pedidos/${pedido.id}`).status(201).json(pedidoJSON(pedido));
  });
  router.get('/:pedidoId', ...authorize('read:pedidos'), async (request, response) => response.json(pedidoJSON(await service.get(request.params.pedidoId))));
  router.put('/:pedidoId', ...authorize('write:pedidos'), async (request, response) => response.json(pedidoJSON(await service.update(request.params.pedidoId, request.body))));
  router.delete('/:pedidoId', ...authorize('write:pedidos'), async (request, response) => {
    await service.delete(request.params.pedidoId);
    response.sendStatus(204);
  });
  router.post('/:pedidoId/cancelar', ...authorize('write:pedidos'), async (request, response) => response.json(pedidoJSON(await service.cancel(request.params.pedidoId))));
  router.post('/:pedidoId/confirmar', ...authorize('confirm:pedidos'), async (request, response) => {
    let pedido;
    try {
      pedido = await service.confirm(request.params.pedidoId, request.correlationId);
    } catch (error) {
      // Rechazos de negocio por código; los errores internos se cuentan como ERROR_INTERNO.
      metrics?.confirmaciones.inc({ resultado: 'rechazada', codigo: error.codigo ?? 'ERROR_INTERNO' });
      throw error;
    }
    metrics?.confirmaciones.inc({ resultado: 'aceptada', codigo: 'OK' });
    response.json(pedidoJSON(pedido));
  });
  router.post('/:pedidoId/entregar', ...authorize('write:pedidos'), async (request, response) => {
    const pedidoId = await cocina.entregar(request.params.pedidoId, request.correlationId);
    response.json(pedidoJSON(await service.get(pedidoId)));
  });
  return router;
}
