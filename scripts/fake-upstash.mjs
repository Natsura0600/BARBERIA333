// Imita la API REST de Upstash (mismo formato de respuesta, con base64) para probar
// el código con la librería oficial @upstash/redis sin conectarse a internet.
import http from 'node:http';

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
function codificar(r, base64) {
  if (!base64) return r;
  if (typeof r === 'string') return r === 'OK' ? 'OK' : b64(r);
  if (Array.isArray(r)) return r.map((x) => (typeof x === 'string' ? b64(x) : x));
  return r;
}

export function crearUpstashFalso() {
  const m = new Map();
  const vence = new Map();
  const vivo = (k) => { const e = vence.get(k); if (e && e < Date.now()) { m.delete(k); vence.delete(k); return false; } return m.has(k); };
  const hash = (k) => { if (!vivo(k)) m.set(k, new Map()); const h = m.get(k); if (!(h instanceof Map)) throw new Error('WRONGTYPE'); return h; };
  const comandos = {
    get: ([k]) => (vivo(k) ? m.get(k) : null),
    set: ([k, v, ...op]) => {
      const o = op.map((x) => String(x).toLowerCase());
      if (o.includes('nx') && vivo(k)) return null;
      m.set(k, String(v)); vence.delete(k);
      const i = o.indexOf('px'); if (i >= 0) vence.set(k, Date.now() + +op[i + 1]);
      return 'OK';
    },
    del: (ks) => ks.reduce((n, k) => { const h = vivo(k); m.delete(k); vence.delete(k); return n + (h ? 1 : 0); }, 0),
    incr: ([k]) => { const v = (vivo(k) ? +m.get(k) : 0) + 1; m.set(k, String(v)); return v; },
    pexpire: ([k, ms]) => { if (!vivo(k)) return 0; vence.set(k, Date.now() + +ms); return 1; },
    hget: ([k, f]) => (vivo(k) ? (m.get(k).get(String(f)) ?? null) : null),
    hset: ([k, ...fv]) => { const h = hash(k); let n = 0; for (let i = 0; i < fv.length; i += 2) { if (!h.has(String(fv[i]))) n++; h.set(String(fv[i]), String(fv[i + 1])); } return n; },
    hdel: ([k, ...fs]) => { if (!vivo(k)) return 0; const h = m.get(k); let n = 0; fs.forEach((f) => { if (h.delete(String(f))) n++; }); if (!h.size) m.delete(k); return n; },
    hgetall: ([k]) => { if (!vivo(k)) return []; const out = []; for (const [f, v] of m.get(k)) out.push(f, v); return out; },
  };
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer token-prueba') { res.statusCode = 401; return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    try {
      const cuerpo = JSON.parse(raw);
      const base64 = String(req.headers['upstash-encoding'] || '').toLowerCase() === 'base64';
      const correr = ([cmd, ...args]) => {
        const fn = comandos[String(cmd).toLowerCase()];
        if (!fn) return { error: 'ERR unknown command ' + cmd };
        try { return { result: codificar(fn(args), base64) }; } catch (e) { return { error: String(e.message) }; }
      };
      // la librería agrupa comandos en /pipeline (lista de comandos) o manda uno solo
      if (/\/(pipeline|multi-exec)$/.test(req.url) || Array.isArray(cuerpo[0])) return res.end(JSON.stringify(cuerpo.map(correr)));
      const r = correr(cuerpo);
      if (r.error) res.statusCode = 400;
      res.end(JSON.stringify(r));
    } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e.message) })); }
  });
  return srv;
}
