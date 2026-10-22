// GET /api/public — lo que necesita la web pública: datos del local, barberos,
// servicios y horarios ocupados (sin nombres ni teléfonos de clientes).
import { all, version } from './_lib/store.js';
import { cargarBase, ahora } from './_lib/agenda.js';
import { send, fail, err, query } from './_lib/http.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') throw err(405, 'metodo', 'Método no permitido');
    const v = query(req, 'v');
    const ver = await version();
    if (v && +v === ver && ver > 0) return send(res, 200, { same: true, ver });
    const base = await cargarBase();
    const hoy = ahora().fecha;
    const oc = await all('ocupados');
    const ocupados = {};
    for (const [k, v] of Object.entries(oc)) {
      if (v.fecha >= hoy) ocupados[k] = { barberoId: v.barberoId, fecha: v.fecha, bloques: (v.bloques || []).map((b) => ({ hora: b.hora, dur: b.dur })) };
    }
    send(res, 200, { ...base, ocupados, hoy, ver: await version() });
  } catch (e) { fail(res, e); }
}
