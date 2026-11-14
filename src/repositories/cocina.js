export const getPedidoEstado = (client, id) => client.pedido.findUnique({ where: { id }, select: { id: true, estado: true } });
export const getOrdenPorPedido = (client, pedidoId) => client.ordenCocina.findUnique({ where: { pedidoId } });

// INSERT ... ON CONFLICT (pedido_id) DO NOTHING: la unicidad de PostgreSQL
// resuelve también redeliveries concurrentes. count 0 = la orden ya existía.
export async function createOrdenSiNoExiste(client, pedidoId) {
  const { count } = await client.ordenCocina.createMany({ data: [{ pedidoId }], skipDuplicates: true });
  return { creada: count === 1, orden: await getOrdenPorPedido(client, pedidoId) };
}
