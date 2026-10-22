// POST /api/reservar — un cliente saca un turno desde la web.
import { setDoc, permitido } from './_lib/store.js';
import { cargarBase, cfg, ahora, addDays, allows, precioPara, promoOn, slotsFor, gid, fechaCorta } from './_lib/agenda.js';
import { ocupar, liberar } from './_lib/turnos.js';
import { avisarATodos } from './_lib/push.js';
import { send, fail, err, body, ip } from './_lib/http.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') throw err(405, 'metodo', 'Método no permitido');
    if (!(await permitido('res:' + ip(req), 20, 3600e3))) throw err(429, 'limite', 'Hiciste muchas reservas seguidas. Probá más tarde o escribinos por Instagram.');

    const b = body(req);
    const nombre = String(b.nombre || '').trim().slice(0, 60);
    const tel = String(b.tel || '').trim().slice(0, 25);
    const nota = String(b.nota || '').trim().slice(0, 200);
    const fecha = String(b.fecha || ''), hora = String(b.hora || '');
    if (nombre.length < 2) throw err(400, 'datos', 'Escribí tu nombre.');
    if (tel.replace(/\D/g, '').length < 8) throw err(400, 'datos', 'Revisá el WhatsApp: tiene que tener al menos 8 dígitos.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) throw err(400, 'datos', 'Elegí un día y un horario.');

    const { config, barberos, servicios } = await cargarBase();
    const sv = servicios[b.svc], bar = barberos[b.bar];
    if (!sv || sv.activo === false || !bar || bar.activo === false || !allows(sv, b.bar)) {
      throw err(400, 'servicio', 'Ese servicio no está disponible con ese barbero.');
    }
    const c = cfg(config), now = ahora();
    const max = addDays(now.fecha, Math.max(1, +c.anticipacion || 14) - 1);
    if (fecha < now.fecha || fecha > max) throw err(400, 'fecha', 'Esa fecha no está disponible para reservar.');

    const dur = +sv.duracion || 30;
    const id = gid();
    await ocupar(b.bar, fecha, { id, hora, dur, tipo: 'turno' }, null, (bloques) => {
      if (!slotsFor({ config, barbero: bar, bloques, fecha, dur, now }).includes(hora)) {
        throw err(409, 'ocupado', 'Ese horario se acaba de ocupar. Elegí otro.');
      }
    });
    const t = {
      barberoId: b.bar, servicioId: b.svc, servicio: sv.nombre, precio: precioPara(sv, fecha), efectivo: promoOn(sv, fecha),
      fecha, hora, dur, cliente: nombre, telefono: tel, nota, estado: 'confirmado', origen: 'web', creado: new Date().toISOString(),
    };
    try { await setDoc('turnos', id, t); }
    catch (e) { await liberar(b.bar, fecha, id).catch(() => {}); throw e; }

    await avisarATodos({
      title: 'Turno nuevo · ' + (bar.apodo || bar.nombre),
      body: `${nombre} · ${sv.nombre}\n${fechaCorta(fecha)}, ${hora} hs`,
      tag: 'turno-' + id,
      url: `/?app=1&fecha=${fecha}`,
    });
    send(res, 200, { turno: { id, ...t } });
  } catch (e) { fail(res, e); }
}
