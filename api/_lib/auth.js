// Ingreso al panel. Usuario y contraseña salen de las variables de entorno:
//   PANEL_USUARIO / PANEL_PASSWORD           -> un usuario
//   PANEL_USUARIOS="franco:clave1,gonza:clave2" -> usuarios extra (opcional)
//   SESSION_SECRET                           -> clave para firmar la sesión (mín. 16 caracteres)
import crypto from 'node:crypto';
import { err } from './http.js';

const COOKIE = 's333';
const DIAS = 30;

function secreto() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw err(500, 'config', 'Falta configurar SESSION_SECRET (mínimo 16 caracteres) en Vercel.');
  return s;
}
function firma(texto) { return crypto.createHmac('sha256', secreto()).update(texto).digest('base64url'); }
function iguales(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function usuarios() {
  const lista = [];
  if (process.env.PANEL_USUARIO && process.env.PANEL_PASSWORD) lista.push([process.env.PANEL_USUARIO.trim(), process.env.PANEL_PASSWORD]);
  String(process.env.PANEL_USUARIOS || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((par) => {
    const i = par.indexOf(':');
    if (i > 0) lista.push([par.slice(0, i).trim(), par.slice(i + 1)]);
  });
  return lista;
}

export function validar(usuario, password) {
  const lista = usuarios();
  if (!lista.length) throw err(500, 'config', 'Falta configurar PANEL_USUARIO y PANEL_PASSWORD en Vercel.');
  let ok = null;
  const u = String(usuario || '').trim().toLowerCase();
  for (const [uu, pp] of lista) {
    // se comparan siempre las dos cosas para no dar pistas por el tiempo de respuesta
    const a = iguales(u, uu.toLowerCase());
    const b = iguales(String(password || ''), pp);
    if (a && b) ok = uu;
  }
  return ok;
}

function leerCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) { try { out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); } catch { /* cookie rota */ } }
  });
  return out;
}

export function usuarioActual(req) {
  const tok = leerCookies(req)[COOKIE];
  if (!tok) return null;
  const [cuerpo, mac] = tok.split('.');
  if (!cuerpo || !mac) return null;
  const a = Buffer.from(mac), b = Buffer.from(firma(cuerpo));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    // si sacaste a alguien de las variables, su sesión deja de valer
    if (!usuarios().some(([uu]) => uu.toLowerCase() === String(p.u).toLowerCase())) return null;
    return p.u;
  } catch { return null; }
}

export function abrirSesion(res, usuario) {
  const cuerpo = Buffer.from(JSON.stringify({ u: usuario, exp: Date.now() + DIAS * 864e5 })).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${cuerpo}.${firma(cuerpo)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS * 86400}`);
}
export function cerrarSesion(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
export function exigirUsuario(req) {
  const u = usuarioActual(req);
  if (!u) throw err(401, 'sesion', 'Tu sesión venció. Ingresá de nuevo.');
  return u;
}
