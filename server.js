'use strict';
/*
 * Rainbow Platform - Sistema Modular
 * Core: Auth, sesiones, usuarios, router modular
 * Módulos: Cada módulo tiene su propio schema (module.json) y datos separados
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || __dirname;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MODULES_DIR = path.join(__dirname, 'modules');
const SESSION_COOKIE = 'sid';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

const ESTADOS = ['Planificado', 'En curso', 'Realizado', 'No realizado'];
const ROLES = ['admin', 'supervisor', 'retail', 'kam', 'promotor'];
const ROLES_LABEL = { admin: 'Administrador', supervisor: 'Supervisor', retail: 'Vendedor Retail', kam: 'KAM (Agroindustria)', promotor: 'Promotor' };
const ROLES_CON_SUPERVISOR = ['retail', 'kam', 'promotor'];
const PADRE_VALIDO = {
  retail: ['supervisor'],
  kam: ['supervisor'],
  promotor: ['retail', 'kam'],
};

// ---------------- Capa de datos global ----------------
let globalDb = { users: [], sessions: {}, goals: [] };
let modulesRegistry = { modules: [], defaultModule: 'ventas' };

function loadGlobalData() {
  const usersFile = path.join(DATA_DIR, 'data', 'users.json');
  if (fs.existsSync(usersFile)) {
    try { globalDb = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch (e) { /* corrupto */ }
  }
  if (!globalDb.users) globalDb.users = [];
  if (!globalDb.sessions) globalDb.sessions = {};
  if (!globalDb.goals) globalDb.goals = [];
}

function loadModulesRegistry() {
  const regFile = path.join(__dirname, 'modules.json');
  console.log('Cargando modules.json desde:', regFile);
  if (fs.existsSync(regFile)) {
    try { 
      modulesRegistry = JSON.parse(fs.readFileSync(regFile, 'utf8')); 
      console.log('Módulos cargados:', modulesRegistry.modules.length);
      console.log('IDs:', modulesRegistry.modules.map(m => m.id).join(', '));
    } catch (e) { 
      console.error('Error cargando modules.json:', e);
    }
  }
  if (!modulesRegistry.modules) modulesRegistry.modules = [];
  if (!modulesRegistry.defaultModule) modulesRegistry.defaultModule = 'ventas';
}

let saveTimer = null;
function saveGlobalData() {
  const usersFile = path.join(DATA_DIR, 'data', 'users.json');
  fs.writeFileSync(usersFile, JSON.stringify(globalDb, null, 2));
}
function saveModulesRegistry() {
  const regFile = path.join(__dirname, 'modules.json');
  fs.writeFileSync(regFile, JSON.stringify(modulesRegistry, null, 2));
}
function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveGlobalData(); }, 150);
}

// ---------------- Capa de datos por módulo ----------------
function getModuleDataPath(moduleId) {
  const mod = modulesRegistry.modules.find(m => m.id === moduleId);
  if (!mod) return null;
  return path.join(DATA_DIR, mod.dataPath || `modules/${moduleId}/data`);
}

function loadModuleData(moduleId) {
  const dataPath = getModuleDataPath(moduleId);
  if (!dataPath) return { rows: [] };
  const rowsFile = path.join(dataPath, 'rows.json');
  if (fs.existsSync(rowsFile)) {
    try { return JSON.parse(fs.readFileSync(rowsFile, 'utf8')); } catch (e) { return { rows: [] }; }
  }
  return { rows: [] };
}

function saveModuleData(moduleId, data) {
  const dataPath = getModuleDataPath(moduleId);
  if (!dataPath) return;
  try { fs.mkdirSync(dataPath, { recursive: true }); } catch (e) { /* ya existe */ }
  const rowsFile = path.join(dataPath, 'rows.json');
  fs.writeFileSync(rowsFile, JSON.stringify(data, null, 2));
}

function loadModuleSchema(moduleId) {
  const schemaFile = path.join(MODULES_DIR, moduleId, 'module.json');
  if (fs.existsSync(schemaFile)) {
    try { return JSON.parse(fs.readFileSync(schemaFile, 'utf8')); } catch (e) { return null; }
  }
  return null;
}

// ---------------- Utilidades ----------------
function uid(prefix) {
  return prefix + '_' + crypto.randomBytes(9).toString('hex');
}

function seed() {
  if (globalDb.users.length > 0) return;
  const mk = (name, username, role, password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { id: uid('u'), name, username, role, supervisorId: null, salt, hash, createdAt: Date.now() };
  };
  globalDb.users.push(mk('Hector Espinoza', 'hector', 'admin', 'rainbow2026'));
  globalDb.users.push(mk('Marco Herrera', 'marco', 'retail', 'ventas2026'));
  globalDb.users.push(mk('Antony Aguirre', 'antony', 'retail', 'ventas2026'));
  globalDb.users.push(mk('Joan Dorador', 'joan', 'retail', 'ventas2026'));
  globalDb.users.push(mk('Alfredo Omonte', 'alfredo', 'retail', 'ventas2026'));
  saveGlobalData();
  console.log('\n=== Credenciales iniciales (cámbialas desde el panel de administrador) ===');
  console.log('Administrador : hector  /  rainbow2026');
  console.log('Vendedores    : marco, antony, joan, alfredo  /  ventas2026');
  console.log('=====================================================================\n');
}

function migrate() {
  let changed = false;
  globalDb.users.forEach(u => {
    if (u.role === 'rep') { u.role = 'retail'; changed = true; }
    if (!ROLES.includes(u.role)) { u.role = 'retail'; changed = true; }
    if (u.supervisorId === undefined) { u.supervisorId = null; changed = true; }
    if (u.role !== 'retail' && u.role !== 'kam' && u.supervisorId) { u.supervisorId = null; changed = true; }
  });
  if (changed) saveGlobalData();
}

// ---------------- Seguridad ----------------
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
  globalDb.sessions[id] = { userId, exp: Date.now() + SESSION_TTL };
  saveSoon();
  return id;
}
function destroySession(sid) {
  if (sid && globalDb.sessions[sid]) { delete globalDb.sessions[sid]; saveSoon(); }
}
function getUserFromCookie(req) {
  const sid = getCookie(req, SESSION_COOKIE);
  if (!sid) return null;
  const s = globalDb.sessions[sid];
  if (!s || s.exp < Date.now()) { if (s) delete globalDb.sessions[sid]; return null; }
  return globalDb.users.find(u => u.id === s.userId) || null;
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

// ---------------- Visibilidad ----------------
function idsVisiblesPara(me) {
  if (me.role === 'admin') return null;
  const equipo = globalDb.users.filter(u => u.supervisorId === me.id).map(u => u.id);
  equipo.push(me.id);
  return equipo;
}
function puedeVerFila(me, row) {
  const ids = idsVisiblesPara(me);
  return ids === null || ids.indexOf(row.ownerId) >= 0;
}
function validarResponsable(role, responsableId) {
  if (!ROLES_CON_SUPERVISOR.includes(role)) return null;
  if (!responsableId) return null;
  const permitidos = PADRE_VALIDO[role] || [];
  const padre = globalDb.users.find(u => u.id === responsableId && permitidos.includes(u.role));
  if (!padre) return 'INVALIDO';
  return padre.id;
}
function puedeTocarFila(me, row) {
  if (me.role === 'admin') return true;
  return puedeVerFila(me, row);
}

// ---------------- Semana calculada ----------------
const MES_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function etiquetaSemanaDesdeFecha(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const p = iso.split('-'); if (p.length < 3) return '';
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  if (isNaN(d.getTime())) return '';
  const day = d.getDay() || 7;
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

// ---------------- Validación de filas (schema-driven) ----------------
function cleanRowInput(body, schema, ownerId, isAdmin) {
  const out = { ownerId };
  
  if (!schema || !schema.fields) return out;
  
  schema.fields.forEach(field => {
    const val = body[field.name];
    
    switch (field.type) {
      case 'date':
        out[field.name] = typeof val === 'string' ? val.slice(0, 10).trim() : '';
        break;
      case 'number':
        const num = Number(val);
        out[field.name] = (!isFinite(num) || num < 0) ? (field.default || 0) : num;
        break;
      case 'select':
        out[field.name] = (field.options && field.options.includes(val)) ? val : (field.default || field.options[0] || '');
        break;
      case 'textarea':
      case 'text':
      default:
        const maxLen = field.maxLength || 500;
        out[field.name] = typeof val === 'string' ? val.trim().slice(0, maxLen) : '';
    }
  });
  
  // Autofill semana desde fecha si aplica
  const semanaField = schema.fields.find(f => f.autoFill === 'weekLabelFromDate');
  if (semanaField && !isAdmin) {
    out[semanaField.name] = etiquetaSemanaDesdeFecha(out.dia || body.dia);
  }
  
  return out;
}

// ---------------- Router ----------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    // Archivos estáticos
    if (method === 'GET') {
      let rel = decodeURIComponent(pathname);
      if (rel === '/') rel = '/index.html';
      if (rel === '/app') rel = '/app.html';
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
      const user = globalDb.users.find(u => u.username === body.username);
      if (!user || !verifyPassword(body.password || '', user.salt, user.hash)) {
        return sendJSON(res, 401, { error: 'Usuario o contraseña incorrectos' });
      }
      const sid = createSession(user.id);
      setCookie(res, SESSION_COOKIE, sid, Math.floor(SESSION_TTL / 1000));
      // Include goal data for immediate use on frontend
      const now = new Date();
      const curMonth = now.getMonth() + 1;
      const curYear = now.getFullYear();
      const myGoal = globalDb.goals.find(g => g.userId === user.id && g.month === curMonth && g.year === curYear);
      const ids = idsVisiblesPara(user);
      let teamGoals = [];
      const filterIds = ids !== null ? ids : null;
      teamGoals = globalDb.goals.filter(g => g.month === curMonth && g.year === curYear && (filterIds === null || filterIds.indexOf(g.userId) >= 0))
        .map(g => { const u = globalDb.users.find(x => x.id === g.userId); return { userId: g.userId, userName: u ? u.name : '—', amount: g.amount }; });
      return sendJSON(res, 200, { user: publicUser(user), currentGoal: myGoal ? { amount: myGoal.amount, month: curMonth, year: curYear } : null, teamGoals: teamGoals });
    }

    if (pathname === '/api/logout' && method === 'POST') {
      destroySession(getCookie(req, SESSION_COOKIE));
      setCookie(res, SESSION_COOKIE, '', 0);
      return sendJSON(res, 200, { ok: true });
    }

    const me = getUserFromCookie(req);
    if (!me) return sendJSON(res, 401, { error: 'No autenticado' });

    if (pathname === '/api/me' && method === 'GET') {
      const now = new Date();
      const curMonth = now.getMonth() + 1;
      const curYear = now.getFullYear();
      const myGoal = globalDb.goals.find(g => g.userId === me.id && g.month === curMonth && g.year === curYear);
      // Si es admin o supervisor, incluir las metas de su equipo
      const ids = idsVisiblesPara(me);
      let teamGoals = [];
      if (ids !== null) {
        teamGoals = globalDb.goals.filter(g => g.month === curMonth && g.year === curYear && ids.indexOf(g.userId) >= 0)
          .map(g => { const u = globalDb.users.find(x => x.id === g.userId); return { userId: g.userId, userName: u ? u.name : '—', amount: g.amount }; });
      } else {
        teamGoals = globalDb.goals.filter(g => g.month === curMonth && g.year === curYear)
          .map(g => { const u = globalDb.users.find(x => x.id === g.userId); return { userId: g.userId, userName: u ? u.name : '—', amount: g.amount }; });
      }
      return sendJSON(res, 200, { 
        user: publicUser(me), 
        estados: ESTADOS, 
        roles: ROLES, 
        rolesLabel: ROLES_LABEL,
        modules: modulesRegistry.modules
          .filter(m => m.active && m.allowedRoles.includes(me.role))
          .map(m => ({ id: m.id, name: m.name, icon: m.icon, description: m.description })),
        currentGoal: myGoal ? { amount: myGoal.amount, month: curMonth, year: curYear } : null,
        teamGoals: teamGoals,
        currentMonth: curMonth,
        currentYear: curYear
      });
    }

    // ---- Módulos: Listar disponibles ----
    if (pathname === '/api/modules' && method === 'GET') {
      const available = modulesRegistry.modules
        .filter(m => m.active && m.allowedRoles.includes(me.role))
        .map(m => ({ id: m.id, name: m.name, icon: m.icon, description: m.description, defaultView: m.defaultView }));
      return sendJSON(res, 200, { modules: available, defaultModule: modulesRegistry.defaultModule });
    }

    // ---- Módulos: Schema ----
    const schemaMatch = pathname.match(/^\/api\/modules\/([^/]+)\/schema$/);
    if (schemaMatch && method === 'GET') {
      const moduleId = schemaMatch[1];
      const mod = modulesRegistry.modules.find(m => m.id === moduleId);
      if (!mod || !mod.active) return sendJSON(res, 404, { error: 'Módulo no encontrado' });
      if (!mod.allowedRoles.includes(me.role)) return sendJSON(res, 403, { error: 'No tienes acceso a este módulo' });
      
      const schema = loadModuleSchema(moduleId);
      if (!schema) return sendJSON(res, 500, { error: 'Schema no encontrado' });
      return sendJSON(res, 200, schema);
    }

    // ---- Módulos: CRUD de filas ----
    const rowsMatch = pathname.match(/^\/api\/modules\/([^/]+)\/rows$/);
    const rowDetailMatch = pathname.match(/^\/api\/modules\/([^/]+)\/rows\/([^/]+)$/);

    if (rowsMatch && method === 'GET') {
      const moduleId = rowsMatch[1];
      const mod = modulesRegistry.modules.find(m => m.id === moduleId);
      if (!mod || !mod.active) return sendJSON(res, 404, { error: 'Módulo no encontrado' });
      if (!mod.allowedRoles.includes(me.role)) return sendJSON(res, 403, { error: 'No tienes acceso a este módulo' });

      const moduleData = loadModuleData(moduleId);
      let rows = moduleData.rows || [];

      // Visibilidad
      const visibles = idsVisiblesPara(me);
      if (visibles !== null) rows = rows.filter(r => visibles.indexOf(r.ownerId) >= 0);

      // Filtros
      const owner = url.searchParams.get('owner');
      if (owner) {
        if (visibles !== null && visibles.indexOf(owner) < 0) {
          return sendJSON(res, 403, { error: 'No tienes permiso sobre ese vendedor' });
        }
        rows = rows.filter(r => r.ownerId === owner);
      }
      const semana = url.searchParams.get('semana');
      if (semana) rows = rows.filter(r => (r.semana || '').toLowerCase().includes(semana.toLowerCase()));
      const estado = url.searchParams.get('estado');
      if (estado) rows = rows.filter(r => r.estado === estado);
      const dia = url.searchParams.get('dia');
      if (dia) rows = rows.filter(r => r.dia === dia);

      rows.sort((a, b) => (a.dia || '').localeCompare(b.dia || '') || a.createdAt - b.createdAt);
      
      const ownerNames = {};
      globalDb.users.forEach(u => { ownerNames[u.id] = u.name; });
      return sendJSON(res, 200, { rows, ownerNames });
    }

    if (rowsMatch && method === 'POST') {
      const moduleId = rowsMatch[1];
      const mod = modulesRegistry.modules.find(m => m.id === moduleId);
      if (!mod || !mod.active) return sendJSON(res, 404, { error: 'Módulo no encontrado' });
      if (!mod.allowedRoles.includes(me.role)) return sendJSON(res, 403, { error: 'No tienes acceso a este módulo' });

      const schema = loadModuleSchema(moduleId);
      const body = await readBody(req);
      
      let ownerId = me.id;
      if (me.role === 'admin' && body.ownerId) {
        const owner = globalDb.users.find(u => u.id === body.ownerId && (u.role === 'retail' || u.role === 'kam' || u.role === 'promotor'));
        if (!owner) return sendJSON(res, 400, { error: 'Vendedor no válido' });
        ownerId = owner.id;
      }
      
      const c = cleanRowInput(body, schema, ownerId, me.role === 'admin');
      const now = Date.now();
      const row = Object.assign({ id: uid('r'), createdAt: now, updatedAt: now }, c);
      
      const moduleData = loadModuleData(moduleId);
      moduleData.rows = moduleData.rows || [];
      moduleData.rows.push(row);
      saveModuleData(moduleId, moduleData);
      
      return sendJSON(res, 201, { row });
    }

    if (rowDetailMatch && (method === 'PUT' || method === 'DELETE')) {
      const moduleId = rowDetailMatch[1];
      const rowId = rowDetailMatch[2];
      
      const mod = modulesRegistry.modules.find(m => m.id === moduleId);
      if (!mod || !mod.active) return sendJSON(res, 404, { error: 'Módulo no encontrado' });
      if (!mod.allowedRoles.includes(me.role)) return sendJSON(res, 403, { error: 'No tienes acceso a este módulo' });

      const moduleData = loadModuleData(moduleId);
      const row = moduleData.rows.find(r => r.id === rowId);
      if (!row) return sendJSON(res, 404, { error: 'No encontrado' });
      if (!puedeTocarFila(me, row)) return sendJSON(res, 403, { error: 'No tienes permiso sobre esta fila' });

      if (method === 'DELETE') {
        moduleData.rows = moduleData.rows.filter(r => r.id !== row.id);
        saveModuleData(moduleId, moduleData);
        return sendJSON(res, 200, { ok: true });
      }

      const schema = loadModuleSchema(moduleId);
      const body = await readBody(req);
      const upd = cleanRowInput(body, schema, row.ownerId, me.role === 'admin');
      Object.assign(row, upd, { updatedAt: Date.now() });
      saveModuleData(moduleId, moduleData);
      return sendJSON(res, 200, { row });
    }

    // ---- Módulos: Exportar CSV ----
    const exportMatch = pathname.match(/^\/api\/modules\/([^/]+)\/export$/);
    if (exportMatch && method === 'GET') {
      const moduleId = exportMatch[1];
      const mod = modulesRegistry.modules.find(m => m.id === moduleId);
      if (!mod || !mod.active) return sendJSON(res, 404, { error: 'Módulo no encontrado' });
      if (!mod.allowedRoles.includes(me.role)) return sendJSON(res, 403, { error: 'No tienes acceso' });

      const moduleData = loadModuleData(moduleId);
      let rows = moduleData.rows || [];
      const visibles = idsVisiblesPara(me);
      if (visibles !== null) rows = rows.filter(r => visibles.indexOf(r.ownerId) >= 0);

      const schema = loadModuleSchema(moduleId);
      const fields = schema.schema.fields;
      
      // CSV Header
      let csv = '\uFEFF'; // BOM UTF-8
      const headers = fields.map(f => f.label).concat(['Creado', 'Actualizado']);
      csv += headers.join(';') + '\n';
      
      // CSV Rows
      rows.forEach(row => {
        const values = fields.map(f => {
          const val = row[f.name] || '';
          return String(val).replace(/;/g, ',').replace(/\n/g, ' ');
        });
        values.push(new Date(row.createdAt).toLocaleString('es-PE'));
        values.push(new Date(row.updatedAt).toLocaleString('es-PE'));
        csv += values.join(';') + '\n';
      });

      res.writeHead(200, { 
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${moduleId}-export.csv"`
      });
      return res.end(csv);
    }

    // ---- Gestión de módulos (solo admin) ----
    if (pathname === '/api/admin/modules' && method === 'GET') {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Solo administrador' });
      return sendJSON(res, 200, { modules: modulesRegistry.modules });
    }

    if (pathname === '/api/admin/modules' && method === 'POST') {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Solo administrador' });
      const body = await readBody(req);
      const id = (body.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      const name = (body.name || '').trim();
      if (!id || !name) return sendJSON(res, 400, { error: 'ID y nombre son obligatorios' });
      if (modulesRegistry.modules.find(m => m.id === id)) return sendJSON(res, 400, { error: 'Ese ID de módulo ya existe' });
      
      const newModule = {
        id,
        name,
        description: (body.description || '').trim(),
        icon: (body.icon || '📦').trim(),
        version: '1.0',
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dataPath: `modules/${id}/data`,
        allowedRoles: body.allowedRoles || ['admin'],
        defaultView: body.defaultView || 'lista'
      };
      modulesRegistry.modules.push(newModule);
      saveModulesRegistry();
      
      // Crear estructura de carpetas del módulo
      const modDir = path.join(MODULES_DIR, id);
      const modDataDir = path.join(modDir, 'data');
      try {
        fs.mkdirSync(modDataDir, { recursive: true });
        fs.writeFileSync(path.join(modDir, 'module.json'), JSON.stringify({
          id,
          name,
          schema: {
            fields: [
              { name: 'titulo', label: 'Título', type: 'text', required: true },
              { name: 'descripcion', label: 'Descripción', type: 'textarea', required: false },
              { name: 'estado', label: 'Estado', type: 'select', options: ['Pendiente', 'En progreso', 'Completado'], default: 'Pendiente' }
            ],
            states: { values: ['Pendiente', 'En progreso', 'Completado'] },
            views: {
              lista: { enabled: true, label: 'Lista', filters: ['estado'] },
              calendario: { enabled: false }
            }
          }
        }, null, 2));
        fs.writeFileSync(path.join(modDataDir, 'rows.json'), JSON.stringify({ rows: [] }, null, 2));
      } catch (e) { /* ignore */ }
      
      return sendJSON(res, 201, { module: newModule });
    }

    const adminModMatch = pathname.match(/^\/api\/admin\/modules\/([^/]+)$/);
    if (adminModMatch && method === 'DELETE') {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Solo administrador' });
      const moduleId = adminModMatch[1];
      if (moduleId === 'ventas') return sendJSON(res, 400, { error: 'No se puede eliminar el módulo ventas' });
      
      modulesRegistry.modules = modulesRegistry.modules.filter(m => m.id !== moduleId);
      saveModulesRegistry();
      return sendJSON(res, 200, { ok: true });
    }

    // ---- Metas de venta (goals) ----
    // GET /api/goals?month=10&year=2026  → devuelve metas del mes para los visibles
    if (pathname === '/api/goals' && method === 'GET') {
      const month = parseInt(url.searchParams.get('month')) || (new Date().getMonth() + 1);
      const year = parseInt(url.searchParams.get('year')) || new Date().getFullYear();
      const ids = idsVisiblesPara(me);
      let goals = globalDb.goals.filter(g => g.month === month && g.year === year);
      if (ids !== null) goals = goals.filter(g => ids.indexOf(g.userId) >= 0);
      // Adjuntar nombre del usuario
      const result = goals.map(g => {
        const u = globalDb.users.find(x => x.id === g.userId);
        return { id: g.id, userId: g.userId, userName: u ? u.name : '—', month: g.month, year: g.year, amount: g.amount, updatedAt: g.updatedAt };
      });
      return sendJSON(res, 200, { goals: result, month, year });
    }

    // POST /api/goals → crear o actualizar meta (upsert)
    if (pathname === '/api/goals' && method === 'POST') {
      if (me.role !== 'admin' && me.role !== 'supervisor') return sendJSON(res, 403, { error: 'Solo administrador o supervisor' });
      const body = await readBody(req);
      const userId = body.userId;
      const month = parseInt(body.month) || (new Date().getMonth() + 1);
      const year = parseInt(body.year) || new Date().getFullYear();
      const amount = Math.max(0, Number(body.amount) || 0);

      if (!userId) return sendJSON(res, 400, { error: 'Falta el vendedor' });
      const target = globalDb.users.find(u => u.id === userId);
      if (!target) return sendJSON(res, 400, { error: 'Vendedor no encontrado' });
      // Supervisor solo puede setear metas para su equipo
      const ids = idsVisiblesPara(me);
      if (ids !== null && ids.indexOf(userId) < 0) return sendJSON(res, 403, { error: 'No tienes permiso sobre ese vendedor' });

      // Upsert: buscar si ya existe una meta para ese user/mes/año
      let goal = globalDb.goals.find(g => g.userId === userId && g.month === month && g.year === year);
      if (goal) {
        goal.amount = amount;
        goal.updatedAt = Date.now();
      } else {
        goal = { id: uid('g'), userId, month, year, amount, createdAt: Date.now(), updatedAt: Date.now() };
        globalDb.goals.push(goal);
      }
      saveSoon();
      return sendJSON(res, 200, { goal });
    }

    // ---- Fin metas ----

    // ---- Gestión de usuarios (solo admin) ----
    if (pathname === '/api/users' && method === 'GET') {
      const ids = idsVisiblesPara(me);
      const list = ids === null ? globalDb.users : globalDb.users.filter(u => ids.indexOf(u.id) >= 0);
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
      if (globalDb.users.find(u => u.username === username)) return sendJSON(res, 400, { error: 'Ese nombre de usuario ya existe' });
      
      const supervisorId = validarResponsable(role, body.supervisorId);
      if (supervisorId === 'INVALIDO') {
        const espera = (PADRE_VALIDO[role] || []).join(' / ');
        return sendJSON(res, 400, { error: 'Responsable no válido. Para ese rol debe ser: ' + espera });
      }
      
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      const user = { id: uid('u'), name, username, role, supervisorId, salt, hash, createdAt: Date.now() };
      globalDb.users.push(user);
      saveSoon();
      return sendJSON(res, 201, { user: publicUser(user) });
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && (method === 'PUT' || method === 'DELETE')) {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Solo administrador' });
      const user = globalDb.users.find(u => u.id === userMatch[1]);
      if (!user) return sendJSON(res, 404, { error: 'No encontrado' });
      if (method === 'DELETE') {
        if (user.id === me.id) return sendJSON(res, 400, { error: 'No puedes eliminarte a ti mismo' });
        globalDb.users = globalDb.users.filter(u => u.id !== user.id);
        // Eliminar filas de todos los módulos
        modulesRegistry.modules.forEach(mod => {
          const modData = loadModuleData(mod.id);
          if (modData.rows) {
            modData.rows = modData.rows.filter(r => r.ownerId !== user.id);
            saveModuleData(mod.id, modData);
          }
        });
        saveSoon();
        return sendJSON(res, 200, { ok: true });
      }
      const body = await readBody(req);
      if (typeof body.name === 'string' && body.name.trim()) user.name = body.name.trim().slice(0, 120);
      if (typeof body.username === 'string' && body.username.trim()) {
        const nu = body.username.trim().toLowerCase();
        if (nu !== user.username && globalDb.users.find(u => u.username === nu)) {
          return sendJSON(res, 400, { error: 'Ese nombre de usuario ya existe' });
        }
        user.username = nu;
      }
      const rolAnterior = user.role;
      if (ROLES.includes(body.role)) user.role = body.role;
      if (rolAnterior !== user.role) {
        globalDb.users.forEach(function (u) {
          if (u.supervisorId === user.id) {
            const permitidos = PADRE_VALIDO[u.role] || [];
            if (!permitidos.includes(user.role)) u.supervisorId = null;
          }
        });
      }
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
    console.error('Error:', err);
    return sendJSON(res, 500, { error: 'Error interno' });
  }
});

// Inicialización
try { fs.mkdirSync(path.join(DATA_DIR, 'data'), { recursive: true }); } catch (e) { /* ya existe */ }
loadGlobalData();
loadModulesRegistry();
migrate();
seed();

server.listen(PORT, HOST, () => {
  console.log(`Rainbow Platform (Modular) corriendo en http://localhost:${PORT}`);
  console.log(`Módulos activos: ${modulesRegistry.modules.filter(m => m.active).map(m => m.name).join(', ')}`);
});
