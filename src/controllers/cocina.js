import { Router } from 'express';

export function cocinaController(service, authorize) {
  const router = Router();
  router.get('/ordenes', ...authorize('read:cocina'), async (request, response) => response.json(await service.listar(request.query.estado)));
  router.get('/ordenes/:ordenId', ...authorize('read:cocina'), async (request, response) => response.json(await service.obtener(request.params.ordenId)));
  router.patch('/ordenes/:ordenId', ...authorize('write:cocina'), async (request, response) => {
    response.json(await service.avanzar(request.params.ordenId, request.body, request.correlationId));
  });
  return router;
}
