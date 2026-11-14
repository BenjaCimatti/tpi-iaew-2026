import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

// Buckets en segundos: cubren desde respuestas en memoria hasta timeouts de DB.
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

// Una instancia por proceso (o por app en los tests), con su propio registry.
export function createMetrics(service, { defaults = true } = {}) {
  const registry = new Registry();
  registry.setDefaultLabels({ servicio: service });
  if (defaults) collectDefaultMetrics({ register: registry });
  const registers = [registry];
  const metrics = {
    registry,
    httpRequests: new Counter({ name: 'http_requests_total', help: 'Requests HTTP atendidos', labelNames: ['method', 'route', 'status'], registers }),
    httpDuration: new Histogram({ name: 'http_request_duration_seconds', help: 'Duración de requests HTTP', labelNames: ['method', 'route', 'status'], buckets: BUCKETS, registers }),
    confirmaciones: new Counter({ name: 'pedidos_confirmaciones_total', help: 'Confirmaciones de pedidos por resultado', labelNames: ['resultado', 'codigo'], registers }),
    eventosPublicados: new Counter({ name: 'outbox_eventos_publicados_total', help: 'Eventos del outbox confirmados por RabbitMQ', labelNames: ['event_type'], registers }),
    eventosProcesados: new Counter({ name: 'cocina_eventos_procesados_total', help: 'Eventos pedido.confirmado procesados por el worker', labelNames: ['resultado'], registers }),
    wsMensajes: new Counter({ name: 'ws_mensajes_enviados_total', help: 'Mensajes difundidos al tablero', labelNames: ['type'], registers }),
  };
  // Gauges calculados al momento del scrape.
  metrics.gauge = (name, help, collect) => new Gauge({
    name, help, registers,
    async collect() {
      try { this.set(await collect()); } catch { /* sin dato si la dependencia no responde */ }
    },
  });
  return metrics;
}

// Ruta normalizada para etiquetas: el patrón de Express (/pedidos/:pedidoId),
// nunca el path real con UUID, para no crear una serie por recurso.
// request.baseUrl no es confiable al terminar la respuesta (Express lo restaura
// cuando un error sale del router), así que el prefijo de montaje se toma de los
// primeros segmentos del path real, que en nuestras rutas son siempre fijos.
function routeLabel(request) {
  const pattern = request.route?.path;
  if (pattern === undefined) return 'no_encontrada';
  if (Array.isArray(pattern)) return pattern.includes(request.path) ? request.path : String(pattern[0]);
  const actual = request.originalUrl.split('?')[0].split('/').filter(Boolean);
  const propios = String(pattern).split('/').filter(Boolean);
  return `/${[...actual.slice(0, Math.max(0, actual.length - propios.length)), ...propios].join('/')}`;
}

const OMITIR_LOG = new Set(['/health', '/', '/metrics']);

// Mide y registra cada request al terminar la respuesta.
export function httpObservability(metrics, logger) {
  return (request, response, next) => {
    const inicio = process.hrtime.bigint();
    response.on('finish', () => {
      const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
      const labels = { method: request.method, route: routeLabel(request), status: String(response.statusCode) };
      metrics?.httpRequests.inc(labels);
      metrics?.httpDuration.observe(labels, segundos);
      const resultado = response.statusCode >= 500 ? 'error_servidor' : response.statusCode >= 400 ? 'error_cliente' : 'ok';
      const campos = {
        operacion: `${labels.method} ${labels.route}`, metodo: labels.method, ruta: labels.route, status: response.statusCode,
        resultado, duracionMs: Math.round(segundos * 1000 * 10) / 10, correlationId: request.correlationId,
      };
      // Healthchecks y scrapes cada pocos segundos: solo en nivel debug.
      const nivel = OMITIR_LOG.has(labels.route) ? 'debug' : resultado === 'error_servidor' ? 'error' : 'info';
      logger[nivel]?.(campos, 'Request HTTP atendido');
    });
    next();
  };
}

export function metricsHandler(metrics) {
  return async (_request, response) => {
    response.set('Content-Type', metrics.registry.contentType);
    response.send(await metrics.registry.metrics());
  };
}
