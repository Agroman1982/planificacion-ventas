'use strict';
/*
 * Planificación Semanal de Ventas - servidor sin dependencias (Node.js).
 * - Login real con contraseña hasheada (scrypt).
 * - Aislamiento de filas a nivel de servidor: cada vendedor solo ve sus propias filas;
 *   el administrador ve todas (y puede filtrar por vendedor).
 * - Los vendedores se gestionan desde el panel del administrador (agregar / renombrar / retirar).
 * - Almacenamiento en data.json (JSON). Sin base de datos externa.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// En Render el disco persistente se monta en /data (DATA_DIR); en local usa la carpeta del proyecto.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'sid';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días

const ESTADOS = ['Planificado', 'En curso', 'Realizado', 'No realizado'];

// Roles (jerarquía): admin ve todo; supervisor ve a sus retail/kam; retail y kam ven lo suyo
// + lo de sus promotores; promotor ve solo lo suyo.
const ROLES = ['admin', 'supervisor', 'retail', 'kam', 'promotor'];
const ROLES_LABEL = { admin: 'Administrador', supervisor: 'Supervisor', retail: 'Vendedor Retail', kam: 'KAM (Agroindustria)', promotor: 'Promotor' };
// Roles que pueden tener a alguien encima (un "responsable")
const ROLES_CON_SUPERVISOR = ['retail', 'kam', 'promotor'];
// De quién depende cada rol (qué rol puede ser su responsable)
const PADRE_VALIDO = {
  retail: ['supervisor'],
  kam: ['supervisor'],
  promotor: ['retail', 'kam'],
};

// ---------------- Capa de datos ----------------
let db = { users: [], rows: [], sessions: {} };

function load() {
  if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* corrupto: resembrar */ }
  }
  if (!db.users) db.users = [];
  if (!db.rows) db.rows = [];
  if (!db.sessions) db.sessions = {};
}

let saveTimer = null;
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 150);
}

function uid(prefix) {
  return prefix + '_' + crypto.randomBytes(9).toString('hex');
}

function seed() {
  if (db.users.length > 0) return;
  const mk = (name, username, role, password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { id: uid('u'), name, username, role, supervisorId: null, salt, hash, createdAt: Date.now() };
  };
  db.users.push(mk('Hector Espinoza', 'hector', 'admin', 'rainbow2026'));
  db.users.push(mk('Marco Herrera', 'marco', 'retail', 'ventas2026'));
  db.users.push(mk('Antony Aguirre', 'antony', 'retail', 'ventas2026'));
  db.users.push(mk('Joan Dorador', 'joan', 'retail', 'ventas2026'));
  db.users.push(mk('Alfredo Omonte', 'alfredo', 'retail', 'ventas2026'));
  save();
  console.log('\n=== Credenciales iniciales (cámbialas desde el panel de administrador) ===');
  console.log('Administrador : hector  /  rainbow2026');
  console.log('Vendedores    : marco, antony, joan, alfredo  /  ventas2026');
  console.log('=====================================================================\n');
}

// Migración: los roles antiguos 'rep' pasan a 'retail' (lo construido hasta ahora es sector Retail)
// y se asegura el campo supervisorId.
function migrate() {
  let changed = false;
  db.users.forEach(u => {
    if (u.role === 'rep') { u.role = 'retail'; changed = true; }
    if (!ROLES.includes(u.role)) { u.role = 'retail'; changed = true; }
    if (u.supervisorId === undefined) { u.supervisorId = null; changed = true; }
    // Un rol que no es retail/kam no debe tener supervisor asignado
    if (u.role !== 'retail' && u.role !== 'kam' && u.supervisorId) { u.supervisorId = null; changed = true; }
  });
  if (changed) save();
}

// ---------------- Seguridad de contraseñas ----------------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password, salt, hash) {
  const h = hashPassword(password, salt);
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------- Sesiones ----------------
function createSession(userId) {
  const id = crypto.randomBytes(24).toString('hex');
  db.sessions[id] = { userId, exp: Date.now() + SESSION_TTL };
  saveSoon();
  return id;
}
function destroySession(sid) {
  if (sid && db.sessions[sid]) { delete db.sessions[sid]; saveSoon(); }
}
function getUserFromCookie(req) {
  const sid = getCookie(req, SESSION_COOKIE);
  if (!sid) return null;
  const s = db.sessions[sid];
  if (!s || s.exp < Date.now()) { if (s) delete db.sessions[sid]; return null; }
  return db.users.find(u => u.id === s.userId) || null;
}

// ---------------- Helpers HTTP ----------------
function getCookie(req, name) {
  const h = req.headers.cookie;
  if (!h) return null;
  const m = h.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setCookie(res, name, value, maxAge) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`);
}
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}
function publicUser(u) { return { id: u.id, name: u.name, username: u.username, role: u.role, supervisorId: u.supervisorId || null }; }

// ---- Visibilidad por equipo ----
// Devuelve los ids cuyas filas puede ver "me" (null = puede ver todo).
// La regla es la misma para cualquier rol no-admin: yo + mis subordinados directos.
//   supervisor -> ve a sus retail/kam;  retail/kam -> ven a sus promotores;  promotor -> solo él.
function idsVisiblesPara(me) {
  if (me.role === 'admin') return null;                        // ve todo
  const equipo = db.users.filter(u => u.supervisorId === me.id).map(u => u.id);
  equipo.push(me.id);                                          // + sus propias filas
  return equipo;
}
function puedeVerFila(me, row) {
  const ids = idsVisiblesPara(me);
  return ids === null || ids.indexOf(row.ownerId) >= 0;
}
// Valida el "responsable" (supervisorId) según el rol del usuario:
//   retail / kam  -> debe ser un supervisor
//   promotor      -> debe ser un retail o un kam
// Devuelve el id válido, null si no aplica/sin responsable, o 'INVALIDO'.
function validarResponsable(role, responsableId) {
  if (!ROLES_CON_SUPERVISOR.includes(role)) return null;
  if (!responsableId) return null;
  const permitidos = PADRE_VALIDO[role] || [];
  const padre = db.users.find(u => u.id === responsableId && permitidos.includes(u.role));
  if (!padre) return 'INVALIDO';
  return padre.id;
}
// Quien ve una fila de su equipo puede editarla/borrarla (el admin puede todo).
function puedeTocarFila(me, row) {
  if (me.role === 'admin') return true;
  return puedeVerFila(me, row);
}

// ---------------- Semana calculada desde la fecha ----------------
const MES_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function etiquetaSemanaDesdeFecha(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const p = iso.split('-'); if (p.length < 3) return '';
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  if (isNaN(d.getTime())) return '';
  const day = d.getDay() || 7;                       // domingo -> 7
  const lun = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (day - 1));
  const dom = new Date(lun.getFullYear(), lun.getMonth(), lun.getDate() + 6);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const n = Math.ceil((((t - ys) / 86400000) + 1) / 7);
  const rango = lun.getMonth() === dom.getMonth()
    ? lun.getDate() + '-' + dom.getDate() + ' ' + MES_ABBR[dom.getMonth()]
    : lun.getDate() + ' ' + MES_ABBR[lun.getMonth()] + '-' + dom.getDate() + ' ' + MES_ABBR[dom.getMonth()];
  return 'Sem ' + n + ' (' + rango + ')';
}

// ---------------- Validación de filas ----------------
const TEXT_FIELDS = ['semana', 'dia', 'ubicacion', 'cliente', 'trabajo', 'estado', 'observaciones'];
function cleanRowInput(body, ownerId, isAdmin) {
  const out = { ownerId };
  out.dia = typeof body.dia === 'string' ? body.dia.slice(0, 10).trim() : '';
  // Los representantes no escriben la semana: se calcula desde la fecha (el admin sí puede editarla).
  out.semana = isAdmin
    ? (typeof body.semana === 'string' ? body.semana.slice(0, 60).trim() : '')
    : etiquetaSemanaDesdeFecha(out.dia);
  out.ubicacion = typeof body.ubicacion === 'string' ? body.ubicacion.slice(0, 120).trim() : '';
  out.cliente = typeof body.cliente === 'string' ? body.cliente.slice(0, 120).trim() : '';
  out.producto = typeof body.producto === 'string' ? body.producto.slice(0, 160).trim() : '';
  out.trabajo = typeof body.trabajo === 'string' ? body.trabajo.slice(0, 300).trim() : '';
  out.estado = ESTADOS.includes(body.estado) ? body.estado : 'Planificado';
  out.observaciones = typeof body.observaciones === 'string' ? body.observaciones.slice(0, 400).trim() : '';
  out.ventaConcretar = Number(body.ventaConcretar);
  if (!isFinite(out.ventaConcretar) || out.ventaConcretar < 0) out.ventaConcretar = 0;
  out.ventaRealizada = Number(body.ventaRealizada);
  if (!isFinite(out.ventaRealizada) || out.ventaRealizada < 0) out.ventaRealizada = 0;
  return out;
}

// ---------------- Router ----------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    // Archivos estáticos (index.html + manifest + íconos PWA)
    if (method === 'GET') {
      let rel = decodeURIComponent(pathname);
      if (rel === '/' || rel === '/app') rel = '/index.html';
      // Seguridad: evitar path traversal y limitar a PUBLIC_DIR
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: 'Acceso denegado' });
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file).toLowerCase();
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/manifest+json; charset=utf-8',
          '.webmanifest': 'application/manifest+json; charset=utf-8',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.txt': 'text/plain; charset=utf-8',
        };
        const ct = types[ext] || 'application/octet-stream';
        // HTML no debe quedar en caché del navegador (así los reps ven las mejoras al instante).
        // Los íconos y el manifest sí se pueden cachear un rato.
        const cacheCtl = ext === '.html' ? 'no-store, no-cache, must-revalidate' : 'public, max-age=3600';
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': cacheCtl });
        return fs.createReadStream(file).pipe(res);
      }
      if (rel === '/index.html') return sendJSON(res, 404, { error: 'No encontrado' });
    }

    if (!pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'No encontrado' });

    // ---- Auth ----
    if (pathname === '/api/login' && method === 'POST') {
      const body = await readBody(req);
      const user = db.users.find(u => u.username === body.username);
      if (!user || !verifyPassword(body.password || '', user.salt, user.hash)) {
        return sendJSON(res, 401, { error: 'Usuario o contraseña incorrectos' });
      }
      const sid = createSession(user.id);
      setCookie(res, SESSION_COOKIE, sid, Math.floor(SESSION_TTL / 1000));
      return sendJSON(res, 200, { user: publicUser(user) });
    }

    if (pathname === '/api/logout' && method === 'POST') {
      destroySession(getCookie(req, SESSION_COOKIE));
      setCookie(res, SESSION_COOKIE, '', 0);
      return sendJSON(res, 200, { ok: true });
    }

    const me = getUserFromCookie(req);
    if (!me) return sendJSON(res, 401, { error: 'No autenticado' });

    if (pathname === '/api/me' && method === 'GET') {
      return sendJSON(res, 200, { user: publicUser(me), estados: ESTADOS, roles: ROLES, rolesLabel: ROLES_LABEL });
    }

    // ---- Filas (actividades) ----
    if (pathname === '/api/rows' && method === 'GET') {
      let rows = db.rows.slice();
      // Visibilidad: admin ve todo; supervisor ve su equipo (+ lo suyo); retail/kam solo lo suyo.
      const visibles = idsVisiblesPara(me);
      if (visibles !== null) rows = rows.filter(r => visibles.indexOf(r.ownerId) >= 0);
      const owner = url.searchParams.get('owner');
      if (owner) {
        // Nunca se puede pedir un vendedor fuera de lo permitido
        if (visibles !== null && visibles.indexOf(owner) < 0) {
          return sendJSON(res, 403, { error: 'No tienes permiso sobre ese vendedor' });
        }
        rows = rows.filter(r => r.ownerId === owner);
      }
      const semana = url.searchParams.get('semana');
      if (semana) rows = rows.filter(r => (r.semana || '').toLowerCase().includes(semana.toLowerCase()));
      const estado = url.searchParams.get('estado');
      if (estado) rows = rows.filter(r => r.estado === estado);
      rows.sort((a, b) => (a.dia || '').localeCompare(b.dia || '') || a.createdAt - b.createdAt);
      const ownerNames = {};
      db.users.forEach(u => { ownerNames[u.id] = u.name; });
      return sendJSON(res, 200, { rows, ownerNames });
    }

    if (pathname === '/api/rows' && method === 'POST') {
      const body = await readBody(req);
      let ownerId = me.id;
      if (me.role === 'admin' && body.ownerId) {
        const owner = db.users.find(u => u.id === body.ownerId && (u.role === 'retail' || u.role === 'kam' || u.role === 'promotor'));
        if (!owner) return sendJSON(res, 400, { error: 'Vendedor no válido' });
        ownerId = owner.id;
      }
      const c = cleanRowInput(body, ownerId, me.role === 'admin');
      const now = Date.now();
      const row = Object.assign({ id: uid('r'), createdAt: now, updatedAt: now }, c);
      db.rows.push(row);
      saveSoon();
      return sendJSON(res, 201, { row });
    }

    const rowMatch = pathname.match(/^\/api\/rows\/([^/]+)$/);
    if (rowMatch && (method === 'PUT' || method === 'DELETE')) {
      const row = db.rows.find(r => r.id === rowMatch[1]);
      if (!row) return sendJSON(res, 404, { error: 'No encontrado' });
      if (!puedeTocarFila(me, row)) {
        return sendJSON(res, 403, { error: 'No tienes permiso sobre esta fila' });
      }
      if (method === 'DELETE') {
        db.rows = db.rows.filter(r => r.id !== row.id);
        saveSoon();
        return sendJSON(res, 200, { ok: true });
      }
      const body = await readBody(req);
      const upd = cleanRowInput(body, row.ownerId, me.role === 'admin');
      Object.assign(row, upd, { updatedAt: Date.now() });
      saveSoon();
      return sendJSON(res, 200, { row });
    }

    // ---- Gestión de usuarios (solo admin) ----
    if (pathname === '/api/users' && method === 'GET') {
      // Misma regla que para las filas: admin ve todos; el resto ve a sí mismo + su gente a cargo
      // (supervisor -> retail/kam;  retail/kam -> promotores;  promotor -> solo él).
      const ids = idsVisiblesPara(me);
      const list = ids === null ? db.users : db.users.filter(u => ids.indexOf(u.id) >= 0);
      return sendJSON(res, 200, { users: list.map(publicUser) });
    }

    if (pathname === '/api/users' && method === 'POST') {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Solo administrador' });
      const body = await readBody(req);
      const name = (body.name || '').trim();
      const username = (body.username || '').trim().toLowerCase();
      const role = ROLES.includes(body.role) ? body.role : 'retail';
      const password = (body.password || '').toString();
      if (!name || !username || !password) return sendJSON(res, 400, { error: 'Nombre, usuario y contraseña son obligatorios' });
      if (db.users.find(u => u.username === username)) return sendJSON(res, 400, { error: 'Ese nombre de usuario ya existe' });
      // Responsable: retail/kam -> supervisor;  promotor -> retail o kam
      const supervisorId = validarResponsable(role, body.supervisorId);
      if (supervisorId === 'INVALIDO') {
        const espera = (PADRE_VALIDO[role] || []).join(' / ');
        return sendJSON(res, 400, { error: 'Responsable no válido. Para ese rol debe ser: ' + espera });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      const user = { id: uid('u'), name, username, role, supervisorId, salt, hash, createdAt: Date.now() };
      db.users.push(user);
      saveSoon();
      return sendJSON(res, 201, { user: publicUser(user) });
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && (method === 'PUT' || method === 'DELETE')) {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Solo administrador' });
      const user = db.users.find(u => u.id === userMatch[1]);
      if (!user) return sendJSON(res, 404, { error: 'No encontrado' });
      if (method === 'DELETE') {
        if (user.id === me.id) return sendJSON(res, 400, { error: 'No puedes eliminarte a ti mismo' });
        db.users = db.users.filter(u => u.id !== user.id);
        // Retirar también las filas de ese vendedor
        db.rows = db.rows.filter(r => r.ownerId !== user.id);
        saveSoon();
        return sendJSON(res, 200, { ok: true });
      }
      const body = await readBody(req);
      if (typeof body.name === 'string' && body.name.trim()) user.name = body.name.trim().slice(0, 120);
      if (typeof body.username === 'string' && body.username.trim()) {
        const nu = body.username.trim().toLowerCase();
        if (nu !== user.username && db.users.find(u => u.username === nu)) {
          return sendJSON(res, 400, { error: 'Ese nombre de usuario ya existe' });
        }
        user.username = nu;
      }
      const rolAnterior = user.role;
      if (ROLES.includes(body.role)) user.role = body.role;
      // Si cambió de rol, liberar a quienes lo tenían como responsable pero ya no aplica
      if (rolAnterior !== user.role) {
        db.users.forEach(function (u) {
          if (u.supervisorId === user.id) {
            const permitidos = PADRE_VALIDO[u.role] || [];
            if (!permitidos.includes(user.role)) u.supervisorId = null;
          }
        });
      }
      // Asignar responsable (supervisor para retail/kam; vendedor o KAM para promotor)
      if (body.supervisorId !== undefined) {
        const v = validarResponsable(user.role, body.supervisorId);
        if (v === 'INVALIDO') return sendJSON(res, 400, { error: 'Responsable no válido para ese rol' });
        user.supervisorId = v;
      }
      if (typeof body.password === 'string' && body.password) {
        user.salt = crypto.randomBytes(16).toString('hex');
        user.hash = crypto.scryptSync(body.password, user.salt, 64).toString('hex');
      }
      saveSoon();
      return sendJSON(res, 200, { user: publicUser(user) });
    }

    return sendJSON(res, 404, { error: 'No encontrado' });
  } catch (err) {
    return sendJSON(res, 500, { error: 'Error interno' });
  }
});

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ya existe */ }
load();
migrate();
seed();
server.listen(PORT, HOST, () => {
  console.log(`Planificación de Ventas corriendo en http://localhost:${PORT}`);
  console.log(`Desde el celular, usa la IP de este equipo en la misma red (ej. http://192.168.x.x:${PORT})`);
});
