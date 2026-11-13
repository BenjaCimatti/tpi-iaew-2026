import { Prisma } from '../generated/prisma/client.ts';
import * as repository from '../repositories/productos.js';
import { HttpError } from '../http/errors.js';
import { invalid, object, text, uuid } from '../http/validation.js';

function precioInput(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid('precio debe ser un número');
  const precio = new Prisma.Decimal(value);
  if (precio.lt(0) || precio.decimalPlaces() > 2 || precio.gt('9999999999.99')) invalid('precio debe tener hasta dos decimales y estar entre 0 y 9999999999.99');
  return precio;
}

function input(body) {
  object(body);
  const nombre = text(body.nombre, 'nombre', true);
  const precio = precioInput(body.precio);
  if (body.disponible !== undefined && typeof body.disponible !== 'boolean') invalid('disponible debe ser booleano');
  return {
    nombre, precio,
    ...(body.descripcion !== undefined && { descripcion: text(body.descripcion, 'descripcion') }),
    ...(body.categoria !== undefined && { categoria: text(body.categoria, 'categoria') }),
    ...(body.disponible !== undefined && { disponible: body.disponible }),
  };
}

export function createProductoService(client) {
  return {
    list: () => repository.listProductos(client),
    async get(id) {
      const producto = await repository.getProducto(client, uuid(id, 'productoId'));
      if (!producto) throw new HttpError(404, 'PRODUCTO_NO_ENCONTRADO', 'Producto inexistente');
      return producto;
    },
    create: (body) => repository.createProducto(client, input(body)),
    update: (id, body) => repository.updateProducto(client, uuid(id, 'productoId'), input(body)),
    updatePrecio(id, body) {
      const productoId = uuid(id, 'productoId');
      object(body);
      if (Object.keys(body).some(key => key !== 'precio')) invalid('Esta operación solo permite modificar precio');
      return repository.updateProducto(client, productoId, { precio: precioInput(body.precio) });
    },
    delete: (id) => repository.deleteProducto(client, uuid(id, 'productoId')),
  };
}
