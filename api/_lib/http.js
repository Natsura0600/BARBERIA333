// Ayudas para responder JSON y manejar errores.
export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export function err(status, code, message) {
  return Object.assign(new Error(message), { status, code, expose: true });
}

export function fail(res, e) {
  const status = e.status || 500;
  if (status >= 500 && !e.expose) console.error(e);
  send(res, status, {
    error: e.expose || status < 500 ? e.message : 'Hubo un error en el servidor. Probá de nuevo.',
    code: e.code || 'error',
  });
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

export function ip(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
}

export function query(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  try { return new URL(req.url, 'http://x').searchParams.get(name) || ''; } catch { return ''; }
}
