import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { seed, productos, mesas } from '../prisma/seed.js';
import { createDatabase } from '../src/repositories/database.js';

test('Prisma: seed repetible, mapeo de nombres y precios históricos independientes', async () => {
  const database = createDatabase(process.env.DATABASE_URL, { warn() {} });
  const rollback = new Error('Revertir datos de prueba');
  try {
    await assert.rejects(database.client.$transaction(async (tx) => {
      await seed(tx);
      const counts = [await tx.producto.count(), await tx.mesa.count()];
      const producto = await tx.producto.findUniqueOrThrow({ where: { id: productos[0].id } });
      const pedido = await tx.pedido.create({
        data: {
          mesaId: mesas[0].id,
          items: { create: { productoId: producto.id, cantidad: 2, precioUnitario: producto.precio } },
        },
        include: { items: true, ordenCocina: true },
      });
      assert.equal(pedido.estado, 'pendiente');
      assert.equal(pedido.ordenCocina, null);
      assert.ok(pedido.creadoEn instanceof Date);

      await tx.producto.update({ where: { id: producto.id }, data: { precio: '0.10', nombre: 'Cambio de prueba' } });
      await seed(tx);
      assert.deepEqual([await tx.producto.count(), await tx.mesa.count()], counts);
      const existente = await tx.producto.findUniqueOrThrow({ where: { id: producto.id } });
      assert.equal(existente.nombre, 'Cambio de prueba');
      assert.equal(existente.precio.toFixed(2), '0.10');
      assert.equal(existente.creadoEn.getTime(), producto.creadoEn.getTime());
      const item = await tx.itemPedido.findUniqueOrThrow({ where: { id: pedido.items[0].id } });
      assert.equal(item.precioUnitario.toFixed(2), producto.precio.toFixed(2));
      const [sql] = await tx.$queryRaw`SELECT precio_unitario FROM item_pedido WHERE id = ${item.id}::uuid`;
      assert.equal(sql.precio_unitario.toFixed(2), item.precioUnitario.toFixed(2));

      const evento = await tx.outbox.create({
        data: {
          pedidoId: pedido.id, eventType: 'pedido.confirmado', correlationId: randomUUID(),
          payload: { pedidoId: pedido.id },
        },
      });
      assert.equal(evento.publicadoEn, null);
      assert.equal(evento.version, 1);
      assert.deepEqual(evento.payload, { pedidoId: pedido.id });
      throw rollback;
    }, { timeout: 15000 }), (error) => error === rollback);
  } finally {
    await database.close();
  }
});

test('PostgreSQL: cantidades, importes, enums, FK, unicidad y borrados protegidos', async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows: [mesa] } = await client.query('INSERT INTO mesa(numero, capacidad) VALUES ($1, 4) RETURNING id, numero', [randomInt(1000000, 2000000000)]);
    const { rows: [producto] } = await client.query("INSERT INTO producto(nombre, precio) VALUES ('Prueba transaccional', 0.10) RETURNING id");
    const { rows: [pedido] } = await client.query('INSERT INTO pedido(mesa_id) VALUES ($1) RETURNING id', [mesa.id]);
    const { rows: [item] } = await client.query('INSERT INTO item_pedido(pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, 3, 0.10) RETURNING id', [pedido.id, producto.id]);
    await client.query('INSERT INTO orden_cocina(pedido_id) VALUES ($1)', [pedido.id]);
    const { rows: [evento] } = await client.query("INSERT INTO outbox(pedido_id, event_type, correlation_id, payload) VALUES ($1, 'pedido.confirmado', $2, '{}') RETURNING id", [pedido.id, randomUUID()]);
    const { rows: [importe] } = await client.query('SELECT (cantidad * precio_unitario)::text AS total FROM item_pedido WHERE id = $1', [item.id]);
    assert.equal(importe.total, '0.30');

    const invalidos = [
      ['UPDATE producto SET precio = -1 WHERE id = $1', [producto.id], '23514'],
      ["UPDATE producto SET precio = 'NaN' WHERE id = $1", [producto.id], '23514'],
      ["UPDATE producto SET nombre = '  ' WHERE id = $1", [producto.id], '23514'],
      ['UPDATE mesa SET capacidad = 0 WHERE id = $1', [mesa.id], '23514'],
      ['UPDATE mesa SET numero = 0 WHERE id = $1', [mesa.id], '23514'],
      ['INSERT INTO mesa(numero, capacidad) VALUES ($1, 4)', [mesa.numero], '23505'],
      ['UPDATE pedido SET total = -1 WHERE id = $1', [pedido.id], '23514'],
      ["UPDATE pedido SET total = 'NaN' WHERE id = $1", [pedido.id], '23514'],
      ['UPDATE item_pedido SET cantidad = 0 WHERE id = $1', [item.id], '23514'],
      ['UPDATE item_pedido SET cantidad = -1 WHERE id = $1', [item.id], '23514'],
      ['UPDATE item_pedido SET precio_unitario = -1 WHERE id = $1', [item.id], '23514'],
      ["UPDATE item_pedido SET precio_unitario = 'NaN' WHERE id = $1", [item.id], '23514'],
      ["UPDATE mesa SET estado = 'invalido' WHERE id = $1", [mesa.id], '22P02'],
      ["UPDATE pedido SET estado = 'invalido' WHERE id = $1", [pedido.id], '22P02'],
      ["UPDATE orden_cocina SET estado = 'invalido' WHERE pedido_id = $1", [pedido.id], '22P02'],
      ['UPDATE pedido SET mesa_id = $1 WHERE id = $2', [randomUUID(), pedido.id], '23503'],
      ['UPDATE item_pedido SET producto_id = $1 WHERE id = $2', [randomUUID(), item.id], '23503'],
      ['UPDATE item_pedido SET pedido_id = $1 WHERE id = $2', [randomUUID(), item.id], '23503'],
      ['UPDATE orden_cocina SET pedido_id = $1 WHERE pedido_id = $2', [randomUUID(), pedido.id], '23503'],
      ['UPDATE outbox SET pedido_id = $1 WHERE id = $2', [randomUUID(), evento.id], '23503'],
      ['INSERT INTO orden_cocina(pedido_id) VALUES ($1)', [pedido.id], '23505'],
      ['DELETE FROM producto WHERE id = $1', [producto.id], '23503'],
      ['DELETE FROM pedido WHERE id = $1', [pedido.id], '23503'],
      ['UPDATE outbox SET version = 0 WHERE id = $1', [evento.id], '23514'],
      ["UPDATE outbox SET event_type = ' ' WHERE id = $1", [evento.id], '23514'],
      ["UPDATE outbox SET payload = '[]' WHERE id = $1", [evento.id], '23514'],
    ];
    for (const [sql, params, code] of invalidos) {
      await client.query('SAVEPOINT rechazo');
      await assert.rejects(client.query(sql, params), (error) => {
        assert.equal(error.code, code, sql);
        return true;
      });
      await client.query('ROLLBACK TO SAVEPOINT rechazo');
      await client.query('RELEASE SAVEPOINT rechazo');
    }

    const { rows: [pendiente] } = await client.query('INSERT INTO pedido(mesa_id) VALUES ($1) RETURNING id', [mesa.id]);
    await client.query('INSERT INTO item_pedido(pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, 1, 0.10)', [pendiente.id, producto.id]);
    await client.query('DELETE FROM pedido WHERE id = $1', [pendiente.id]);
    const { rows: [borrado] } = await client.query('SELECT count(*)::int AS items FROM item_pedido WHERE pedido_id = $1', [pendiente.id]);
    assert.equal(borrado.items, 0);

    const { rows: sinIndice } = await client.query(`
      SELECT c.conname FROM pg_constraint c
      WHERE c.contype = 'f' AND c.conrelid IN ('pedido'::regclass, 'item_pedido'::regclass, 'orden_cocina'::regclass, 'outbox'::regclass)
        AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])
    `);
    assert.deepEqual(sinIndice, []);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
