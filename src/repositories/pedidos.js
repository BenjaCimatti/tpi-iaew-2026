const include = { items: { orderBy: { productoId: 'asc' } } };

export const listPedidos = (client, estado) => client.pedido.findMany({ where: estado ? { estado } : {}, include, orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }] });
export const getPedido = (client, id) => client.pedido.findUnique({ where: { id }, include });
export const createPedido = (client, { items, ...data }) => client.pedido.create({ data: { ...data, items: { create: items } }, include });
export const updatePedido = (client, id, { items, ...data }) => client.pedido.update({ where: { id }, data: { ...data, items: { deleteMany: {}, create: items } }, include });
export const deletePedido = (client, id) => client.pedido.delete({ where: { id } });
export const cancelPedido = (client, id) => client.pedido.update({ where: { id }, data: { estado: 'cancelado' }, include });

export async function lockPedido(client, id) {
  await client.$queryRaw`SELECT id FROM pedido WHERE id = ${id}::uuid FOR UPDATE`;
  return getPedido(client, id);
}
