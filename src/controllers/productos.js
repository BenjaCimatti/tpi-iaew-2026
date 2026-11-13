import { Router } from 'express';

export const productoJSON = (producto) => ({ ...producto, precio: Number(producto.precio) });

export function productoController(service, authorize) {
  const router = Router();
  router.get('/', ...authorize('read:pedidos'), async (_request, response) => response.json((await service.list()).map(productoJSON)));
  router.post('/', ...authorize('admin:productos'), async (request, response) => {
    const producto = await service.create(request.body);
    response.location(`/productos/${producto.id}`).status(201).json(productoJSON(producto));
  });
  router.get('/:productoId', ...authorize('read:pedidos'), async (request, response) => response.json(productoJSON(await service.get(request.params.productoId))));
  router.put('/:productoId', ...authorize('admin:productos'), async (request, response) => response.json(productoJSON(await service.update(request.params.productoId, request.body))));
  router.patch('/:productoId', ...authorize('admin:productos'), async (request, response) => response.json(productoJSON(await service.updatePrecio(request.params.productoId, request.body))));
  router.delete('/:productoId', ...authorize('admin:productos'), async (request, response) => {
    await service.delete(request.params.productoId);
    response.sendStatus(204);
  });
  return router;
}
