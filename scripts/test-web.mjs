// Prueba la web completa (la misma página que ve el cliente) contra la API,
// con un servidor que imita a Upstash: `npm run test:web`
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearUpstashFalso } from './fake-upstash.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const up = crearUpstashFalso(); await new Promise((r) => up.listen(0, r));
delete process.env.B333_MEMORY; delete process.env.KV_REST_API_URL;
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${up.address().port}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'token-prueba';
process.env.PANEL_USUARIO = 'dueno'; process.env.PANEL_PASSWORD = 'Clave-Segura-1';
process.env.SESSION_SECRET = 'secreto-de-prueba-para-tests-123';

const { crearServidor } = await import('./dev-server.mjs');
const srv = crearServidor(); await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
const html = fs.readFileSync(path.join(raiz, 'public/index.html'), 'utf8');
let cookie = '';
const errores = [];
const dom = new JSDOM(html, {
  url: base + '/', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = async (u, o = {}) => {
      const r = await fetch(new URL(u, base), { ...o, headers: { ...(o.headers || {}), cookie } });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return r;
    };
    w.IntersectionObserver = class { observe() {} };
    w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
    w.matchMedia = () => ({ matches: false });
    w.addEventListener('error', (e) => errores.push(e.message));
  },
});
const w = dom.window, d = w.document;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => d.querySelector(s);
const $$ = (s, el) => [...(el || d).querySelectorAll(s)];
const click = async (s, espera = 120) => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error('No existe ' + s); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(espera); };
const set = (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const enviar = async (sel, espera = 900) => { $(sel).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await sleep(espera); };
const precios = () => $$('#priceList .pcell .p').map((x) => x.textContent);
let ok = 0, mal = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { mal++; console.log('  ✗', n, x === undefined ? '' : JSON.stringify(x)); } };

await sleep(900);
console.log('Web pública');
check('5 servicios en la lista de precios', $$('#priceList tbody tr').length === 5, $$('#priceList tbody tr').length);
check('columnas Franco y Gonza', /Franco/.test($('#priceList thead').textContent) && /Gonza/.test($('#priceList thead').textContent));
check('aparecen los 10 precios', precios().length === 10 && precios().every((p) => /^\$\d/.test(p)), precios());
check('precios correctos', precios().join(' ') === '$18.000 $16.000 $21.000 $19.000 $26.000 $24.000 $29.000 $27.000 $8.000 $8.000', precios().join(' '));
check('recordatorio del martes', /martes/i.test($('#notice').textContent));
check('2 barberos en el equipo', $$('#teamList .barber').length === 2);

console.log('Reserva');
await click('[data-act="pick-grp"][data-id="corte de cabello"]');
check('corte de cabello: Franco $18.000 y Gonza $16.000', $$('[data-act="pick-bar"]').map((x) => x.dataset.id).join() === 'franco,gonza' && /\$18\.000/.test($('#booking').textContent) && /\$16\.000/.test($('#booking').textContent));
await click('[data-act="pick-bar"][data-id="franco"]');
const mar = $$('.date:not([disabled])').find((x) => /MAR/.test(x.textContent));
await click(mar);
check('martes $16.000 en efectivo', /\$16\.000/.test($('#booking').textContent) && /efectivo/i.test($('#booking').textContent));
const hora = $('[data-act="pick-hora"]').dataset.h;
await click('[data-act="pick-hora"]');
set('#bkNombre', 'Lucas Prueba'); set('#bkTel', '11 5555 1234');
await enviar('#bkForm');
check('turno confirmado', /Turno confirmado/.test($('#booking').textContent) && /333-[A-Z0-9]{4}/.test($('#booking').textContent));
await click('[data-act="book-again"]');
await click('[data-act="pick-grp"][data-id="corte de cabello"]');
await click('[data-act="pick-bar"][data-id="franco"]');
await click($$('.date:not([disabled])').find((x) => /MAR/.test(x.textContent)));
check('ese horario ya no se ofrece', !$$('[data-act="pick-hora"]').some((x) => x.dataset.h === hora));

console.log('Ingreso');
await click('[data-act="open-panel"]');
set('#lgUser', 'dueno'); set('#lgPass', 'mal');
await enviar('#mLogin', 500);
check('contraseña mala', /incorrectos/.test($('#mErr').textContent));
set('#lgPass', 'Clave-Segura-1');
await enviar('#mLogin');
check('entra al panel', !$('#panel').hidden);
set('#agDate', mar.dataset.f); await sleep(150);
check('el turno está en la agenda', /Lucas Prueba/.test($('#panel').textContent));

console.log('Editar barberos');
await click('[data-act="tab"][data-tab="barberos"]');
check('2 barberos en el panel', $$('#panel .li').length === 2, $$('#panel .li').length);
await click('[data-act="edit-barbero"][data-id="franco"]');
set('#mrEsp', 'Fades y diseños');
await enviar('#mBar');
check('guardar no duplica', $$('#panel .li').length === 2, $$('#panel .li').map((x) => x.textContent.slice(0, 30)));
await click('[data-act="edit-barbero"][data-id="franco"]');
check('el cambio quedó guardado', $('#mrEsp').value === 'Fades y diseños', $('#mrEsp').value);
set('#mrNombre', 'Franco Borelli');
await enviar('#mBar');
await click('[data-act="edit-barbero"][data-id="gonza"]');
const dia = $('#mBar input[name=dia][value="3"]'); dia.checked = false;
await enviar('#mBar');
check('guardar otra vez tampoco duplica', $$('#panel .li').length === 2);
await click('[data-act="edit-barbero"]');
set('#mrNombre', 'Juan Pérez'); set('#mrApodo', 'Juan');
await enviar('#mBar');
check('sumar un barbero nuevo', $$('#panel .li').length === 3 && /Juan Pérez/.test($('#panel').textContent));

console.log('Editar servicios');
await click('[data-act="tab"][data-tab="servicios"]');
check('9 servicios con precio y barbero', $$('#panel .li').length === 9 && /Con Franco/.test($('#panel').textContent) && /Con Gonza/.test($('#panel').textContent) && /Con todos los barberos/.test($('#panel').textContent));
await click('[data-act="edit-servicio"][data-id="corte-gonza"]');
check('el formulario trae los datos', $('#msNombre').value === 'Corte de cabello' && $('#msPrecio').value === '16000' && $('#mSvc input[name=sbar][value=gonza]').checked && $('#mpAct').checked && $('#mpPrecio').value === '14000');
set('#msPrecio', '17000');
await enviar('#mSvc');
check('editar no duplica', $$('#panel .li').length === 9, $$('#panel .li').length);
await click('[data-act="edit-servicio"]');
set('#msNombre', 'Corte de cabello'); set('#msPrecio', '15000');
$('#mSvc input[name=sbar][value]').checked = false;
[...d.querySelectorAll('#mSvc input[name=sbar]')].forEach((x) => { x.checked = /^b/.test(x.value); });
await enviar('#mSvc');
check('sumar servicio para Juan', $$('#panel .li').length === 10);

console.log('Horarios');
await click('[data-act="tab"][data-tab="negocio"]');
const c4 = $('#hC4'); c4.checked = true; c4.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(150);
await enviar('#negForm');
await click('[data-act="tab"][data-tab="negocio"]');
check('corte del jueves guardado', $('#hC4').checked && $('#hCD4').value === '14:00');

console.log('La web después de los cambios');
await click('[data-act="go-public"]'); await sleep(200);
check('sigue habiendo 5 servicios', $$('#priceList tbody tr').length === 5);
check('3 barberos', $$('#priceList thead th.bc').length === 3 && $$('#teamList .barber').length === 3);
const fila = $$('#priceList tbody tr').find((r) => /Corte de cabello/.test(r.textContent));
check('corte de cabello: Franco $18.000, Gonza $17.000, Juan $15.000', /\$18\.000.*\$17\.000.*\$15\.000/s.test(fila.textContent), fila.textContent);
check('jueves con corte en los horarios', /10:00 – 14:00 y 16:00 – 21:00/.test($('#hoursTbl').textContent), $('#hoursTbl').textContent);
const gonza = $$('#teamList .barber').find((b) => /Gonzalo/.test(b.textContent));
check('Gonza ya no trabaja los miércoles', !!gonza && !/Miércoles/.test(gonza.textContent) && /Martes, Jueves, Viernes, Sábado/.test(gonza.textContent), gonza && gonza.textContent);

console.log('Salir');
await click('[data-act="open-panel"]');
await click('[data-act="logout"]', 400);
check('vuelve a la web con Ingresar', $('#panel').hidden && /Ingresar/.test($('#navExtra').textContent));
check('sin errores de JavaScript', errores.length === 0, errores);

console.log(`\n${ok} bien, ${mal} con problemas`);
srv.close(); up.close(); w.close();
process.exit(mal ? 1 : 0);
