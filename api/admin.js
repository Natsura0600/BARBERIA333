// /api/admin?op=... — todo lo del panel. Requiere sesión.
import { all, getDoc, setDoc, delDoc, getConfig, setConfig, version } from './_lib/store.js';
import { cargarBase, ahora, addDays, allows, gid, toMin, fechaCorta } from './_lib/agenda.js';
import { ocupar, liberar, guardarTurno } from './_lib/turnos.js';
import { exigirUsuario } from './_lib/auth.js';
import { avisarATodos, guardarSuscripcion, borrarSuscripcion, pushConfigurado } from './_lib/push.js';
import { send, fail, err, body, query } from './_lib/http.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;
const esObjeto = (x) => x && typeof x === 'object' && !Array.isArray(x);
const texto = (x, n) => String(x == null ? '' : x).trim().slice(0, n);

async function datos() {
  const base = await cargarBase();
  const desde = addDays(ahora().fecha, -120);
  const [tur, oc] = await Promise.all([all('turnos'), all('ocupados')]);
  const turnos = {}, ocupados = {};
  for (const [k, v] of Object.entries(tur)) if (v.fecha >= desde) turnos[k] = v;
  for (const [k, v] of Object.entries(oc)) if (v.fecha >= desde) ocupados[k] = v;
  return { ...base, turnos, ocupados, hoy: ahora().fecha, ver: await version() };
}

export default async function handler(req, res) {
  try {
    const user = exigirUsuario(req);
    const op = query(req, 'op');
    if (op === 'data') {
      const v = query(req, 'v');
      if (v) { const ver = await version(); if (+v === ver && ver > 0) return send(res, 200, { same: true, ver }); }
      return send(res, 200, await datos());
    }
    if (req.method !== 'POST') throw err(405, 'metodo', 'Método no permitido');
    const b = body(req);

    if (op === 'save') {
      const { col, id, data } = b;
      if (!esObjeto(data) || JSON.stringify(data).length > 20000) throw err(400, 'datos', 'Datos inválidos.');
      if (col === 'config') {
        const actual = (await getConfig()) || {};
        await setConfig({ ...actual, ...data });
      } else if (col === 'barberos' || col === 'servicios') {
        if (!ID.test(String(id || ''))) throw err(400, 'datos', 'Identificador inválido.');
        if (!texto(data.nombre, 60)) throw err(400, 'datos', 'Falta el nombre.');
        await setDoc(col, id, data);
      } else throw err(400, 'datos', 'No se puede guardar eso.');
      return send(res, 200, { ok: true });
    }

    if (op === 'delete') {
      const { col, id } = b;
      if (!['barberos', 'servicios'].includes(col) || !ID.test(String(id || ''))) throw err(400, 'datos', 'Datos inválidos.');
      if (col === 'barberos') {
        const hoy = ahora().fecha;
        const fut = Object.values(await all('turnos')).filter((t) => t.barberoId === id && t.fecha >= hoy && t.estado !== 'cancelado').length;
        if (fut) throw err(409, 'turnos', `Tiene ${fut} turno${fut > 1 ? 's' : ''} próximos. Reasignalos o desactivalo.`);
      }
      await delDoc(col, id);
      return send(res, 200, { ok: true });
    }

    if (op === 'turno') {
      const id = b.id && ID.test(String(b.id)) ? String(b.id) : gid();
      const d = esObjeto(b.data) ? b.data : {};
      const prev = b.id ? await getDoc('turnos', id) : null;
      const { barberos, servicios } = await cargarBase();
      const t = {
        ...(prev || { origen: 'local', creado: new Date().toISOString(), cargadoPor: user }),
        barberoId: String(d.barberoId || ''), servicioId: String(d.servicioId || ''),
        servicio: texto(d.servicio, 60), precio: Math.max(0, Math.round(+d.precio || 0)), efectivo: !!d.efectivo,
        fecha: String(d.fecha || ''), hora: String(d.hora || ''), dur: Math.max(5, Math.min(480, Math.round(+d.dur || 30))),
        cliente: texto(d.cliente, 60), telefono: texto(d.telefono, 25), nota: texto(d.nota, 200),
        estado: ['confirmado', 'completado', 'cancelado'].includes(d.estado) ? d.estado : 'confirmado',
      };
      if (t.cliente.length < 2) throw err(400, 'datos', 'Escribí el nombre del cliente.');
      if (!FECHA.test(t.fecha) || !HORA.test(t.hora)) throw err(400, 'datos', 'Completá fecha y hora.');
      if (!barberos[t.barberoId]) throw err(400, 'datos', 'Elegí un barbero.');
      const sv = servicios[t.servicioId];
      if (sv && !allows(sv, t.barberoId)) throw err(400, 'datos', 'Ese servicio no lo hace ese barbero.');
      await guardarTurno(id, prev, t);
      if (prev && prev.estado !== 'cancelado' && t.estado === 'cancelado') {
        const bar = barberos[t.barberoId];
        await avisarATodos({
          title: 'Turno cancelado · ' + (bar ? bar.apodo || bar.nombre : ''),
          body: `${t.cliente} · ${t.servicio}\n${fechaCorta(t.fecha)}, ${t.hora} hs (lo canceló ${user})`,
          tag: 'turno-' + id, url: `/?app=1&fecha=${t.fecha}`,
        });
      }
      return send(res, 200, { id });
    }

    if (op === 'turno-delete') {
      const id = String(b.id || '');
      if (!ID.test(id)) throw err(400, 'datos', 'Datos inválidos.');
      const t = await getDoc('turnos', id);
      if (t && t.estado !== 'cancelado') await liberar(t.barberoId, t.fecha, id);
      await delDoc('turnos', id);
      return send(res, 200, { ok: true });
    }

    if (op === 'bloqueo') {
      const { barberos } = await cargarBase();
      const ids = (Array.isArray(b.bars) ? b.bars : []).filter((x) => barberos[x]);
      const fecha = String(b.fecha || ''), desde = String(b.desde || ''), hasta = String(b.hasta || '');
      if (!ids.length || !FECHA.test(fecha) || !HORA.test(desde) || !HORA.test(hasta)) throw err(400, 'datos', 'Completá barbero, fecha y horario.');
      const dur = toMin(hasta) - toMin(desde);
      if (dur <= 0) throw err(400, 'datos', '"Hasta" tiene que ser después de "Desde".');
      const fallas = [];
      for (const bid of ids) {
        try { await ocupar(bid, fecha, { id: gid(), hora: desde, dur, tipo: 'bloqueo', motivo: texto(b.motivo, 60) }); }
        catch (e) { if (e.code === 'ocupado') fallas.push(bid); else throw e; }
      }
      if (fallas.length === ids.length) throw err(409, 'ocupado', 'Hay turnos en ese rango. Movelos o cancelalos antes de bloquear.');
      return send(res, 200, { fallas });
    }

    if (op === 'bloqueo-delete') {
      const bar = String(b.bar || ''), fecha = String(b.fecha || ''), id = String(b.id || '');
      if (!ID.test(bar) || !FECHA.test(fecha) || !ID.test(id)) throw err(400, 'datos', 'Datos inválidos.');
      await liberar(bar, fecha, id);
      return send(res, 200, { ok: true });
    }

    if (op === 'push-subscribe') {
      if (!pushConfigurado()) throw err(400, 'push', 'Las notificaciones todavía no están configuradas en el servidor (faltan las claves VAPID).');
      try { await guardarSuscripcion(b.subscription, user); }
      catch { throw err(400, 'push', 'No se pudo registrar este dispositivo.'); }
      return send(res, 200, { ok: true });
    }
    if (op === 'push-unsubscribe') {
      await borrarSuscripcion(b.endpoint);
      return send(res, 200, { ok: true });
    }
    if (op === 'push-test') {
      const n = await avisarATodos({ title: '333 Barbería', body: 'Las notificaciones funcionan en este dispositivo.', tag: 'prueba', url: '/?app=1' });
      return send(res, 200, { enviados: n });
    }

    throw err(404, 'op', 'Operación desconocida');
  } catch (e) { fail(res, e); }
}
