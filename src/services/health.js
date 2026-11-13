export function createHealthService(database, broker, service) {
  return async function checkHealth() {
    let db = 'up';
    try {
      await database.ping();
    } catch {
      db = 'down';
    }
    const brokerStatus = broker.ready ? 'up' : 'down';
    return {
      servicio: service,
      estado: db === 'up' && brokerStatus === 'up' ? 'ok' : 'degradado',
      dependencias: { db, broker: brokerStatus },
    };
  };
}
