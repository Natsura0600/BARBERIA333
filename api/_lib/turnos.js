// Ocupar y liberar horarios en la agenda de cada barbero, con candado.
import { getDoc, setDoc, delDoc, withLock } from './store.js';
import { toMin, overlap } from './agenda.js';
import { err } from './http.js';

const clave = (bid, fecha) => `${bid}_${fecha}`;

// Ocupa un bloque. `revisar(bloques)` puede tirar error si el horario no corresponde.
export async function ocupar(bid, fecha, bloque, ignorarId = null, revisar = null) {
  const key = clave(bid, fecha);
  return withLock('oc:' + key, async () => {
    const cur = await getDoc('ocupados', key);
    const bloques = ((cur && cur.bloques) || []).filter((x) => x.id !== ignorarId && x.id !== bloque.id);
    if (revisar) revisar(bloques);
    const s = toMin(bloque.hora);
    if (bloques.some((x) => overlap(s, +bloque.dur, toMin(x.hora), +x.dur))) {
      throw err(409, 'ocupado', 'Ese horario se superpone con otro turno o bloqueo de ese barbero.');
    }
    bloques.push(bloque);
    bloques.sort((a, b) => toMin(a.hora) - toMin(b.hora));
    await setDoc('ocupados', key, { barberoId: bid, fecha, bloques });
  });
}

export async function liberar(bid, fecha, bloqueId) {
  const key = clave(bid, fecha);
  return withLock('oc:' + key, async () => {
    const cur = await getDoc('ocupados', key);
    if (!cur) return;
    const bloques = (cur.bloques || []).filter((x) => x.id !== bloqueId);
    if (bloques.length) await setDoc('ocupados', key, { barberoId: bid, fecha, bloques });
    else await delDoc('ocupados', key);
  });
}

// Crea o modifica un turno y mueve su bloque en la agenda si hace falta.
export async function guardarTurno(id, prev, t) {
  const activoAntes = !!prev && prev.estado !== 'cancelado';
  const activoAhora = t.estado !== 'cancelado';
  const movido = !prev || prev.barberoId !== t.barberoId || prev.fecha !== t.fecha || prev.hora !== t.hora || +prev.dur !== +t.dur;
  if (activoAhora && (movido || !activoAntes)) {
    await ocupar(t.barberoId, t.fecha, { id, hora: t.hora, dur: +t.dur, tipo: 'turno' }, id);
    if (activoAntes && (prev.barberoId !== t.barberoId || prev.fecha !== t.fecha)) await liberar(prev.barberoId, prev.fecha, id);
  } else if (!activoAhora && activoAntes) {
    await liberar(prev.barberoId, prev.fecha, id);
  }
  await setDoc('turnos', id, t);
}
