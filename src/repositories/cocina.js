// Datos que necesita cocina para mostrar una orden sin consultar otras rutas.
const include = {
  pedido: {
    select: {
      estado: true,
      mesa: { select: { numero: true } },
      items: { select: { productoId: true, cantidad: true, producto: { select: { nombre: true } } }, orderBy: { productoId: 'asc' } },
    },
  },
};

export const getPedidoEstado = (client, id) => client.pedido.findUnique({ where: { id }, select: { id: true, estado: true } });
export const getOrdenPorPedido = (client, pedidoId) => client.ordenCocina.findUnique({ where: { pedidoId }, include });
export const getOrden = (client, id) => client.ordenCocina.findUnique({ where: { id }, include });

export const listOrdenes = (client, { estado, activas = false } = {}) => client.ordenCocina.findMany({
  where: { ...(estado ? { estado } : {}), ...(activas ? { pedido: { estado: { notIn: ['entregado', 'cancelado'] } } } : {}) },
  include,
  orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
});

export const updateOrdenEstado = (client, id, estado) => client.ordenCocina.update({ where: { id }, data: { estado }, include });
export const updatePedidoEstado = (client, id, estado) => client.pedido.update({ where: { id }, data: { estado } });

export async function lockPedido(client, id) {
  const [row] = await client.$queryRaw`SELECT id::text AS id, estado::text AS estado FROM pedido WHERE id = ${id}::uuid FOR UPDATE`;
  return row;
}

// INSERT ... ON CONFLICT (pedido_id) DO NOTHING: la unicidad de PostgreSQL
// resuelve también redeliveries concurrentes. count 0 = la orden ya existía.
export async function createOrdenSiNoExiste(client, pedidoId) {
  const { count } = await client.ordenCocina.createMany({ data: [{ pedidoId }], skipDuplicates: true });
  return { creada: count === 1, orden: await getOrdenPorPedido(client, pedidoId) };
}
