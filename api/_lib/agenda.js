// Reglas de la agenda: horarios, cortes, disponibilidad y precios.
// Es la misma lógica que usa la web, pero acá es la que manda.
import { getConfig, setConfig, all, setDoc, delDoc, withLock, kv, campos } from './store.js';

export const TZ = process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires';
export const DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DOWS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const pad = (n) => String(n).padStart(2, '0');
export const toMin = (t) => { const p = String(t || '0:0').split(':').map(Number); return p[0] * 60 + (p[1] || 0); };
export const toHM = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
export const overlap = (s1, d1, s2, d2) => s1 < s2 + d2 && s2 < s1 + d1;
export const weekday = (f) => { const [y, m, d] = f.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const addDays = (f, n) => {
  const [y, m, d] = f.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
};
export const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const fechaCorta = (f) => { const [, m, d] = f.split('-').map(Number); return DOWS[weekday(f)] + ' ' + d + ' ' + MES[m - 1]; };

// Fecha y minuto actuales en Argentina (Vercel corre en UTC).
export function ahora() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute) };
}

export const DEF_HOR = {};
[0, 1, 2, 3, 4, 5, 6].forEach((i) => { DEF_HOR[i] = { a: i >= 2, d: '10:00', h: '21:00', c: false, cd: '14:00', ch: '16:00' }; });
export const DEF_CFG = {
  direccion: 'Lavalle 487', ciudad: 'Luján, Buenos Aires', instagram: '333.barberia', telefono: '',
  intervalo: 30, anticipacion: 14, aviso: 30, horarios: DEF_HOR,
  anuncio: { activo: true, texto: 'Los martes el corte de cabello vale $14.000 con Gonza y $16.000 con Franco, pagando únicamente en efectivo.' },
};

export function cfg(c = {}) {
  c = c || {};
  const hor = {};
  for (let i = 0; i < 7; i++) hor[i] = { ...DEF_HOR[i], ...((c.horarios || {})[i] || {}) };
  return { ...DEF_CFG, ...c, horarios: hor, anuncio: { ...DEF_CFG.anuncio, ...(c.anuncio || {}) } };
}
export function hasCut(x) {
  return !!(x && x.a && x.c && toMin(x.cd) > toMin(x.d) && toMin(x.ch) > toMin(x.cd) && toMin(x.ch) < toMin(x.h));
}
export const allows = (s, bid) => !s.barberos || !s.barberos.length || s.barberos.includes(bid);
export const promoOn = (s, fecha) => !!(s && s.promo && s.promo.activo && fecha && weekday(fecha) === +s.promo.dia);
export const precioPara = (s, fecha) => (promoOn(s, fecha) ? +s.promo.precio : +s.precio);

// Horarios libres de un barbero para un día y una duración.
export function slotsFor({ config, barbero, bloques = [], fecha, dur, ignoreId = null, now = ahora() }) {
  if (!barbero || barbero.activo === false) return [];
  const c = cfg(config);
  const wd = weekday(fecha);
  const h = c.horarios[wd];
  if (!h || !h.a || !(barbero.dias || []).includes(wd)) return [];
  if (fecha < now.fecha) return [];
  const start = toMin(h.d), end = toMin(h.h), step = +c.intervalo || 30;
  const min = fecha === now.fecha ? now.min + (+c.aviso || 0) : -1;
  const cut = hasCut(h);
  const out = [];
  for (let t = start; t + dur <= end; t += step) {
    if (t < min) continue;
    if (cut && overlap(t, dur, toMin(h.cd), toMin(h.ch) - toMin(h.cd))) continue;
    if (bloques.some((x) => x.id !== ignoreId && overlap(t, dur, toMin(x.hora), +x.dur))) continue;
    out.push(toHM(t));
  }
  return out;
}

// Datos iniciales: se cargan solos la primera vez que se abre la web.
function semilla() {
  const promo = (p) => ({ activo: true, dia: 2, precio: p, nota: 'Pagando únicamente en efectivo' });
  return {
    config: cfg({}),
    barberos: {
      franco: { nombre: 'Franco Borelli', apodo: 'Franco', especialidad: '', dias: [2, 3, 4, 5, 6], activo: true, orden: 1 },
      gonza: { nombre: 'Gonzalo Veron', apodo: 'Gonza', especialidad: '', dias: [2, 3, 4, 5, 6], activo: true, orden: 2 },
    },
    servicios: {
      'corte-franco': { nombre: 'Corte de cabello', descripcion: '', duracion: 30, precio: 18000, barberos: ['franco'], activo: true, orden: 1, promo: promo(16000) },
      'corte-gonza': { nombre: 'Corte de cabello', descripcion: '', duracion: 30, precio: 16000, barberos: ['gonza'], activo: true, orden: 2, promo: promo(14000) },
      'cejas-franco': { nombre: 'Corte + cejas', descripcion: '', duracion: 30, precio: 21000, barberos: ['franco'], activo: true, orden: 3 },
      'cejas-gonza': { nombre: 'Corte + cejas', descripcion: '', duracion: 30, precio: 19000, barberos: ['gonza'], activo: true, orden: 4 },
      'barba-franco': { nombre: 'Corte + barba', descripcion: '', duracion: 60, precio: 26000, barberos: ['franco'], activo: true, orden: 5 },
      'barba-gonza': { nombre: 'Corte + barba', descripcion: '', duracion: 60, precio: 24000, barberos: ['gonza'], activo: true, orden: 6 },
      'completo-franco': { nombre: 'Servicio completo', descripcion: '', duracion: 60, precio: 29000, barberos: ['franco'], activo: true, orden: 7 },
      'completo-gonza': { nombre: 'Servicio completo', descripcion: '', duracion: 60, precio: 27000, barberos: ['gonza'], activo: true, orden: 8 },
      perfilado: { nombre: 'Perfilado de barba', descripcion: '', duracion: 30, precio: 8000, barberos: [], activo: true, orden: 9 },
    },
  };
}

// Reparación de una sola vez: la primera versión leía mal la base de Upstash y, al editar,
// creaba barberos y servicios con números como identificador (1, 3, 5...).
// Esos registros nunca se generan bien, así que se borran junto con los turnos que los usan.
const P = process.env.DB_PREFIX || 'b333:';
let reparado = false;
async function repararUnaVez() {
  if (reparado) return;
  if (await kv().get(P + 'fix:ids')) { reparado = true; return; }
  await withLock('reparar', async () => {
    if (await kv().get(P + 'fix:ids')) return;
    const num = (x) => /^\d+$/.test(String(x));
    for (const col of ['barberos', 'servicios']) for (const id of await campos(col)) if (num(id)) await delDoc(col, id);
    const tur = await all('turnos');
    for (const [id, t] of Object.entries(tur)) if (num(id) || num(t.barberoId) || num(t.servicioId)) await delDoc('turnos', id);
    for (const id of await campos('ocupados')) if (num(id) || num(String(id).split('_')[0])) await delDoc('ocupados', id);
    for (const id of await campos('push')) if (num(id)) await delDoc('push', id);
    await kv().set(P + 'fix:ids', '1');
  });
  reparado = true;
}

// Config + barberos + servicios. Si la base está vacía, la inicializa.
export async function cargarBase() {
  let config = await getConfig();
  if (!config) {
    await withLock('semilla', async () => {
      if (await getConfig()) return;
      const s = semilla();
      for (const [id, b] of Object.entries(s.barberos)) await setDoc('barberos', id, b);
      for (const [id, v] of Object.entries(s.servicios)) await setDoc('servicios', id, v);
      await setConfig(s.config);
    });
    config = await getConfig();
  }
  await repararUnaVez();
  const [barberos, servicios] = await Promise.all([all('barberos'), all('servicios')]);
  return { config, barberos, servicios };
}
