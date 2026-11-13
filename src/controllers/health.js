export function healthController(checkHealth) {
  return async (_request, response) => {
    const health = await checkHealth();
    response.status(health.estado === 'ok' ? 200 : 503).json(health);
  };
}
