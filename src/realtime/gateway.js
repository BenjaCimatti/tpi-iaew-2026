import { WebSocketServer } from 'ws';

export const WS_PATH = '/ws/cocina';
// Códigos de cierre de aplicación (rango 4000-4999), documentados en docs/websocket.md.
export const CIERRE = {
  ENTRADA_INVALIDA: 4400,
  NO_AUTORIZADO: 4401,
  SIN_PERMISO: 4403,
  TIMEOUT_AUTENTICACION: 4408,
};
const SCOPE = 'read:cocina';
const MAX_TIMER_MS = 2 ** 31 - 1;

// Gateway del tablero de cocina, en el mismo proceso que el worker.
// Protocolo: el cliente se conecta y envía {type:"auth", token} en los primeros
// authTimeoutMs; el token va en un mensaje y no en la URL para no quedar en logs.
// Con read:cocina recibe auth.ok, un snapshot desde la DB y luego los eventos en
// vivo. La conexión se cierra (4401) al vencer el token; puede renovarse antes
// enviando otro mensaje auth.
export function createCocinaGateway({ server, verifyToken, loadSnapshot, logger, authTimeoutMs = 5000, heartbeatMs = 30000 }) {
  const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: 16 * 1024 });
  const sesiones = new Map();

  function send(socket, mensaje) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(mensaje));
  }

  function cerrar(socket, code, codigo, mensaje) {
    send(socket, { type: 'error', codigo, mensaje });
    socket.close(code, codigo);
  }

  async function autenticar(socket, sesion, token) {
    let identidad;
    try {
      identidad = await verifyToken(token);
    } catch (error) {
      logger.warn({ operacion: 'ws.auth', resultado: 'rechazado', codigo: error.codigo ?? 'NO_AUTORIZADO' }, 'Conexión WebSocket rechazada');
      return cerrar(socket, CIERRE.NO_AUTORIZADO, error.codigo ?? 'NO_AUTORIZADO', error.codigo ? error.message : 'Access token inválido');
    }
    if (!identidad.scopes.has(SCOPE)) {
      logger.warn({ operacion: 'ws.auth', resultado: 'sin_permiso', sub: identidad.sub }, 'Conexión WebSocket sin read:cocina');
      return cerrar(socket, CIERRE.SIN_PERMISO, 'SIN_PERMISO', `El token no tiene el scope ${SCOPE}`);
    }
    const restante = identidad.expiresAt - Date.now();
    if (restante <= 0) return cerrar(socket, CIERRE.NO_AUTORIZADO, 'TOKEN_EXPIRADO', 'El access token expiró');
    clearTimeout(sesion.authTimer);
    clearTimeout(sesion.expiryTimer);
    sesion.expiryTimer = setTimeout(() => cerrar(socket, CIERRE.NO_AUTORIZADO, 'TOKEN_EXPIRADO', 'El access token expiró'), Math.min(restante, MAX_TIMER_MS));
    const renovacion = sesion.autenticada;
    sesion.autenticada = true;
    send(socket, { type: 'auth.ok', expiresAt: new Date(identidad.expiresAt).toISOString() });
    logger.info({ operacion: 'ws.auth', resultado: renovacion ? 'renovado' : 'aceptado', sub: identidad.sub, clientes: autenticados() }, 'Conexión WebSocket autenticada');
    if (renovacion) return;
    try {
      send(socket, { type: 'snapshot', ordenes: await loadSnapshot(), at: new Date().toISOString() });
    } catch (error) {
      logger.error({ operacion: 'ws.snapshot', code: error.code }, 'No se pudo cargar el estado inicial del tablero');
      send(socket, { type: 'error', codigo: 'SNAPSHOT_NO_DISPONIBLE', mensaje: 'No se pudo cargar el estado inicial' });
      socket.close(1011, 'SNAPSHOT_NO_DISPONIBLE');
    }
  }

  const autenticados = () => [...sesiones.values()].filter((s) => s.autenticada).length;

  wss.on('connection', (socket) => {
    const sesion = { autenticada: false, vivo: true };
    sesiones.set(socket, sesion);
    sesion.authTimer = setTimeout(() => cerrar(socket, CIERRE.TIMEOUT_AUTENTICACION, 'TIMEOUT_AUTENTICACION', 'Enviar {"type":"auth","token":"..."} al conectar'), authTimeoutMs);
    socket.on('pong', () => { sesion.vivo = true; });
    socket.on('message', (data, isBinary) => {
      let mensaje;
      try {
        mensaje = isBinary ? undefined : JSON.parse(data.toString('utf8'));
      } catch {
        // se trata abajo como mensaje inválido
      }
      if (mensaje?.type === 'auth') return void autenticar(socket, sesion, mensaje.token);
      if (mensaje?.type === 'ping' && sesion.autenticada) return send(socket, { type: 'pong' });
      cerrar(socket, CIERRE.ENTRADA_INVALIDA, 'ENTRADA_INVALIDA', 'Mensaje no soportado');
    });
    socket.on('close', () => {
      clearTimeout(sesion.authTimer);
      clearTimeout(sesion.expiryTimer);
      sesiones.delete(socket);
    });
    socket.on('error', () => {});
  });

  // Detecta conexiones muertas (p. ej. red caída sin cierre TCP).
  const heartbeat = setInterval(() => {
    for (const [socket, sesion] of sesiones) {
      if (!sesion.vivo) { socket.terminate(); continue; }
      sesion.vivo = false;
      socket.ping();
    }
  }, heartbeatMs).unref();

  return {
    // Difunde solo a conexiones autenticadas.
    broadcast(type, payload) {
      let enviados = 0;
      for (const [socket, sesion] of sesiones) {
        if (!sesion.autenticada) continue;
        send(socket, { type, ...payload });
        enviados++;
      }
      return enviados;
    },
    get clientes() { return autenticados(); },
    async close() {
      clearInterval(heartbeat);
      for (const socket of sesiones.keys()) socket.close(1001, 'SERVIDOR_CERRANDO');
      await new Promise((resolve) => wss.close(resolve));
      for (const socket of sesiones.keys()) socket.terminate();
    },
  };
}
