// Acceso a la base de datos (Upstash Redis).
// Cada colección es un hash de Redis: id -> JSON del documento.
import { Redis } from '@upstash/redis';

const P = process.env.DB_PREFIX || 'b333:';
let client = null;

// Base en memoria para probar en la compu sin Upstash (B333_MEMORY=1).
function memoria() {
  const m = new Map();
  const vence = new Map();
  const vivo = (k) => {
    const e = vence.get(k);
    if (e && e < Date.now()) { m.delete(k); vence.delete(k); return false; }
    return m.has(k);
  };
  return {
    async get(k) { return vivo(k) ? m.get(k) : null; },
    async set(k, v, o = {}) {
      if (o.nx && vivo(k)) return null;
      m.set(k, v);
      if (o.px) vence.set(k, Date.now() + o.px); else vence.delete(k);
      return 'OK';
    },
    async del(k) { const h = vivo(k); m.delete(k); vence.delete(k); return h ? 1 : 0; },
    async incr(k) { const v = (vivo(k) ? +m.get(k) : 0) + 1; m.set(k, v); return v; },
    async pexpire(k, ms) { if (vivo(k)) vence.set(k, Date.now() + ms); return 1; },
    async hget(k, f) { return vivo(k) ? (m.get(k)[f] ?? null) : null; },
    async hset(k, obj) { const h = vivo(k) ? m.get(k) : {}; let n = 0; for (const [f, v] of Object.entries(obj)) { if (!(f in h)) n++; h[f] = String(v); } m.set(k, h); return n; },
    async hdel(k, ...f) { if (!vivo(k)) return 0; const h = m.get(k); f.forEach((x) => delete h[x]); return 1; },
    // igual que Upstash sin deserializar: lista plana [campo, valor, campo, valor, ...]
    async hgetall(k) { if (!vivo(k)) return []; const out = []; for (const [f, v] of Object.entries(m.get(k))) out.push(f, v); return out; },
  };
}

export function kv() {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) client = new Redis({ url, token, automaticDeserialization: false });
  else if (process.env.B333_MEMORY === '1') client = memoria();
  else {
    throw Object.assign(new Error('Falta conectar la base de datos (Upstash) en Vercel.'), { status: 500, code: 'config', expose: true });
  }
  return client;
}

const parse = (v) => {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
};

// Upstash (sin deserializar) devuelve HGETALL como lista plana: [campo, valor, campo, valor...].
// Se acepta también el formato objeto por si cambia la librería.
function pares(h) {
  if (!h) return [];
  if (Array.isArray(h)) { const out = []; for (let i = 0; i + 1 < h.length; i += 2) out.push([String(h[i]), h[i + 1]]); return out; }
  if (typeof h === 'object') return Object.entries(h);
  return [];
}
export async function all(col) {
  const out = {};
  for (const [k, v] of pares(await kv().hgetall(P + col))) { const d = parse(v); if (d && typeof d === 'object') out[k] = d; }
  return out;
}
export async function campos(col) { return pares(await kv().hgetall(P + col)).map(([k]) => k); }
export async function getDoc(col, id) { return parse(await kv().hget(P + col, id)); }
// Cada cambio sube un número de versión: así la web pregunta "¿cambió algo?" con 1 solo comando.
async function cambio() { await kv().incr(P + 'ver'); }
export async function version() { return +(await kv().get(P + 'ver')) || 0; }
export async function setDoc(col, id, data) { await kv().hset(P + col, { [id]: JSON.stringify(data) }); await cambio(); }
export async function delDoc(col, id) { await kv().hdel(P + col, id); await cambio(); }
export async function getConfig() { return parse(await kv().get(P + 'config')); }
export async function setConfig(c) { await kv().set(P + 'config', JSON.stringify(c)); await cambio(); }

// Candado corto para que dos reservas no tomen el mismo horario a la vez.
export async function withLock(nombre, fn) {
  const key = P + 'lock:' + nombre;
  const tok = Math.random().toString(36).slice(2);
  for (let i = 0; i < 30; i++) {
    const ok = await kv().set(key, tok, { nx: true, px: 6000 });
    if (ok) {
      try { return await fn(); }
      finally { if ((await kv().get(key)) === tok) await kv().del(key); }
    }
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 150));
  }
  throw Object.assign(new Error('Otra persona está reservando en este momento. Probá de nuevo en unos segundos.'), { status: 503, code: 'busy', expose: true });
}

// Límite de intentos (login, reservas) por ventana de tiempo.
export async function permitido(nombre, limite, ventanaMs) {
  const key = P + 'rl:' + nombre;
  const n = await kv().incr(key);
  if (n === 1) await kv().pexpire(key, ventanaMs);
  return n <= limite;
}
