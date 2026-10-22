// Servidor para probar en la compu: `npm run dev` y abrí http://localhost:3333
// Si no hay variables de Upstash, usa una base en memoria (se borra al cerrar).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(raiz, 'public');

if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL) process.env.B333_MEMORY = '1';
if (!process.env.PANEL_USUARIO && !process.env.PANEL_USUARIOS) { process.env.PANEL_USUARIO = 'admin'; process.env.PANEL_PASSWORD = 'admin333'; }
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'clave-de-prueba-local-123456';

const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const rutas = new Set(['public', 'reservar', 'auth', 'admin']);

export function crearServidor() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const m = url.pathname.match(/^\/api\/([a-z]+)$/);
      if (m) {
        if (!rutas.has(m[1])) { res.statusCode = 404; return res.end('{}'); }
        let raw = '';
        for await (const c of req) raw += c;
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
        req.query = Object.fromEntries(url.searchParams);
        const mod = await import(path.join(raiz, 'api', m[1] + '.js'));
        return await mod.default(req, res);
      }
      let file = path.join(pub, decodeURIComponent(url.pathname));
      if (!file.startsWith(pub)) { res.statusCode = 403; return res.end(); }
      if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
      const data = await fs.readFile(file);
      res.setHeader('Content-Type', tipos[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch (e) {
      if (e.code === 'ENOENT') { res.statusCode = 404; return res.end('No encontrado'); }
      console.error(e); res.statusCode = 500; res.end('Error');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = +process.env.PORT || 3333;
  crearServidor().listen(port, () => {
    console.log(`333 Barbería en http://localhost:${port}`);
    if (process.env.B333_MEMORY === '1') console.log('Base en memoria (se borra al cerrar).');
    console.log(`Panel: usuario "${process.env.PANEL_USUARIO || '(PANEL_USUARIOS)'}"`);
  });
}
