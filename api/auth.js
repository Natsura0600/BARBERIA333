// /api/auth?op=session|login|logout
import { permitido } from './_lib/store.js';
import { validar, usuarioActual, abrirSesion, cerrarSesion, usuarios } from './_lib/auth.js';
import { clavePublica, pushConfigurado } from './_lib/push.js';
import { send, fail, err, body, ip, query } from './_lib/http.js';

export default async function handler(req, res) {
  try {
    const op = query(req, 'op');
    if (op === 'session') {
      let user = null;
      try { user = usuarioActual(req); } catch { user = null; }
      return send(res, 200, { user, vapid: clavePublica(), push: pushConfigurado(), configurado: usuarios().length > 0 });
    }
    if (req.method !== 'POST') throw err(405, 'metodo', 'Método no permitido');
    if (op === 'login') {
      if (!(await permitido('login:' + ip(req), 10, 15 * 60e3))) throw err(429, 'limite', 'Demasiados intentos. Esperá 15 minutos y probá de nuevo.');
      const b = body(req);
      const u = validar(b.usuario, b.password);
      if (!u) throw err(401, 'credenciales', 'Usuario o contraseña incorrectos.');
      abrirSesion(res, u);
      return send(res, 200, { user: u });
    }
    if (op === 'logout') {
      cerrarSesion(res);
      return send(res, 200, { ok: true });
    }
    throw err(404, 'op', 'Operación desconocida');
  } catch (e) { fail(res, e); }
}
