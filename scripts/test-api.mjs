// Pruebas de la API con base en memoria: `npm test`
process.env.B333_MEMORY = '1';
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.KV_REST_API_URL;
process.env.PANEL_USUARIO = 'dueno'; process.env.PANEL_PASSWORD = 'Clave-Segura-1';
process.env.PANEL_USUARIOS = 'franco:otraclave';
process.env.SESSION_SECRET = 'secreto-de-prueba-para-tests-123';
delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;

const { crearServidor } = await import('./dev-server.mjs');
const { ahora, addDays, weekday } = await import('../api/_lib/agenda.js');

const srv = crearServidor();
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
let cookie = '';
async function call(path, body) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
let fallas = 0, ok = 0;
function check(nombre, cond, extra) { if (cond) { ok++; console.log('  ✓', nombre); } else { fallas++; console.log('  ✗', nombre, extra !== undefined ? JSON.stringify(extra) : ''); } }

const hoy = ahora().fecha;
const proxDia = (wd, desde = 1) => { for (let i = desde; i < 14; i++) { const f = addDays(hoy, i); if (weekday(f) === wd) return f; } };
const mie = proxDia(3), mar = proxDia(2), lun = proxDia(1);

console.log('Web pública');
let r = await call('/api/public');
check('carga datos iniciales', r.status === 200 && Object.keys(r.j.barberos).length === 2 && Object.keys(r.j.servicios).length === 9, r.j);
check('horario 10 a 21 de martes a sábado', r.j.config.horarios[3].h === '21:00' && r.j.config.horarios[1].a === false);

console.log('Reservas');
r = await call('/api/reservar', { svc: 'barba-franco', bar: 'franco', fecha: mie, hora: '11:00', nombre: 'Juan Pérez', tel: '11 2345 6789' });
check('reserva válida', r.status === 200 && r.j.turno.precio === 26000, r.j);
const t1 = r.j.turno.id;
r = await call('/api/reservar', { svc: 'cejas-franco', bar: 'franco', fecha: mie, hora: '11:30', nombre: 'Otro', tel: '11 2345 6789' });
check('no deja pisar un turno de 1 h', r.status === 409 && r.j.code === 'ocupado', r);
r = await call('/api/reservar', { svc: 'corte-gonza', bar: 'franco', fecha: mie, hora: '15:00', nombre: 'Otro', tel: '11 2345 6789' });
check('servicio de Gonza no se puede con Franco', r.status === 400, r);
r = await call('/api/reservar', { svc: 'corte-franco', bar: 'franco', fecha: lun, hora: '11:00', nombre: 'Otro', tel: '11 2345 6789' });
check('lunes cerrado', r.status === 409, r);
r = await call('/api/reservar', { svc: 'corte-franco', bar: 'franco', fecha: mie, hora: '20:45', nombre: 'Otro', tel: '11 2345 6789' });
check('fuera de la grilla de horarios', r.status === 409, r);
r = await call('/api/reservar', { svc: 'corte-franco', bar: 'franco', fecha: mie, hora: '12:00', nombre: 'A', tel: '123' });
check('valida nombre y teléfono', r.status === 400, r);
r = await call('/api/reservar', { svc: 'corte-gonza', bar: 'gonza', fecha: mar, hora: '10:00', nombre: 'Martes Cliente', tel: '11 2345 6789' });
check('martes: corte con Gonza a $14.000 en efectivo', r.status === 200 && r.j.turno.precio === 14000 && r.j.turno.efectivo === true, r.j);
r = await call('/api/public');
const oc = r.j.ocupados['franco_' + mie];
check('la web pública ve el horario ocupado sin datos del cliente', oc && oc.bloques.length === 1 && !('id' in oc.bloques[0]) && !JSON.stringify(r.j).includes('Juan'), oc);

console.log('Reservas al mismo tiempo');
const par = await Promise.all([1, 2, 3, 4, 5].map((i) => call('/api/reservar', { svc: 'corte-gonza', bar: 'gonza', fecha: mie, hora: '16:00', nombre: 'Cliente ' + i, tel: '11 2345 678' + i })));
check('5 personas al mismo horario: entra solo 1', par.filter((x) => x.status === 200).length === 1 && par.filter((x) => x.status === 409).length === 4, par.map((x) => x.status));

console.log('Ingreso al panel');
r = await call('/api/admin?op=data');
check('sin sesión no entra', r.status === 401);
r = await call('/api/auth?op=login', { usuario: 'dueno', password: 'mala' });
check('contraseña mala', r.status === 401 && !cookie.includes('s333=e'), r);
r = await call('/api/auth?op=login', { usuario: 'DUENO', password: 'Clave-Segura-1' });
check('usuario de PANEL_USUARIO entra', r.status === 200 && cookie.startsWith('s333='), r);
r = await call('/api/auth?op=session');
check('la sesión queda abierta', r.j.user === 'dueno', r.j);
r = await call('/api/admin?op=data');
check('el panel ve los turnos con datos del cliente', r.status === 200 && r.j.turnos[t1].cliente === 'Juan Pérez');

console.log('Panel');
r = await call('/api/admin?op=turno', { id: t1, data: { ...((await call('/api/admin?op=data')).j.turnos[t1]), estado: 'cancelado' } });
check('cancelar turno', r.status === 200, r);
r = await call('/api/reservar', { svc: 'cejas-franco', bar: 'franco', fecha: mie, hora: '11:30', nombre: 'Nuevo', tel: '11 2345 6789' });
check('el horario cancelado vuelve a estar libre', r.status === 200, r);
r = await call('/api/admin?op=bloqueo', { bars: ['franco', 'gonza'], fecha: mie, desde: '13:00', hasta: '14:00', motivo: 'almuerzo' });
check('bloquear horario para los dos', r.status === 200 && r.j.fallas.length === 0, r);
r = await call('/api/reservar', { svc: 'corte-gonza', bar: 'gonza', fecha: mie, hora: '13:30', nombre: 'Bloq', tel: '11 2345 6789' });
check('no se puede reservar en un bloqueo', r.status === 409, r);
const data = (await call('/api/admin?op=data')).j;
const cfg = data.config; cfg.horarios[4] = { ...cfg.horarios[4], c: true, cd: '14:00', ch: '16:00' };
r = await call('/api/admin?op=save', { col: 'config', id: 'negocio', data: cfg });
check('guardar corte de 14 a 16 los jueves', r.status === 200, r);
const jue = proxDia(4);
r = await call('/api/reservar', { svc: 'corte-gonza', bar: 'gonza', fecha: jue, hora: '14:30', nombre: 'Corte', tel: '11 2345 6789' });
check('no hay turnos durante el corte', r.status === 409, r);
r = await call('/api/reservar', { svc: 'barba-gonza', bar: 'gonza', fecha: jue, hora: '13:30', nombre: 'Corte', tel: '11 2345 6789' });
check('un servicio de 1 h no puede pisar el corte', r.status === 409, r);
r = await call('/api/reservar', { svc: 'corte-gonza', bar: 'gonza', fecha: jue, hora: '16:00', nombre: 'Después', tel: '11 2345 6789' });
check('después del corte sí', r.status === 200, r);
r = await call('/api/admin?op=delete', { col: 'barberos', id: 'franco' });
check('no deja borrar un barbero con turnos', r.status === 409, r);
r = await call('/api/admin?op=save', { col: 'servicios', id: 'nuevo', data: { nombre: 'Lavado', duracion: 15, precio: 3000, barberos: [], activo: true } });
check('sumar servicio', r.status === 200);
r = await call('/api/admin?op=push-subscribe', { subscription: { endpoint: 'https://x', keys: {} } });
check('sin claves VAPID avisa que falta configurarlo', r.status === 400 && /VAPID/.test(r.j.error), r);

console.log('Ahorro de consultas');
r = await call('/api/public'); const ver = r.j.ver;
r = await call('/api/public?v=' + ver);
check('si no cambió nada responde corto', r.j.same === true, r.j);
await call('/api/admin?op=save', { col: 'servicios', id: 'nuevo', data: { nombre: 'Lavado', duracion: 15, precio: 3500, barberos: [], activo: true } });
r = await call('/api/public?v=' + ver);
check('si cambió algo manda todo', !r.j.same && r.j.servicios.nuevo.precio === 3500, r.j.same);
r = await call('/api/admin?op=data&v=' + r.j.ver);
check('el panel también responde corto', r.j.same === true);

console.log('Salir');
await call('/api/auth?op=logout', {});
r = await call('/api/admin?op=data');
check('después de salir no entra', r.status === 401);
r = await call('/api/auth?op=login', { usuario: 'franco', password: 'otraclave' });
check('usuario extra de PANEL_USUARIOS entra', r.status === 200);

srv.close();
console.log(`\n${ok} bien, ${fallas} con problemas`);
process.exit(fallas ? 1 : 0);
