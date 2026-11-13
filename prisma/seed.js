import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { createDatabase } from '../src/repositories/database.js';

export const productos = [
  { id: 'a1c9f0e0-2222-4a2b-9c3d-000000000001', nombre: 'Milanesa napolitana', precio: '8500.00', categoria: 'Platos' },
  { id: 'a1c9f0e0-2222-4a2b-9c3d-000000000002', nombre: 'Hamburguesa completa', precio: '7500.00', categoria: 'Platos' },
  { id: 'a1c9f0e0-2222-4a2b-9c3d-000000000003', nombre: 'Papas fritas', precio: '3500.00', categoria: 'Guarniciones' },
  { id: 'a1c9f0e0-2222-4a2b-9c3d-000000000004', nombre: 'Agua mineral', precio: '1500.00', categoria: 'Bebidas' },
];

export const mesas = [
  { id: 'b3f1a2e0-1111-4a2b-9c3d-000000000001', numero: 1, capacidad: 4 },
  { id: 'b3f1a2e0-1111-4a2b-9c3d-000000000002', numero: 2, capacidad: 4 },
  { id: 'b3f1a2e0-1111-4a2b-9c3d-000000000003', numero: 3, capacidad: 6 },
];

export async function seed(client) {
  for (const producto of productos) {
    await client.producto.upsert({ where: { id: producto.id }, create: producto, update: {} });
  }
  for (const mesa of mesas) {
    await client.mesa.upsert({ where: { id: mesa.id }, create: mesa, update: {} });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logger = pino({ base: { servicio: 'seed' } });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria');
  const database = createDatabase(process.env.DATABASE_URL, logger);
  try {
    await database.client.$transaction(seed);
    logger.info({ productos: productos.length, mesas: mesas.length }, 'Seed aplicado; registros existentes conservados');
  } catch (error) {
    logger.error({ code: error.code }, 'No se pudo aplicar el seed');
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
