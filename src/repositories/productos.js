export const listProductos = (client) => client.producto.findMany({ orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }] });
export const getProducto = (client, id) => client.producto.findUnique({ where: { id } });
export const createProducto = (client, data) => client.producto.create({ data });
export const updateProducto = (client, id, data) => client.producto.update({ where: { id }, data });
export const deleteProducto = (client, id) => client.producto.delete({ where: { id } });
