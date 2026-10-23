// Pruebas de la API: `npm test`
// Corre contra un servidor que imita a Upstash (mismo formato que la base real) usando la librería oficial.
import { crearUpstashFalso } from './fake-upstash.mjs';
const up = crearUpstashFalso();
await new Promise((r) => up.listen(0, r));
delete process.env.B333_MEMORY; delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${up.address().port}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'token-prueba';
process.env.PANEL_USUARIO = 'dueno'; process.env.PANEL_PASSWORD = 'Clave-Segura-1';
process.env.PANEL_USUARIOS = 'franco:otraclave';
process.env.SESSION_SECRET = 'secreto-de-prueba-para-tests-123';
delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;

const { crearServidor } = await import('./dev-server.mjs');
const { ahora, addDays, weekday } = await import('../api/_lib/agenda.js');
const store = await import('../api/_lib/store.js');

// Datos dañados como los que dejó la versión anterior en Upstash
await store.setConfig({ direccion: 'Lavalle 487' });
await store.setDoc('barberos', 'franco', { nombre: 'Franco Borelli', apodo: 'Franco', dias: [2, 3, 4, 5, 6], activo: true, orden: 1 });
await store.setDoc('barberos', 'gonza', { nombre: 'Gonzalo Veron', apodo: 'Gonza', dias: [2, 3, 4, 5, 6], activo: true, orden: 2 });
await store.setDoc('barberos', '1', { nombre: 'Franco Borelli (copia)', dias: [2], activo: true });
await store.setDoc('servicios', 'corte-franco', { nombre: 'Corte de cabello', duracion: 30, precio: 18000, barberos: ['franco'], activo: true, orden: 1, promo: { activo: true, dia: 2, precio: 16000, nota: 'Pagando únicamente en efectivo' } });
await store.setDoc('servicios', 'corte-gonza', { nombre: 'Corte de cabello', duracion: 30, precio: 16000, barberos: ['gonza'], activo: true, orden: 2, promo: { activo: true, dia: 2, precio: 14000, nota: 'Pagando únicamente en efectivo' } });
await store.setDoc('servicios', 'barba-franco', { nombre: 'Corte + barba', duracion: 60, precio: 26000, barberos: ['franco'], activo: true, orden: 5 });
await store.setDoc('servicios', 'barba-gonza', { nombre: 'Corte + barba', duracion: 60, precio: 24000, barberos: ['gonza'], activo: true, orden: 6 });
await store.setDoc('servicios', 'cejas-franco', { nombre: 'Corte + cejas', duracion: 30, precio: 21000, barberos: ['franco'], activo: true, orden: 3 });
await store.setDoc('servicios', 'perfilado', { nombre: 'Perfilado de barba', duracion: 30, precio: 8000, barberos: [], activo: true, orden: 9 });
await store.setDoc('servicios', '3', { nombre: 'Corte de cabello', duracion: 30, precio: 1, barberos: ['1'], activo: true });
await store.setDoc('turnos', 'abc123', { barberoId: '1', servicioId: '3', fecha: '2030-01-01', hora: '10:00', dur: 30, cliente: 'Prueba', estado: 'confirmado' });
await store.setDoc('ocupados', '1_2030-01-01', { barberoId: '1', fecha: '2030-01-01', bloques: [{ id: 'abc123', hora: '10:00', dur: 30 }] });

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

console.log('Reparación de los datos dañados');
let r = await call('/api/public');
check('lee los barberos con su nombre de identificador', Object.keys(r.j.barberos).sort().join() === 'franco,gonza', Object.keys(r.j.barberos));
check('borra la copia numerada del barbero', !r.j.barberos['1']);
check('borra el servicio numerado', !r.j.servicios['3'] && !!r.j.servicios['corte-franco'], Object.keys(r.j.servicios));
check('borra el horario ocupado por el barbero numerado', !Object.keys(r.j.ocupados).some((k) => k.startsWith('1_')));
check('cada servicio queda con su barbero', r.j.servicios['corte-franco'].barberos[0] === 'franco' && r.j.servicios['corte-gonza'].barberos[0] === 'gonza');
// se completan los servicios que faltaban para el resto de las pruebas
await store.setDoc('servicios', 'cejas-gonza', { nombre: 'Corte + cejas', duracion: 30, precio: 19000, barberos: ['gonza'], activo: true, orden: 4 });
await store.setDoc('servicios', 'completo-franco', { nombre: 'Servicio completo', duracion: 60, precio: 29000, barberos: ['franco'], activo: true, orden: 7 });
await store.setDoc('servicios', 'completo-gonza', { nombre: 'Servicio completo', duracion: 60, precio: 27000, barberos: ['gonza'], activo: true, orden: 8 });
const cfg0 = (await call('/api/public')).j.config;
await store.setConfig({ ...cfg0, horarios: { 0:{a:false,d:'10:00',h:'21:00'},1:{a:false,d:'10:00',h:'21:00'},2:{a:true,d:'10:00',h:'21:00'},3:{a:true,d:'10:00',h:'21:00'},4:{a:true,d:'10:00',h:'21:00'},5:{a:true,d:'10:00',h:'21:00'},6:{a:true,d:'10:00',h:'21:00'} } });

console.log('Web pública');
r = await call('/api/public');
check('carga datos', r.status === 200 && Object.keys(r.j.barberos).length === 2 && Object.keys(r.j.servicios).length === 9, Object.keys(r.j.servicios));
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

console.log('Editar barberos y servicios');
let dd = (await call('/api/admin?op=data')).j;
r = await call('/api/admin?op=save', { col: 'barberos', id: 'franco', data: { ...dd.barberos.franco, especialidad: 'Fades' } });
r = await call('/api/admin?op=save', { col: 'barberos', id: 'franco', data: { ...dd.barberos.franco, especialidad: 'Fades y diseños' } });
dd = (await call('/api/admin?op=data')).j;
check('editar un barbero dos veces no lo duplica', Object.keys(dd.barberos).length === 2 && dd.barberos.franco.especialidad === 'Fades y diseños', Object.keys(dd.barberos));
r = await call('/api/admin?op=save', { col: 'servicios', id: 'corte-gonza', data: { ...dd.servicios['corte-gonza'], precio: 17000 } });
r = await call('/api/public');
check('editar un servicio cambia el precio y no lo duplica', r.j.servicios['corte-gonza'].precio === 17000 && Object.keys(r.j.servicios).length === 9, Object.keys(r.j.servicios).length);
await call('/api/admin?op=save', { col: 'servicios', id: 'corte-gonza', data: { ...dd.servicios['corte-gonza'], precio: 16000 } });

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
