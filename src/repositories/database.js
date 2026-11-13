import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

export function createDatabase(url, logger) {
  const adapter = new PrismaPg({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
  }, {
    onPoolError(error) {
      logger.warn({ code: error.code }, 'Conexión inactiva a PostgreSQL perdida');
    },
  });
  const client = new PrismaClient({ adapter });
  return {
    client,
    ping: () => client.$queryRaw`SELECT 1`,
    close: () => client.$disconnect(),
  };
}
