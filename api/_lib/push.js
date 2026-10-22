// Notificaciones push (también al iPhone con la app instalada, iOS 16.4 o más).
// Variables: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ej. mailto:tu@mail.com)
import crypto from 'node:crypto';
import webpush from 'web-push';
import { all, setDoc, delDoc } from './store.js';

let listo = null;
function preparar() {
  if (listo !== null) return listo;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { listo = false; return listo; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:turnos@333barberia.com', pub, priv);
  listo = true;
  return listo;
}

export const clavePublica = () => process.env.VAPID_PUBLIC_KEY || '';
export const pushConfigurado = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

export async function guardarSuscripcion(sub, usuario) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) throw new Error('Suscripción inválida');
  const id = crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 32);
  await setDoc('push', id, { sub: { endpoint: sub.endpoint, keys: sub.keys }, usuario, creado: new Date().toISOString() });
  return id;
}
export async function borrarSuscripcion(endpoint) {
  const id = crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);
  await delDoc('push', id);
}

// Manda el aviso a todos los dispositivos activados. Nunca hace fallar la operación principal.
export async function avisarATodos(payload) {
  try {
    if (!preparar()) return 0;
    const subs = await all('push');
    let enviados = 0;
    const envios = Object.entries(subs).map(async ([id, s]) => {
      try {
        await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' });
        enviados++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await delDoc('push', id);
        else console.error('push', e.statusCode, e.body);
      }
    });
    await Promise.race([Promise.all(envios), new Promise((r) => setTimeout(r, 5000))]);
    return enviados;
  } catch (e) {
    console.error('push', e);
    return 0;
  }
}
