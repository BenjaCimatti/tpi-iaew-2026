import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../src/repositories/database.js';
import { createCocinaService, EventoInvalido } from '../src/services/cocina.js';

test('Cocina: orden única por pedido ante redelivery concurrente y rechazos permanentes', { timeout: 20000 }, async (t) => {
  const database = createDatabase(process.env.DATABASE_URL, { warn() {} });
  const client = database.client;
  const mesa = await client.mesa.create({ data: { numero: randomInt(1000000, 2000000000), capacidad: 2 } });
  const producto = await client.producto.create({ data: { nombre: `e206-${randomUUID()}`, precio: '10.00' } });
  t.after(async () => {
    try {
      await client.ordenCocina.deleteMany({ where: { pedido: { mesaId: mesa.id } } });
      await client.pedido.deleteMany({ where: { mesaId: mesa.id } });
      await client.producto.delete({ where: { id: producto.id } });
      await client.mesa.delete({ where: { id: mesa.id } });
    } finally {
      await database.close();
    }
  });
  const pedido = (estado) => client.pedido.create({
    data: { mesaId: mesa.id, estado, items: { create: { productoId: producto.id, cantidad: 1, precioUnitario: '10.00' } } },
  });
  const cocina = createCocinaService(client);
  const evento = (pedidoId) => ({ pedidoId });

  const confirmado = await pedido('confirmado');
  // Cinco entregas simultáneas del mismo evento: exactamente una crea la orden.
  const resultados = await Promise.all(Array.from({ length: 5 }, () => cocina.procesarPedidoConfirmado(evento(confirmado.id))));
  assert.equal(resultados.filter((r) => r.creada).length, 1);
  assert.equal(new Set(resultados.map((r) => r.orden.id)).size, 1);
  const ordenes = await client.ordenCocina.findMany({ where: { pedidoId: confirmado.id } });
  assert.equal(ordenes.length, 1);
  assert.equal(ordenes[0].estado, 'recibida');

  // Reentrega posterior: devuelve la misma orden sin modificarla.
  const otra = await cocina.procesarPedidoConfirmado(evento(confirmado.id));
  assert.equal(otra.creada, false);
  assert.equal(otra.orden.id, ordenes[0].id);

  await assert.rejects(cocina.procesarPedidoConfirmado(evento(randomUUID())), (e) => e instanceof EventoInvalido && e.codigo === 'PEDIDO_INEXISTENTE');
  for (const estado of ['pendiente', 'cancelado']) {
    const p = await pedido(estado);
    await assert.rejects(cocina.procesarPedidoConfirmado(evento(p.id)), (e) => e instanceof EventoInvalido && e.codigo === 'ESTADO_INCOMPATIBLE');
    assert.equal(await client.ordenCocina.count({ where: { pedidoId: p.id } }), 0);
  }
});
