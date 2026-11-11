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
const ROLES = ['admin', 'supervisor', 'coordinador', 'retail', 'kam', 'promotor'];
const ROLES_LABEL = { admin: 'Administrador', supervisor: 'Supervisor', coordinador: 'Coordinador', retail: 'Vendedor Retail', kam: 'KAM (Agroindustria)', promotor: 'Promotor' };
const ROLES_CON_SUPERVISOR = ['coordinador', 'retail', 'kam', 'promotor'];
// Roles a los que se les puede asignar una meta, un ToDo o una actividad.
const ROLES_DE_EQUIPO = ['coordinador', 'retail', 'kam', 'promotor'];
// Quién puede ser responsable de cada rol. Un coordinador reporta al supervisor
// y puede tener a su cargo vendedores (retail/KAM) y promotores.
const PADRE_VALIDO = {
  coordinador: ['supervisor'],
  retail: ['supervisor', 'coordinador'],
  kam: ['supervisor', 'coordinador'],
  promotor: ['retail', 'kam', 'coordinador'],
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

// ---------------- Listado maestro de clientes (autocompletado) ----------------
// El listado es UNICO y está disponible para TODOS los usuarios: cada RTC/KAM
// elige su cliente escribiendo y filtrando. La base va versionada en el repo
// (clientes-base.json) para que un despliegue nuevo ya la tenga; las altas/bajas
// del administrador se guardan aparte en DATA_DIR/data/clients.json como
// "extra" y "removed", de modo que nunca se pisa la base al editar.
// Mantenimiento del listado: admin y supervisores. En producción el responsable
// de Rainbow usa el rol "supervisor", por eso no se limita solo a admin.
function puedeEditarClientes(u) {
  return !!u && (u.role === 'admin' || u.role === 'supervisor');
}

function normalizarCliente(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

function limpiarListaClientes(arr) {
  if (typeof arr === 'string') arr = arr.split(/\r?\n/);
  if (!Array.isArray(arr)) return [];
  const vistos = new Set(), out = [];
  arr.forEach(item => {
    const name = String(item == null ? '' : item).trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!name) return;
    const key = normalizarCliente(name);
    if (!key || vistos.has(key)) return;
    vistos.add(key);
    out.push(name);
  });
  out.sort((a, b) => a.localeCompare(b, 'es'));
  return out.slice(0, 5000);
}

const CLIENTES_BASE_FILE = path.join(__dirname, 'clientes-base.json');
function loadClientesBase() {
  try {
    const raw = JSON.parse(fs.readFileSync(CLIENTES_BASE_FILE, 'utf8'));
    return { version: raw.version || 1, clientes: limpiarListaClientes(raw.clientes || []) };
  } catch (e) { return { version: 0, clientes: [] }; }
}

function loadClientCatalog() {
  const base = loadClientesBase();
  let data = {};
  const file = path.join(DATA_DIR, 'data', 'clients.json');
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object') data = raw;
    } catch (e) { /* archivo corrupto: usar solo la base */ }
  }
  // Compatibilidad con el formato anterior (shared + byUser por representante):
  // esos nombres se conservan como altas para no perder nada ya cargado.
  const legado = [];
  if (Array.isArray(data.shared)) legado.push(...data.shared);
  if (data.byUser && typeof data.byUser === 'object') {
    Object.keys(data.byUser).forEach(k => {
      if (Array.isArray(data.byUser[k])) legado.push(...data.byUser[k]);
    });
  }
  const extras = limpiarListaClientes((Array.isArray(data.extra) ? data.extra : []).concat(legado));
  const removidos = new Set((Array.isArray(data.removed) ? data.removed : []).map(normalizarCliente));
  const clientes = limpiarListaClientes(base.clientes.concat(extras))
    .filter(c => !removidos.has(normalizarCliente(c)));
  return { clientes: clientes, baseVersion: base.version, updatedAt: data.updatedAt || 0 };
}

function saveClientCatalog(lista) {
  const base = loadClientesBase();
  const final = limpiarListaClientes(lista);
  const baseKeys = new Set(base.clientes.map(normalizarCliente));
  const finalKeys = new Set(final.map(normalizarCliente));
  const payload = {
    baseVersion: base.version,
    extra: final.filter(c => !baseKeys.has(normalizarCliente(c))),
    removed: base.clientes.filter(c => !finalKeys.has(normalizarCliente(c))),
    updatedAt: Date.now()
  };
  const dir = path.join(DATA_DIR, 'data');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ya existe */ }
  fs.writeFileSync(path.join(dir, 'clients.json'), JSON.stringify(payload, null, 2));
  return { clientes: final, updatedAt: payload.updatedAt };
}

function clientesDelCatalogo(cat) {
  return (cat && Array.isArray(cat.clientes)) ? cat.clientes : loadClientCatalog().clientes;
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
    return { id: uid('u'), name, username, role, supervisorId: null, supervisorIds: [], salt, hash, createdAt: Date.now() };
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
    // Migración a selección múltiple de responsables (sin perder el valor anterior)
    if (!Array.isArray(u.supervisorIds)) {
      u.supervisorIds = u.supervisorId ? [u.supervisorId] : [];
      changed = true;
    }
    // Solo los roles que admiten responsable pueden tenerlo (promotor también)
    if (!ROLES_CON_SUPERVISOR.includes(u.role) && (u.supervisorIds.length || u.supervisorId)) {
      u.supervisorIds = []; u.supervisorId = null; changed = true;
    }
    // Mantener supervisorId (compatibilidad) sincronizado con el arreglo
    const primero = u.supervisorIds[0] || null;
    if (u.supervisorId !== primero) { u.supervisorId = primero; changed = true; }
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
function publicUser(u) {
  const ids = Array.isArray(u.supervisorIds) ? u.supervisorIds.slice() : (u.supervisorId ? [u.supervisorId] : []);
  return { id: u.id, name: u.name, username: u.username, role: u.role, supervisorIds: ids, supervisorId: ids[0] || null };
}

// ---------------- Visibilidad ----------------
// Un usuario puede tener varios responsables; cualquiera de ellos lo ve en su equipo.
function esResponsableDe(u, responsableId) {
  if (Array.isArray(u.supervisorIds) && u.supervisorIds.indexOf(responsableId) >= 0) return true;
  return u.supervisorId === responsableId;
}
// Visibilidad transitiva: además de los reportes directos, incluye a toda la
// cadena que depende de ellos (supervisor -> coordinador -> vendedor -> promotor).
// El conjunto "vistos" evita bucles cuando hay responsables múltiples.
function idsVisiblesPara(me) {
  if (me.role === 'admin') return null;
  const equipo = [me.id];
  const vistos = new Set(equipo);
  const cola = [me.id];
  while (cola.length) {
    const actual = cola.shift();
    globalDb.users.forEach(u => {
      if (vistos.has(u.id)) return;
      if (esResponsableDe(u, actual)) {
        vistos.add(u.id);
        equipo.push(u.id);
        cola.push(u.id);
      }
    });
  }
  return equipo;
}
// "Jefe de equipo": admin, supervisor y coordinador por rol; o cualquier
// retail/KAM que tenga subordinados a cargo. El alcance exacto de a quién
// puede gestionar SIEMPRE lo define idsVisiblesPara().
function puedeGestionarEquipo(me) {
  if (me.role === 'admin' || me.role === 'supervisor' || me.role === 'coordinador') return true;
  if (me.role !== 'retail' && me.role !== 'kam') return false;
  return globalDb.users.some(u => u.id !== me.id && esResponsableDe(u, me.id));
}
function puedeGestionarA(me, targetId) {
  if (!puedeGestionarEquipo(me)) return false;
  const ids = idsVisiblesPara(me);
  return ids === null || ids.indexOf(targetId) >= 0;
}
function puedeVerFila(me, row) {
  const ids = idsVisiblesPara(me);
  return ids === null || ids.indexOf(row.ownerId) >= 0;
}
// Acepta un id, un arreglo de ids, null o vacío. Devuelve un arreglo validado o 'INVALIDO'.
function validarResponsable(role, entrada) {
  if (!ROLES_CON_SUPERVISOR.includes(role)) return [];
  const lista = Array.isArray(entrada) ? entrada : (entrada ? [entrada] : []);
  const permitidos = PADRE_VALIDO[role] || [];
  const out = [];
  for (const rid of lista) {
    if (!rid) continue;
    const padre = globalDb.users.find(u => u.id === rid && permitidos.includes(u.role));
    if (!padre) return 'INVALIDO';
    if (out.indexOf(padre.id) < 0) out.push(padre.id);
  }
  return out;
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
  
  // Los module.json usan { schema: { fields } }, pero se acepta también { fields }
  // plano para no perder datos en silencio si algún módulo cambia de formato.
  const fields = (schema && schema.schema && schema.schema.fields) || (schema && schema.fields) || [];
  if (!Array.isArray(fields)) return out;
  
  fields.forEach(field => {
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
      case 'userselect':
        // ID de usuario valido o vacio
        if (typeof val === 'string' && val.trim()) {
          const u = globalDb.users.find(x => x.id === val.trim());
          out[field.name] = u ? u.id : '';
        } else {
          out[field.name] = '';
        }
        break;
      case 'evaluations':
        // Lista de evaluaciones: array de {tipo, fechaPlanificada, fechaReal, estado, observaciones}
        if (Array.isArray(val)) {
          out[field.name] = val.map(ev => ({
            tipo: String(ev.tipo || '').slice(0, 100),
            fechaPlanificada: String(ev.fechaPlanificada || '').slice(0, 10),
            fechaReal: String(ev.fechaReal || '').slice(0, 10),
            estado: ['Pendiente', 'Realizada', 'No realizada', 'Pospuesta'].includes(ev.estado) ? ev.estado : 'Pendiente',
            observaciones: String(ev.observaciones || '').slice(0, 500)
          }));
        } else {
          out[field.name] = [];
        }
        break;
      case 'textarea':
      case 'text':
      default:
        const maxLen = field.maxLength || 500;
        out[field.name] = typeof val === 'string' ? val.trim().slice(0, maxLen) : '';
    }
  });

  // Cliente potencial: se compara contra el LISTADO MAESTRO (único para todos).
  // Si el listado estuviera vacío no se clasifica, para evitar falsos positivos.
  if (schema && schema.id === 'ventas' && out.cliente) {
    const listado = clientesDelCatalogo(loadClientCatalog());
    if (listado.length) {
      const n = normalizarCliente(out.cliente);
      out.clientePotencial = !listado.some(c => normalizarCliente(c) === n);
    } else {
      out.clientePotencial = false;
    }
  }

  // Autofill semana desde fecha si aplica
  const semanaField = fields.find(f => f.autoFill === 'weekLabelFromDate');
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
      return sendJSON(res, 200, {
        user: publicUser(user),
        estados: ESTADOS,
        canManageTeam: puedeGestionarEquipo(user),
        currentGoal: myGoal ? { amount: myGoal.amount, month: curMonth, year: curYear } : null,
        teamGoals: teamGoals
      });
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
        canManageTeam: puedeGestionarEquipo(me),
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
      // Para modulos con campos userselect (ej: I+D), adjuntar la lista de usuarios
      // para que el frontend pueda poblar los desplegables.
      const fields = (schema.schema && schema.schema.fields) || schema.fields || [];
      const hasUserSelect = fields.some(f => f.type === 'userselect');
      if (hasUserSelect) {
        const rtcUsers = globalDb.users
          .filter(u => u.role === 'retail' || u.role === 'kam')
          .map(u => ({ id: u.id, name: u.name, role: u.role }));
        return sendJSON(res, 200, Object.assign({}, schema, { users: rtcUsers }));
      }
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

      // Visibilidad para I+D: admin, supervisor y coordinador ven todo.
      // Los retail/kam ven solo los ensayos donde estan asignados como campo1Rtc o campo2Rtc.
      if (moduleId === 'i-d') {
        if (me.role !== 'admin' && me.role !== 'supervisor' && me.role !== 'coordinador') {
          rows = rows.filter(r => r.campo1Rtc === me.id || r.campo2Rtc === me.id);
        }
      } else {
        // Visibilidad estandar (jerarquia transitoria)
        const visibles = idsVisiblesPara(me);
        if (visibles !== null) rows = rows.filter(r => visibles.indexOf(r.ownerId) >= 0);
      }

      // Filtros
      if (moduleId !== 'i-d') {
        const owner = url.searchParams.get('owner');
        if (owner) {
          const visibles = idsVisiblesPara(me);
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
      } else {
        // Filtros I+D
        const estadoGral = url.searchParams.get('estado');
        if (estadoGral) rows = rows.filter(r => r.estadoGeneral === estadoGral);
        const tipo = url.searchParams.get('tipo');
        if (tipo) rows = rows.filter(r => r.tipoProducto === tipo);
      }

      // Orden: I+D por fecha de instalacion o creacion; ventas por dia
      if (moduleId === 'i-d') {
        rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      } else {
        rows.sort((a, b) => (a.dia || '').localeCompare(b.dia || '') || a.createdAt - b.createdAt);
      }

      // "Cliente potencial" se recalcula al leer: el listado maestro es la fuente
      // de verdad. Así, cuando el admin agrega un cliente detectado, el badge
      // desaparece de inmediato sin editar una por una las actividades.
      if (moduleId === 'ventas' && rows.length) {
        const listado = clientesDelCatalogo(loadClientCatalog());
        const enListado = listado.length ? new Set(listado.map(normalizarCliente)) : null;
        rows = rows.map(r => {
          if (!r.cliente) return r;
          const potencial = enListado ? !enListado.has(normalizarCliente(r.cliente)) : false;
          return potencial === !!r.clientePotencial ? r : Object.assign({}, r, { clientePotencial: potencial });
        });
      }
      
      const ownerNames = {};
      globalDb.users.forEach(u => { ownerNames[u.id] = u.name; });
      // Para I+D, adjuntar la lista de RTCs para poblar userselect en el frontend
      if (moduleId === 'i-d') {
        const rtcUsers = globalDb.users
          .filter(u => u.role === 'retail' || u.role === 'kam')
          .map(u => ({ id: u.id, name: u.name, role: u.role }));
        return sendJSON(res, 200, { rows, ownerNames, users: rtcUsers });
      }
      return sendJSON(res, 200, { rows, ownerNames });
    }

    if (rowsMatch && method === 'POST') {
      const moduleId = rowsMatch[1];
      const mod = modulesRegistry.modules.find(m => m.id === moduleId);
      if (!mod || !mod.active) return sendJSON(res, 404, { error: 'Módulo no encontrado' });
      if (!mod.allowedRoles.includes(me.role)) return sendJSON(res, 403, { error: 'No tienes acceso a este módulo' });

      const schema = loadModuleSchema(moduleId);
      // Permisos de creacion por modulo (si el schema los define)
      const createRoles = schema && schema.schema && schema.schema.permissions && schema.schema.permissions.create;
      if (Array.isArray(createRoles) && !createRoles.includes(me.role)) {
        return sendJSON(res, 403, { error: 'No tienes permiso para crear registros en este módulo' });
      }

      const body = await readBody(req);
      
      let ownerId = me.id;
      // Un jefe de equipo (admin, supervisor, coordinador o vendedor con gente a cargo)
      // puede agendar la actividad a nombre de alguien de su propio equipo.
      if (body.ownerId && body.ownerId !== me.id && puedeGestionarEquipo(me)) {
        if (!puedeGestionarA(me, body.ownerId)) return sendJSON(res, 403, { error: 'No tienes permiso sobre ese representante' });
        const owner = globalDb.users.find(u => u.id === body.ownerId && ROLES_DE_EQUIPO.includes(u.role));
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

      // Permisos por modulo (I+D): admin, supervisor, coordinador pueden editar/borrar.
      // RTCs pueden ver pero no editar.
      const schema = loadModuleSchema(moduleId);
      const editRoles = schema && schema.schema && schema.schema.permissions && schema.schema.permissions.edit;
      const deleteRoles = schema && schema.schema && schema.schema.permissions && schema.schema.permissions.delete;
      if (Array.isArray(editRoles)) {
        const canEdit = editRoles.includes(me.role) || (editRoles.includes('owner') && row.ownerId === me.id);
        if (!canEdit) return sendJSON(res, 403, { error: 'No tienes permiso para editar este registro' });
      } else {
        if (!puedeTocarFila(me, row)) return sendJSON(res, 403, { error: 'No tienes permiso sobre esta fila' });
      }

      if (method === 'DELETE') {
        if (Array.isArray(deleteRoles)) {
          const canDelete = deleteRoles.includes(me.role) || (deleteRoles.includes('owner') && row.ownerId === me.id);
          if (!canDelete) return sendJSON(res, 403, { error: 'No tienes permiso para eliminar este registro' });
        }
        moduleData.rows = moduleData.rows.filter(r => r.id !== row.id);
        saveModuleData(moduleId, moduleData);
        return sendJSON(res, 200, { ok: true });
      }

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

    // ---- Listado maestro de clientes (autocompletado en Ventas) ----
    // GET: TODOS los usuarios reciben el listado completo (393 clientes de la base).
    if (pathname === '/api/clients' && method === 'GET') {
      const cat = loadClientCatalog();
      const ids = idsVisiblesPara(me);
      return sendJSON(res, 200, {
        clientes: cat.clientes,
        shared: cat.clientes,   // compatibilidad con versiones anteriores del front
        byUser: {},
        ownUsername: me.username,
        editable: puedeEditarClientes(me),
        users: globalDb.users
          .filter(u => ids === null || ids.indexOf(u.id) >= 0)
          .map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role })),
        total: cat.clientes.length,
        baseVersion: cat.baseVersion,
        updatedAt: cat.updatedAt || 0
      });
    }

    // PUT: reemplaza el listado maestro (admin y supervisores). Se guardan las
    // diferencias contra la base versionada; la base en sí nunca se modifica.
    if (pathname === '/api/clients' && method === 'PUT') {
      if (!puedeEditarClientes(me)) return sendJSON(res, 403, { error: 'Solo el administrador o el supervisor pueden editar el listado de clientes' });
      const body = await readBody(req);
      let lista;
      if (Array.isArray(body.clientes)) lista = body.clientes;
      else if (typeof body.clientes === 'string') lista = body.clientes.split(/\r?\n/);
      else {
        // Compatibilidad con el formato anterior {shared, byUser}
        const legado = Array.isArray(body.shared) ? body.shared.slice() : [];
        if (body.byUser && typeof body.byUser === 'object') {
          Object.keys(body.byUser).forEach(k => {
            if (Array.isArray(body.byUser[k])) legado.push(...body.byUser[k]);
          });
        }
        lista = legado.length ? legado : clientesDelCatalogo(loadClientCatalog());
      }
      const cat = saveClientCatalog(lista);
      return sendJSON(res, 200, { ok: true, total: cat.clientes.length, updatedAt: cat.updatedAt });
    }

    // ---- ToDo (tareas pre-asignadas por supervisor/admin) ----
    // GET /api/todos → lista tareas ToDo visibles para el usuario
    if (pathname === '/api/todos' && method === 'GET') {
      const todosFile = path.join(DATA_DIR, 'data', 'todos.json');
      let todos = [];
      if (fs.existsSync(todosFile)) {
        try { todos = JSON.parse(fs.readFileSync(todosFile, 'utf8')); } catch (e) { todos = []; }
      }
      if (!Array.isArray(todos)) todos = [];
      // Visibilidad: admin ve todos; supervisor ve los suyos + los de su equipo; rep ve solo los suyos
      const ids = idsVisiblesPara(me);
      let visible;
      if (ids === null) visible = todos;
      else visible = todos.filter(t => ids.indexOf(t.assigneeId) >= 0);
      // Adjuntar nombre del asignado y del creador
      const result = visible.map(t => {
        const u = globalDb.users.find(x => x.id === t.assigneeId);
        const c = globalDb.users.find(x => x.id === t.createdBy);
        return {
          id: t.id, assigneeId: t.assigneeId, assigneeName: u ? u.name : '—',
          createdBy: t.createdBy, createdByName: c ? c.name : '—',
          cliente: t.cliente || '', producto: t.producto || '', trabajo: t.trabajo || '',
          ubicacion: t.ubicacion || '', ventaConcretar: t.ventaConcretar || 0,
          observaciones: t.observaciones || '', createdAt: t.createdAt
        };
      });
      result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return sendJSON(res, 200, { todos: result });
    }

    // POST /api/todos → crear tarea ToDo (jefes de equipo, solo para su gente)
    if (pathname === '/api/todos' && method === 'POST') {
      if (!puedeGestionarEquipo(me)) return sendJSON(res, 403, { error: 'No tienes permiso para asignar tareas' });
      const body = await readBody(req);
      const assigneeId = body.assigneeId;
      if (!assigneeId) return sendJSON(res, 400, { error: 'Falta el representante asignado' });
      const target = globalDb.users.find(u => u.id === assigneeId);
      if (!target) return sendJSON(res, 400, { error: 'Representante no encontrado' });
      // Un jefe de equipo asigna tareas a sus subordinados, nunca a sí mismo
      if (me.role !== 'admin' && assigneeId === me.id) return sendJSON(res, 403, { error: 'Solo puedes asignar tareas a tus subordinados' });
      // El jefe solo puede asignar a su propio equipo
      const ids = idsVisiblesPara(me);
      if (ids !== null && ids.indexOf(assigneeId) < 0) return sendJSON(res, 403, { error: 'No tienes permiso sobre ese representante' });

      const todo = {
        id: uid('todo'),
        assigneeId,
        createdBy: me.id,
        cliente: (body.cliente || '').trim().slice(0, 200),
        producto: (body.producto || '').trim().slice(0, 200),
        trabajo: (body.trabajo || '').trim().slice(0, 500),
        ubicacion: (body.ubicacion || '').trim().slice(0, 200),
        ventaConcretar: Math.max(0, Number(body.ventaConcretar) || 0),
        observaciones: (body.observaciones || '').trim().slice(0, 500),
        createdAt: Date.now()
      };
      const todosFile = path.join(DATA_DIR, 'data', 'todos.json');
      let todos = [];
      if (fs.existsSync(todosFile)) {
        try { todos = JSON.parse(fs.readFileSync(todosFile, 'utf8')); } catch (e) { todos = []; }
      }
      if (!Array.isArray(todos)) todos = [];
      todos.push(todo);
      fs.writeFileSync(todosFile, JSON.stringify(todos, null, 2));
      return sendJSON(res, 201, { todo });
    }

    // DELETE /api/todos/:id → eliminar tarea ToDo (al convertirse en actividad o al borrarla)
    const todoMatch = pathname.match(/^\/api\/todos\/([^/]+)$/);
    if (todoMatch && method === 'DELETE') {
      const todoId = todoMatch[1];
      const todosFile = path.join(DATA_DIR, 'data', 'todos.json');
      let todos = [];
      if (fs.existsSync(todosFile)) {
        try { todos = JSON.parse(fs.readFileSync(todosFile, 'utf8')); } catch (e) { todos = []; }
      }
      if (!Array.isArray(todos)) todos = [];
      const todo = todos.find(t => t.id === todoId);
      if (!todo) return sendJSON(res, 404, { error: 'ToDo no encontrado' });
      // Permisos: admin puede borrar cualquiera; supervisor solo los de su equipo; rep solo si es suyo
      if (me.role !== 'admin') {
        const ids = idsVisiblesPara(me);
        if (ids !== null && ids.indexOf(todo.assigneeId) < 0) return sendJSON(res, 403, { error: 'No tienes permiso sobre esta tarea' });
      }
      todos = todos.filter(t => t.id !== todoId);
      fs.writeFileSync(todosFile, JSON.stringify(todos, null, 2));
      return sendJSON(res, 200, { ok: true });
    }

    // ---- Fin ToDo ----

    // ---- Metas de venta (goals) ----
    // GET /api/goals?month=10&year=2026  → devuelve metas del mes para los visibles
    // GET /api/goals?month=0&year=2026   → devuelve todas las metas del año (para pestaña TOTAL)
    if (pathname === '/api/goals' && method === 'GET') {
      const rawMonth = url.searchParams.get('month');
      const month = rawMonth !== null ? parseInt(rawMonth) : (new Date().getMonth() + 1);
      const year = parseInt(url.searchParams.get('year')) || new Date().getFullYear();
      const ids = idsVisiblesPara(me);
      let goals;
      if (month === 0) {
        // Traer todas las metas del año
        goals = globalDb.goals.filter(g => g.year === year);
      } else {
        goals = globalDb.goals.filter(g => g.month === month && g.year === year);
      }
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
      if (!puedeGestionarEquipo(me)) return sendJSON(res, 403, { error: 'No tienes permiso para asignar metas' });
      const body = await readBody(req);
      const userId = body.userId;
      const month = parseInt(body.month) || (new Date().getMonth() + 1);
      const year = parseInt(body.year) || new Date().getFullYear();
      const amount = Math.max(0, Number(body.amount) || 0);

      if (!userId) return sendJSON(res, 400, { error: 'Falta el vendedor' });
      const target = globalDb.users.find(u => u.id === userId);
      if (!target) return sendJSON(res, 400, { error: 'Vendedor no encontrado' });
      // Nadie (salvo el admin) se fija su propia meta: solo se asignan a subordinados
      if (me.role !== 'admin' && userId === me.id) return sendJSON(res, 403, { error: 'Solo puedes asignar metas a tus subordinados' });
      // El jefe solo puede setear metas para su propio equipo
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
      
      const entradaResp = (body.supervisorIds !== undefined) ? body.supervisorIds : body.supervisorId;
      const supervisorIds = validarResponsable(role, entradaResp);
      if (supervisorIds === 'INVALIDO') {
        const espera = (PADRE_VALIDO[role] || []).join(' / ');
        return sendJSON(res, 400, { error: 'Responsable no válido. Para ese rol debe ser: ' + espera });
      }
      
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      const user = { id: uid('u'), name, username, role, supervisorIds, supervisorId: supervisorIds[0] || null, salt, hash, createdAt: Date.now() };
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
        // Si cambió de rol, deja de ser responsable de quienes ya no pueden tenerlo
        globalDb.users.forEach(function (u) {
          const permitidos = PADRE_VALIDO[u.role] || [];
          if (!permitidos.includes(user.role) && esResponsableDe(u, user.id)) {
            u.supervisorIds = (u.supervisorIds || []).filter(id => id !== user.id);
            u.supervisorId = u.supervisorIds[0] || null;
          }
        });
        // Y si su nuevo rol no admite responsables, limpiar los propios
        if (!ROLES_CON_SUPERVISOR.includes(user.role)) {
          user.supervisorIds = []; user.supervisorId = null;
        }
      }
      // Acepta supervisorIds (arreglo) o supervisorId (valor único, compatibilidad)
      const entradaResp = (body.supervisorIds !== undefined) ? body.supervisorIds : body.supervisorId;
      if (entradaResp !== undefined) {
        const v = validarResponsable(user.role, entradaResp);
        if (v === 'INVALIDO') return sendJSON(res, 400, { error: 'Responsable no válido para ese rol' });
        user.supervisorIds = v;
        user.supervisorId = v[0] || null;
      }
      // Asegurar que siempre exista el arreglo
      if (!Array.isArray(user.supervisorIds)) user.supervisorIds = user.supervisorId ? [user.supervisorId] : [];
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
