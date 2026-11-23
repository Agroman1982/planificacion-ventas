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
// Id de build: cambia en cada despliegue (el proceso se reinicia en Render).
// Se inyecta en el HTML como "?v=__BUILD__" para romper la cache del navegador.
const BUILD_ID = Date.now().toString(36);

// Estados de PLANIFICACION DE VENTAS. "Planificado" se elimino: todo registro
// nuevo nace en "En curso" y el resultado se marca desde el detalle.
// (Marketing maneja su propio catalogo de estados en su module.json.)
const ESTADOS = ['En curso', 'Realizado', 'No realizado'];
const ROLES = ['admin', 'supervisor', 'coordinador', 'retail', 'kam', 'promotor'];
const ROLES_LABEL = { admin: 'Administrador', supervisor: 'Supervisor', coordinador: 'Coordinador', retail: 'Vendedor Retail', kam: 'KAM (Agroindustria)', promotor: 'Promotor' };
const ROLES_CON_SUPERVISOR = ['coordinador', 'retail', 'kam', 'promotor'];
// Roles a los que se les puede asignar una meta, un ToDo o una actividad.
const ROLES_DE_EQUIPO = ['coordinador', 'retail', 'kam', 'promotor'];
// Incentivos: el "jefe" que configura, aprueba y paga es el SUPERVISOR (o admin).
// El coordinador SOLO consulta y exporta para liquidar; no aprueba ni paga.
const ROLES_VENDEDOR = ['retail', 'kam', 'promotor'];
const ESTADOS_INCENTIVO = ['Pendiente', 'Aprobado', 'Rechazado'];
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
  // Escritura atomica: si el proceso se corta a mitad, el archivo anterior
  // sigue intacto en lugar de quedar truncado.
  return writeJsonSafe(usersFile, globalDb);
}
function saveModulesRegistry() {
  const regFile = path.join(__dirname, 'modules.json');
  fs.writeFileSync(regFile, JSON.stringify(modulesRegistry, null, 2));
}
function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveGlobalData(); }, 150);
}

// ---------------- Incentivos: campañas y ventas ----------------
// Viven en archivos propios dentro de DATA_DIR (igual que todos.json), NO en
// los rows.json de los módulos: así no afectan calendario, metas ni exportes
// existentes. Se cargan en memoria al arrancar y se escriben de forma atómica.
const CAMPAÑAS_FILE = path.join(DATA_DIR, 'data', 'campanas.json');
const INCENTIVOS_FILE = path.join(DATA_DIR, 'data', 'incentivos.json');
let campanas = [];
let incentivos = [];

function loadIncentivosData() {
  campanas = [];
  incentivos = [];
  if (fs.existsSync(CAMPAÑAS_FILE)) {
    try { const raw = JSON.parse(fs.readFileSync(CAMPAÑAS_FILE, 'utf8')); if (Array.isArray(raw)) campanas = raw; } catch (e) { /* corrupto */ }
  }
  if (fs.existsSync(INCENTIVOS_FILE)) {
    try { const raw = JSON.parse(fs.readFileSync(INCENTIVOS_FILE, 'utf8')); if (Array.isArray(raw)) incentivos = raw; } catch (e) { /* corrupto */ }
  }
}
function saveCampanas() { return writeJsonSafe(CAMPAÑAS_FILE, campanas); }
function saveIncentivos() { return writeJsonSafe(INCENTIVOS_FILE, incentivos); }
function uidInc(prefix) { return prefix + '_' + crypto.randomBytes(8).toString('hex'); }

// El jefe de incentivos es supervisor o admin. El coordinador NO configura,
// NO aprueba y NO paga: solo consulta y exporta para hacer la liquidación.
function esJefeIncentivos(me) { return !!me && (me.role === 'admin' || me.role === 'supervisor'); }
function puedeVerIncentivos(me) {
  return !!me && ['admin', 'supervisor', 'coordinador'].concat(ROLES_VENDEDOR).indexOf(me.role) >= 0;
}
function numero(s) { const n = Number(s); return isFinite(n) && n >= 0 ? n : 0; }
function texto(s, max) { return String(s == null ? '' : s).trim().slice(0, max || 200); }
function fechaValida(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
// Un participante es { vendedorId, promotorId, pctVendedor, pctPromotor }.
// El promotor se asigna POR VENDEDOR y los porcentajes los fija el jefe.
function participanteDe(camp, vendedorId) {
  if (!camp || !Array.isArray(camp.participantes)) return null;
  return camp.participantes.find(p => p.vendedorId === vendedorId) || null;
}
function productoDe(camp, nombre) {
  if (!camp || !Array.isArray(camp.productos)) return null;
  return camp.productos.find(p => p.nombre === nombre) || null;
}
// Cálculo canónico: el servidor usó SIEMPRE el precio base y el % guardados en
// la campaña al momento de cargar (snapshot), nunca lo que envíe el navegador.
function calcularIncentivo(base, facturado, cantidad, pctVendedor, pctPromotor) {
  const utilidad = Math.max(0, Math.round((numero(facturado) - numero(base)) * 100) / 100) * numero(cantidad);
  const total = Math.round(utilidad * 100) / 100;
  const pv = Math.min(100, Math.max(0, numero(pctVendedor)));
  const pp = Math.min(100, Math.max(0, numero(pctPromotor)));
  const divisor = pv + pp || 100;
  return {
    utilidad: total,
    incentivoVendedor: Math.round(total * pv / divisor * 100) / 100,
    incentivoPromotor: Math.round(total * pp / divisor * 100) / 100,
    pctVendedor: pv, pctPromotor: pp
  };
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
  writeJsonSafe(path.join(dir, 'clients.json'), payload);
  return { clientes: final, updatedAt: payload.updatedAt };
}

function clientesDelCatalogo(cat) {
  return (cat && Array.isArray(cat.clientes)) ? cat.clientes : loadClientCatalog().clientes;
}

// ---------------- Copia de seguridad / restauracion ----------------
// El disco de Render (/data) puede perderse. Este snapshot permite recuperar
// TODO el estado de la aplicacion en un unico archivo JSON restaurable.
const BACKUP_VERSION = 1;
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Escritura atomica: se escribe en un temporal y se renombra, para que un
// corte de luz o un reinicio a mitad de escritura NO deje un JSON corrupto.
function writeFileAtomic(file, content) {
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ya existe */ }
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    console.error('Error al escribir', file, e.message);
    try { fs.unlinkSync(tmp); } catch (e2) { /* nada que limpiar */ }
    return false;
  }
}

// Reemplaza una escritura directa por una atomica y tolerante a fallos.
function writeJsonSafe(file, obj) {
  return writeFileAtomic(file, JSON.stringify(obj, null, 2));
}

// Construye el snapshot completo del estado de la aplicacion.
// Las sesiones NO se incluyen: caducan solas y no aportan a una restauracion.
function buildSnapshot() {
  const clientesFile = path.join(DATA_DIR, 'data', 'clients.json');
  let clients = {};
  if (fs.existsSync(clientesFile)) {
    try { clients = JSON.parse(fs.readFileSync(clientesFile, 'utf8')); } catch (e) { clients = {}; }
  }
  const todosFile = path.join(DATA_DIR, 'data', 'todos.json');
  let todos = [];
  if (fs.existsSync(todosFile)) {
    try { todos = JSON.parse(fs.readFileSync(todosFile, 'utf8')); } catch (e) { todos = []; }
  }
  const modules = {};
  modulesRegistry.modules.forEach(m => {
    const dataPath = getModuleDataPath(m.id);
    if (!dataPath) return;
    const rowsFile = path.join(dataPath, 'rows.json');
    let rows = [];
    if (fs.existsSync(rowsFile)) {
      try { rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8')); } catch (e) { rows = { rows: [] }; }
    }
    modules[m.id] = { name: m.name, rows: rows };
  });
  return {
    backupVersion: BACKUP_VERSION,
    generadoEn: new Date().toISOString(),
    app: { nombre: 'Rainbow Platform', node: process.version },
    usuarios: globalDb.users.map(u => ({
      id: u.id, name: u.name, username: u.username, role: u.role,
      supervisorIds: Array.isArray(u.supervisorIds) ? u.supervisorIds : [],
      supervisorId: u.supervisorId || null,
      salt: u.salt, hash: u.hash, createdAt: u.createdAt
    })),
    metas: globalDb.goals || [],
    clientes: clients,
    todos: todos,
    campanas: campanas,
    incentivos: incentivos,
    modulos: modules,
    clientesBase: loadClientesBase()
  };
}

// Restaura un snapshot sobre el estado actual.
// Antes de escribir NADA se guarda una copia de seguridad de lo que hay ahora,
// para que una restauracion fallida nunca destruya el estado previo.
function restoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Snapshot inválido');
  if (!Array.isArray(snapshot.usuarios)) throw new Error('El snapshot no contiene usuarios');

  // 1) Red de seguridad del estado actual
  const safety = buildSnapshot();
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (e) { /* ya existe */ }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeJsonSafe(path.join(BACKUP_DIR, 'pre-restore-' + stamp + '.json'), safety);

  // 2) Usuarios, metas y sesiones (las sesiones se limpian)
  globalDb.users = snapshot.usuarios.map(u => ({
    id: u.id, name: u.name, username: u.username, role: u.role,
    supervisorId: u.supervisorId || (Array.isArray(u.supervisorIds) && u.supervisorIds[0]) || null,
    supervisorIds: Array.isArray(u.supervisorIds) ? u.supervisorIds : [],
    salt: u.salt, hash: u.hash, createdAt: u.createdAt || Date.now()
  }));
  globalDb.goals = Array.isArray(snapshot.metas) ? snapshot.metas : [];
  globalDb.sessions = {};
  saveGlobalData();

  // 3) Catalogo de clientes (deltas sobre la base versionada)
  if (snapshot.clientes && typeof snapshot.clientes === 'object') {
    writeJsonSafe(path.join(DATA_DIR, 'data', 'clients.json'), snapshot.clientes);
  }

  // 4) ToDo
  if (Array.isArray(snapshot.todos)) {
    writeJsonSafe(path.join(DATA_DIR, 'data', 'todos.json'), snapshot.todos);
  }

  // 4b) Campañas e incentivos (pueden no existir en backups antiguos)
  campanas = Array.isArray(snapshot.campanas) ? snapshot.campanas : [];
  incentivos = Array.isArray(snapshot.incentivos) ? snapshot.incentivos : [];
  saveCampanas();
  saveIncentivos();

  // 5) Registros de cada modulo
  const modulos = snapshot.modulos || {};
  Object.keys(modulos).forEach(id => {
    const dataPath = getModuleDataPath(id);
    if (!dataPath) return;
    const rows = modulos[id] && modulos[id].rows ? modulos[id].rows : { rows: [] };
    writeJsonSafe(path.join(dataPath, 'rows.json'), rows);
  });

  return {
    usuarios: globalDb.users.length,
    metas: globalDb.goals.length,
    todos: Array.isArray(snapshot.todos) ? snapshot.todos.length : 0,
    campanas: campanas.length,
    incentivos: incentivos.length,
    modulos: Object.keys(modulos).map(id => ({
      id: id,
      registros: (modulos[id].rows && modulos[id].rows.rows) ? modulos[id].rows.rows.length : 0
    }))
  };
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
  const rowsFile = path.join(dataPath, 'rows.json');
  writeJsonSafe(rowsFile, data);
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
  // Las contrasenas iniciales se pueden definir por variable de entorno para
  // no dejar las de fabrica en el repositorio (que es publico). Si no se
  // definen, se usan las de fabrica y se avisa por consola.
  const passAdmin = process.env.SEED_ADMIN_PASSWORD || 'rainbow2026';
  const passVendedor = process.env.SEED_VENDEDOR_PASSWORD || 'ventas2026';
  globalDb.users.push(mk('Hector Espinoza', 'hector', 'admin', passAdmin));
  globalDb.users.push(mk('Marco Herrera', 'marco', 'retail', passVendedor));
  globalDb.users.push(mk('Antony Aguirre', 'antony', 'retail', passVendedor));
  globalDb.users.push(mk('Joan Dorador', 'joan', 'retail', passVendedor));
  globalDb.users.push(mk('Alfredo Omonte', 'alfredo', 'retail', passVendedor));
  saveGlobalData();
  console.log('\n=== Credenciales iniciales (cámbialas desde el panel de administrador) ===');
  console.log('Administrador : hector  /  ' + (process.env.SEED_ADMIN_PASSWORD ? '(SEED_ADMIN_PASSWORD)' : 'rainbow2026 (de fabrica)'));
  console.log('Vendedores    : marco, antony, joan, alfredo  /  ' + (process.env.SEED_VENDEDOR_PASSWORD ? '(SEED_VENDEDOR_PASSWORD)' : 'ventas2026 (de fabrica)'));
  console.log('=====================================================================\n');
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn('[aviso] Se usaron credenciales de fabrica. Define SEED_ADMIN_PASSWORD en Render para protegerlas.');
  }
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
function readBody(req, maxBytes) {
  const limite = maxBytes || 1e6;
  return new Promise((resolve, reject) => {
    let data = '';
    let aborted = false;
    req.on('data', c => {
      if (aborted) return;
      data += c;
      if (data.length > limite) {
        aborted = true;
        req.destroy();
        reject(new Error('El contenido es demasiado grande (máximo ' + Math.round(limite / 1024) + ' KB)'));
      }
    });
    req.on('end', () => {
      if (aborted) return;
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON inválido')); }
    });
    req.on('error', err => { if (!aborted) reject(err); });
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

// ---------------- I+D: actividades y estado derivado ----------------
// Las ACTIVIDADES son los campos que se completan al ingresar un ensayo.
// El estado general y los campos "legacy" (usados por calendario, cronograma,
// dashboard y exportaciones) se derivan automaticamente de ellas.
function normalizarActividades(val, template) {
  const tpl = Array.isArray(template) ? template : [];
  const base = (Array.isArray(val) && val.length) ? val : tpl.map(() => ({}));
  return base.map((a, idx) => {
    const ref = tpl[idx] || {};
    const pick = (k, def) => (a[k] !== undefined && a[k] !== null && a[k] !== '')
      ? a[k] : (ref[k] !== undefined ? ref[k] : def);
    return {
      key: String(pick('key', 'act_' + idx)).slice(0, 60),
      nombre: String(pick('nombre', 'Actividad ' + (idx + 1))).slice(0, 120),
      grupo: String(pick('grupo', '')).slice(0, 80),
      tipoFecha: (a.tipoFecha === 'rango' || (a.tipoFecha === undefined && ref.tipoFecha === 'rango')) ? 'rango' : 'exacta',
      esEvaluacion: !!(a.esEvaluacion !== undefined ? a.esEvaluacion : ref.esEvaluacion),
      adjunto: !!(a.adjunto !== undefined ? a.adjunto : ref.adjunto),
      fechaPlan: String(a.fechaPlan || '').slice(0, 10),
      fechaPlanFin: String(a.fechaPlanFin || '').slice(0, 10),
      fechaEjec: String(a.fechaEjec || '').slice(0, 10),
      fechaEjecFin: String(a.fechaEjecFin || '').slice(0, 10),
      ejecutado: !!a.ejecutado,
      archivo: String(a.archivo || '').slice(0, 500)
    };
  });
}

function estadoDesdeActividades(acts, suspendido) {
  if (suspendido === 'Si') return 'Suspendido';
  if (!Array.isArray(acts) || !acts.length) return 'Producto potencial';
  let last = -1;
  acts.forEach((a, i) => { if (a.ejecutado) last = i; });
  if (last < 0) return 'Producto potencial';
  const a = acts[last];
  const map = {
    solicitudMuestras: 'Muestras solicitadas',
    recepcionMuestras: 'Protocolo en elaboracion',
    elaboracionProtocolo: 'Protocolo aprobado',
    ubicacionCampo: 'Busqueda de campos',
    instalacion: 'Instalacion',
    elaboracionInforme: 'Gabinete',
    presentacionInforme: 'Completado'
  };
  if (a.esEvaluacion) return 'Evaluaciones en curso';
  if (map[a.key]) return map[a.key];
  if (last === acts.length - 1 && acts.every(x => x.ejecutado)) return 'Completado';
  return 'Evaluaciones en curso';
}

// Deriva campos de compatibilidad para que Calendario / Cronograma / Resumen /
// exportaciones sigan funcionando sin reescribir cada vista.
function derivarCamposID(out, body) {
  const acts = out.actividades || [];
  const get = k => acts.find(a => a.key === k) || {};
  const sol = get('solicitudMuestras');
  const rec = get('recepcionMuestras');
  const proto = get('elaboracionProtocolo');
  const inst = get('instalacion');
  const inf = get('elaboracionInforme');
  const pres = get('presentacionInforme');

  out.estadoGeneral = estadoDesdeActividades(acts, out.suspendido);
  out.fechaMuestras = sol.fechaEjec || sol.fechaPlan || '';
  out.fechaInstalacion = inst.fechaEjec || inst.fechaPlan || '';
  out.fechaInformePlanificada = inf.fechaPlan || inf.fechaPlanFin || pres.fechaPlan || '';
  out.protocoloLink = proto.archivo || '';
  out.estadoMuestras = rec.ejecutado ? 'Recibidas' : (sol.ejecutado ? 'Solicitadas' : 'No solicitadas');
  out.estadoProtocolo = proto.ejecutado ? 'Aprobado' : 'Pendiente';
  out.campo1Rtc = out.representante || '';
  out.campo2Rtc = '';
  out.campo1Ubicacion = out.ubicacionEnsayo || '';
  out.campo2Ubicacion = '';
  out.campo1Cliente = '';
  out.campo2Cliente = '';
  out.evaluaciones = acts.filter(a => a.esEvaluacion).map(a => ({
    tipo: a.nombre,
    fechaPlanificada: a.fechaPlan || '',
    fechaReal: a.fechaEjec || '',
    estado: a.ejecutado ? 'Realizada' : 'Pendiente',
    observaciones: ''
  }));
  // Conservar texto legacy si venia de un registro antiguo (no se muestra en el nuevo detalle).
  ['descripcion', 'tratamientos', 'variablesEvaluar'].forEach(k => {
    if (typeof body[k] === 'string') out[k] = body[k].trim().slice(0, 500);
  });
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
      case 'activities':
        // Lista de ACTIVIDADES del ensayo. Si no se envia, se construye desde
        // la plantilla definida en el module.json (11 actividades por defecto).
        {
          const schemaObj = (schema && schema.schema) || {};
          out[field.name] = normalizarActividades(val, schemaObj.actividadesTemplate);
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

  // SEMANA: campo 100% automatico y NO editable, para TODOS los roles
  // (incluido admin). La fecha es la unica fuente de verdad: lo que envie el
  // cliente en "semana" se ignora. Solo si no hay fecha valida se conserva el
  // valor recibido, para no borrar la semana de registros antiguos sin fecha.
  const semanaField = fields.find(f => f.autoFill === 'weekLabelFromDate');
  if (semanaField) {
    const calculada = etiquetaSemanaDesdeFecha(out.dia || '');
    out[semanaField.name] = calculada || (typeof body[semanaField.name] === 'string'
      ? body[semanaField.name].trim().slice(0, 500) : '');
  }

  // I+D: el estado y los campos de compatibilidad se derivan de las ACTIVIDADES.
  if (schema && schema.id === 'i-d') derivarCamposID(out, body);

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
      // App unificada: el enlace de siempre (/) y /app sirven la MISMA pantalla
      // modular, sin redireccion y sin cambiar la URL. /index.html queda
      // accesible como respaldo de la antigua interfaz de Ventas.
      if (rel === '/' || rel === '/app') rel = '/app.html';
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
        const stat = fs.statSync(file);
        // El HTML se sirve siempre fresco y con el id de build inyectado en los
        // "?v=__BUILD__" de los scripts: asi el navegador NUNCA queda con un
        // JS/CSS de una version anterior (antes el JS se cacheaba 1 hora).
        if (ext === '.html') {
          const html = fs.readFileSync(file, 'utf8').split('__BUILD__').join(BUILD_ID);
          res.writeHead(200, {
            'Content-Type': ct,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Content-Length': Buffer.byteLength(html)
          });
          return res.end(html);
        }
        // El resto de archivos: revalidacion condicional con ETag. El navegador
        // siempre consulta al servidor y recibe 304 si el archivo no cambio.
        const etag = '"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + '"';
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache, must-revalidate' });
          return res.end();
        }
        res.writeHead(200, {
          'Content-Type': ct,
          'Cache-Control': 'no-cache, must-revalidate',
          'ETag': etag,
          'Last-Modified': stat.mtime.toUTCString()
        });
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
          .filter(u => u.role === 'retail' || u.role === 'kam' || u.role === 'promotor')
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
      // Retail/KAM/promotor ven solo los ensayos donde son el representante
      // (se conservan campo1Rtc/campo2Rtc para registros migrados).
      if (moduleId === 'i-d') {
        if (me.role !== 'admin' && me.role !== 'supervisor' && me.role !== 'coordinador') {
          rows = rows.filter(r => r.representante === me.id || r.campo1Rtc === me.id || r.campo2Rtc === me.id);
        }
      } else {
        // Visibilidad estandar (jerarquia transitoria)
        const visibles = idsVisiblesPara(me);
        if (visibles !== null) rows = rows.filter(r => visibles.indexOf(r.ownerId) >= 0);
      }

      // Compatibilidad sin migracion: los registros de Ventas guardados antes
      // de eliminar el estado "Planificado" se muestran como "En curso".
      // Se normaliza SOLO en la respuesta; el disco no se reescribe.
      if (moduleId === 'ventas') {
        rows = rows.map(r => r.estado === 'Planificado'
          ? Object.assign({}, r, { estado: 'En curso' }) : r);
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
          .filter(u => u.role === 'retail' || u.role === 'kam' || u.role === 'promotor')
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
      // RTCs/KAMs/promotores asignados a campo1Rtc/campo2Rtc pueden editar para marcar
      // actividades y evaluaciones como realizadas, pero no borrar.
      const schema = loadModuleSchema(moduleId);
      const editRoles = schema && schema.schema && schema.schema.permissions && schema.schema.permissions.edit;
      const deleteRoles = schema && schema.schema && schema.schema.permissions && schema.schema.permissions.delete;
      const assignedRoles = schema && schema.schema && schema.schema.permissions && schema.schema.permissions.viewAssigned;
      const assignedFields = schema && schema.schema && schema.schema.features && schema.schema.features.assignedFields;
      const isAssigned = Array.isArray(assignedFields) && Array.isArray(assignedRoles) && assignedRoles.includes(me.role)
        && assignedFields.some(f => row[f] === me.id);
      if (Array.isArray(editRoles)) {
        const canEdit = editRoles.includes(me.role)
          || (editRoles.includes('owner') && row.ownerId === me.id)
          || isAssigned;
        if (!canEdit) return sendJSON(res, 403, { error: 'No tienes permiso para editar este registro' });
      } else {
        if (!puedeTocarFila(me, row) && !isAssigned) return sendJSON(res, 403, { error: 'No tienes permiso sobre esta fila' });
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

    // ---- Copia de seguridad y restauracion ----
    // GET  /api/admin/backup  -> snapshot completo (JSON descargable)
    // POST /api/admin/restore -> restaura un snapshot previo
    // Se permite a admin y supervisor (en produccion el responsable de Rainbow
    // tiene rol "supervisor"), nunca a roles inferiores.
    if (pathname === '/api/admin/backup' && method === 'GET') {
      if (!puedeEditarClientes(me)) return sendJSON(res, 403, { error: 'Solo administrador o supervisor' });
      const snapshot = buildSnapshot();
      const resumen = {
        usuarios: snapshot.usuarios.length,
        metas: snapshot.metas.length,
        todos: snapshot.todos.length,
        campanas: (snapshot.campanas || []).length,
        incentivos: (snapshot.incentivos || []).length,
        modulos: Object.keys(snapshot.modulos).map(id => ({
          id: id,
          registros: (snapshot.modulos[id].rows && snapshot.modulos[id].rows.rows) ? snapshot.modulos[id].rows.rows.length : 0
        }))
      };
      return sendJSON(res, 200, { ok: true, resumen: resumen, snapshot: snapshot });
    }

    if (pathname === '/api/admin/restore' && method === 'POST') {
      if (!puedeEditarClientes(me)) return sendJSON(res, 403, { error: 'Solo administrador o supervisor' });
      const body = await readBody(req, 20 * 1024 * 1024);
      // Confirmacion explicita: evita restauraciones accidentales.
      if (body.confirmar !== 'RESTAURAR') {
        return sendJSON(res, 400, { error: 'Falta la confirmación. Envía confirmar: "RESTAURAR"' });
      }
      let snapshot = body.snapshot;
      if (!snapshot && body.snapshotPath) {
        try { snapshot = JSON.parse(fs.readFileSync(String(body.snapshotPath), 'utf8')); }
        catch (e) { return sendJSON(res, 400, { error: 'No se pudo leer el archivo indicado' }); }
      }
      try {
        const resultado = restoreSnapshot(snapshot);
        return sendJSON(res, 200, { ok: true, restaurado: resultado });
      } catch (e) {
        console.error('Error restaurando:', e);
        return sendJSON(res, 400, { error: e.message || 'No se pudo restaurar' });
      }
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
          tipoActividad: t.tipoActividad || '',
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
        tipoActividad: (body.tipoActividad || '').trim().slice(0, 80),
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

    // ================= Incentivos (campañas + ventas) =================
    // Visibilidad: el supervisor/admin ve todo su equipo; el coordinador ve
    // el suyo (para liquidar); el representante solo sus propias ventas y las
    // campañas en las que participa. Reutiliza idsVisiblesPara() (transitivo).
    if (pathname === '/api/campanas' && method === 'GET') {
      if (!puedeVerIncentivos(me)) return sendJSON(res, 403, { error: 'Sin acceso a incentivos' });
      const ids = idsVisiblesPara(me);
      let lista = campanas.slice();
      if (ids !== null) {
        lista = lista.filter(c => c.createdBy === me.id ||
          (Array.isArray(c.participantes) && c.participantes.some(p =>
            p.vendedorId === me.id || p.promotorId === me.id || ids.indexOf(p.vendedorId) >= 0)));
      }
      lista.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return sendJSON(res, 200, { campanas: lista, puedeConfigurar: esJefeIncentivos(me) });
    }

    if (pathname === '/api/campanas' && method === 'POST') {
      if (!esJefeIncentivos(me)) return sendJSON(res, 403, { error: 'Solo el supervisor puede crear campañas' });
      const body = await readBody(req);
      const nombre = texto(body.nombre, 120);
      const fechaInicio = texto(body.fechaInicio, 10), fechaFin = texto(body.fechaFin, 10);
      if (!nombre || !fechaValida(fechaInicio) || !fechaValida(fechaFin) || fechaFin < fechaInicio) {
        return sendJSON(res, 400, { error: 'Nombre y rango de fechas válidos son obligatorios' });
      }
      const productos = (Array.isArray(body.productos) ? body.productos : []).map(p => {
        const nom = texto(p && p.nombre, 120);
        const unidad = (p && p.unidad === 'kg') ? 'kg' : 'L';
        return nom ? { nombre: nom, unidad: unidad, precioBase: numero(p.precioBase) } : null;
      }).filter(Boolean).slice(0, 100);
      if (!productos.length) return sendJSON(res, 400, { error: 'Agrega al menos un producto con precio base' });
      const vistos = new Set();
      const participantes = (Array.isArray(body.participantes) ? body.participantes : []).map(p => {
        const vendedorId = texto(p && p.vendedorId, 60);
        const promotorId = texto(p && p.promotorId, 60);
        if (!vendedorId || vistos.has(vendedorId)) return null;
        const vendedor = globalDb.users.find(u => u.id === vendedorId);
        const promotor = promotorId ? globalDb.users.find(u => u.id === promotorId) : null;
        if (!vendedor || ROLES_VENDEDOR.indexOf(vendedor.role) < 0) return null;
        if (promotorId && (!promotor || promotor.role !== 'promotor')) return null;
        vistos.add(vendedorId);
        const pv = Math.min(100, numero(p.pctVendedor !== undefined ? p.pctVendedor : 50));
        return { vendedorId, vendedorNombre: vendedor.name, promotorId: promotor ? promotor.id : '',
          promotorNombre: promotor ? promotor.name : '', pctVendedor: pv, pctPromotor: Math.round((100 - pv) * 100) / 100 };
      }).filter(Boolean).slice(0, 200);
      if (!participantes.length) return sendJSON(res, 400, { error: 'Agrega al menos un representante participante' });
      const idsCfg = idsVisiblesPara(me);
      if (idsCfg !== null && participantes.some(p => idsCfg.indexOf(p.vendedorId) < 0)) {
        return sendJSON(res, 403, { error: 'Solo puedes incluir representantes de tu equipo' });
      }
      const camp = {
        id: uidInc('c'), nombre, fechaInicio, fechaFin,
        condiciones: texto(body.condiciones, 2000),
        productos, participantes,
        activa: body.activa !== false,
        createdBy: me.id, createdAt: Date.now(), updatedAt: Date.now()
      };
      campanas.push(camp);
      saveCampanas();
      return sendJSON(res, 201, { campana: camp, puedeConfigurar: true });
    }

    const campMatch = pathname.match(/^\/api\/campanas\/([^/]+)$/);
    if (campMatch && (method === 'PUT' || method === 'DELETE')) {
      if (!esJefeIncentivos(me)) return sendJSON(res, 403, { error: 'Solo el supervisor puede modificar campañas' });
      const camp = campanas.find(c => c.id === campMatch[1]);
      if (!camp) return sendJSON(res, 404, { error: 'Campaña no encontrada' });
      if (method === 'DELETE') {
        const hijas = incentivos.filter(i => i.campanaId === camp.id);
        if (hijas.length) {
          // Borrar campaña con ventas (incluso pagadas) exige confirmación
          // explícita y borra TODAS sus ventas en cascada. Sin ella, nada se toca.
          const body = await readBody(req);
          if (body.confirmar !== 'BORRAR') {
            return sendJSON(res, 400, { error: 'La campaña tiene ' + hijas.length + ' ventas. Envía confirmar: "BORRAR" para eliminarlas también.' });
          }
          incentivos = incentivos.filter(i => i.campanaId !== camp.id);
          saveIncentivos();
        }
        campanas = campanas.filter(c => c.id !== camp.id);
        saveCampanas();
        return sendJSON(res, 200, { ok: true, ventasBorradas: hijas.length });
      }
      const body = await readBody(req);
      if (body.nombre !== undefined) camp.nombre = texto(body.nombre, 120) || camp.nombre;
      if (body.condiciones !== undefined) camp.condiciones = texto(body.condiciones, 2000);
      if (body.fechaInicio !== undefined && fechaValida(body.fechaInicio)) camp.fechaInicio = body.fechaInicio;
      if (body.fechaFin !== undefined && fechaValida(body.fechaFin)) camp.fechaFin = body.fechaFin;
      if (camp.fechaFin < camp.fechaInicio) return sendJSON(res, 400, { error: 'La fecha de fin debe ser posterior al inicio' });
      if (body.activa !== undefined) camp.activa = !!body.activa;
      if (Array.isArray(body.productos)) {
        camp.productos = body.productos.map(p => {
          const nom = texto(p && p.nombre, 120);
          return nom ? { nombre: nom, unidad: p.unidad === 'kg' ? 'kg' : 'L', precioBase: numero(p.precioBase) } : null;
        }).filter(Boolean).slice(0, 100);
        if (!camp.productos.length) return sendJSON(res, 400, { error: 'La campaña debe tener al menos un producto' });
      }
      if (Array.isArray(body.participantes)) {
        camp.participantes = body.participantes.map(p => {
          const vendedorId = texto(p && p.vendedorId, 60);
          const u = globalDb.users.find(x => x.id === vendedorId);
          const prom = globalDb.users.find(x => x.id === texto(p && p.promotorId, 60));
          if (!u || ROLES_VENDEDOR.indexOf(u.role) < 0) return null;
          const pv = Math.min(100, numero(p.pctVendedor !== undefined ? p.pctVendedor : 50));
          return { vendedorId, vendedorNombre: u.name, promotorId: prom && prom.role === 'promotor' ? prom.id : '',
            promotorNombre: prom && prom.role === 'promotor' ? prom.name : '',
            pctVendedor: pv, pctPromotor: Math.round((100 - pv) * 100) / 100 };
        }).filter(Boolean).slice(0, 200);
        if (!camp.participantes.length) return sendJSON(res, 400, { error: 'Debe quedar al menos un participante' });
      }
      camp.updatedAt = Date.now();
      saveCampanas();
      return sendJSON(res, 200, { campana: camp });
    }

    if (pathname === '/api/incentivos' && method === 'GET') {
      if (!puedeVerIncentivos(me)) return sendJSON(res, 403, { error: 'Sin acceso a incentivos' });
      const campanaId = texto(url.searchParams.get('campanaId'), 60);
      const ids = idsVisiblesPara(me);
      let lista = incentivos.slice();
      if (campanaId) lista = lista.filter(i => i.campanaId === campanaId);
      // El representante (retail/KAM) SOLO ve sus propias ventas, aunque tenga
      // gente a cargo: incentivos no usa el alcance de equipo de idsVisiblesPara.
      // El promotor ve las suyas + las que le generan incentivo (fue asignado
      // por el supervisor a ese vendedor). Jefes/coordinador ven su alcance.
      if (me.role === 'retail' || me.role === 'kam') {
        lista = lista.filter(i => i.ownerId === me.id);
      } else if (me.role === 'promotor') {
        lista = lista.filter(i => i.ownerId === me.id || i.promotorId === me.id);
      } else if (ids !== null) {
        lista = lista.filter(i => ids.indexOf(i.ownerId) >= 0 || ids.indexOf(i.promotorId) >= 0);
      }
      lista.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (b.createdAt || 0) - (a.createdAt || 0));
      return sendJSON(res, 200, {
        ventas: lista,
        puedeAprobar: esJefeIncentivos(me),
        puedeExportar: esJefeIncentivos(me) || me.role === 'coordinador'
      });
    }

    if (pathname === '/api/incentivos' && method === 'POST') {
      if (ROLES_VENDEDOR.indexOf(me.role) < 0 && !esJefeIncentivos(me)) {
        return sendJSON(res, 403, { error: 'Solo los representantes pueden cargar ventas' });
      }
      const body = await readBody(req);
      const camp = campanas.find(c => c.id === texto(body.campanaId, 60));
      if (!camp) return sendJSON(res, 400, { error: 'Campaña no encontrada' });
      if (!camp.activa) return sendJSON(res, 400, { error: 'La campaña está cerrada' });
      const ownerId = esJefeIncentivos(me) && body.ownerId ? texto(body.ownerId, 60) : me.id;
      const part = participanteDe(camp, ownerId);
      if (!part) return sendJSON(res, 400, { error: 'Ese representante no participa en la campaña' });
      if (!esJefeIncentivos(me) && ownerId !== me.id) return sendJSON(res, 403, { error: 'Solo puedes cargar tus propias ventas' });
      const idsOwner = idsVisiblesPara(me);
      if (idsOwner !== null && idsOwner.indexOf(ownerId) < 0) {
        return sendJSON(res, 403, { error: 'No tienes permiso sobre ese representante' });
      }
      const fecha = texto(body.fecha, 10);
      if (!fechaValida(fecha) || fecha < camp.fechaInicio || fecha > camp.fechaFin) {
        return sendJSON(res, 400, { error: 'La fecha debe estar dentro del rango de la campaña (' + camp.fechaInicio + ' a ' + camp.fechaFin + ')' });
      }
      const producto = texto(body.producto, 120);
      const prod = productoDe(camp, producto);
      if (!prod) return sendJSON(res, 400, { error: 'Producto no válido para esta campaña' });
      const cliente = texto(body.cliente, 200);
      if (!cliente) return sendJSON(res, 400, { error: 'El cliente es obligatorio' });
      const cantidad = numero(body.cantidad);
      if (cantidad <= 0) return sendJSON(res, 400, { error: 'La cantidad debe ser mayor a cero' });
      const facturado = numero(body.precioFacturado);
      const calc = calcularIncentivo(prod.precioBase, facturado, cantidad, part.pctVendedor, part.pctPromotor);
      const venta = {
        id: uidInc('i'), campanaId: camp.id, campanaNombre: camp.nombre,
        ownerId, ownerNombre: part.vendedorNombre,
        promotorId: part.promotorId || '', promotorNombre: part.promotorNombre || '',
        cliente, fecha, producto: prod.nombre, unidad: prod.unidad, cantidad,
        precioBase: prod.precioBase, precioFacturado: facturado,
        utilidad: calc.utilidad, incentivoVendedor: calc.incentivoVendedor, incentivoPromotor: calc.incentivoPromotor,
        pctVendedor: calc.pctVendedor, pctPromotor: calc.pctPromotor,
        estado: 'Pendiente', pagado: false, fechaPago: '',
        observaciones: texto(body.observaciones, 500),
        createdBy: me.id, createdAt: Date.now(), updatedAt: Date.now()
      };
      incentivos.push(venta);
      saveIncentivos();
      return sendJSON(res, 201, { venta });
    }

    const incMatch = pathname.match(/^\/api\/incentivos\/([^/]+)\/(aprobar|rechazar)$/);
    if (incMatch && method === 'PUT') {
      if (!esJefeIncentivos(me)) return sendJSON(res, 403, { error: 'Solo el supervisor puede aprobar ventas' });
      const venta = incentivos.find(i => i.id === incMatch[1]);
      if (!venta) return sendJSON(res, 404, { error: 'Venta no encontrada' });
      if (venta.pagado) return sendJSON(res, 400, { error: 'No se puede cambiar una venta ya pagada' });
      venta.estado = incMatch[2] === 'aprobar' ? 'Aprobado' : 'Rechazado';
      venta.revisadoPor = me.id; venta.revisadoNombre = me.name; venta.updatedAt = Date.now();
      saveIncentivos();
      return sendJSON(res, 200, { venta });
    }

    if (pathname === '/api/incentivos/pagar' && method === 'POST') {
      if (!esJefeIncentivos(me)) return sendJSON(res, 403, { error: 'Solo el supervisor puede registrar pagos' });
      const body = await readBody(req);
      const campanaId = texto(body.campanaId, 60);
      const ownerId = texto(body.ownerId, 60);
      const fechaPago = texto(body.fechaPago, 10);
      if (!campanaId || !ownerId || !fechaValida(fechaPago)) {
        return sendJSON(res, 400, { error: 'Campaña, representante y fecha de pago son obligatorios' });
      }
      const ids = idsVisiblesPara(me);
      if (ids !== null && ids.indexOf(ownerId) < 0) return sendJSON(res, 403, { error: 'No tienes permiso sobre ese representante' });
      let n = 0;
      incentivos.forEach(i => {
        if (i.campanaId === campanaId && i.ownerId === ownerId && i.estado === 'Aprobado' && !i.pagado) {
          i.pagado = true; i.fechaPago = fechaPago; i.pagadoPor = me.id; i.updatedAt = Date.now(); n++;
        }
      });
      if (n) saveIncentivos();
      return sendJSON(res, 200, { pagadas: n });
    }

    const incDel = pathname.match(/^\/api\/incentivos\/([^/]+)$/);
    if (incDel && method === 'DELETE') {
      const venta = incentivos.find(i => i.id === incDel[1]);
      if (!venta) return sendJSON(res, 404, { error: 'Venta no encontrada' });
      const dueno = venta.ownerId === me.id || venta.createdBy === me.id;
      if (!esJefeIncentivos(me) && !dueno) return sendJSON(res, 403, { error: 'No puedes borrar esta venta' });
      if (venta.pagado) return sendJSON(res, 400, { error: 'No se puede borrar una venta ya pagada' });
      if (!esJefeIncentivos(me) && (!dueno || venta.estado !== 'Pendiente')) {
        return sendJSON(res, 400, { error: 'Solo puedes borrar tus ventas pendientes' });
      }
      incentivos = incentivos.filter(i => i.id !== venta.id);
      saveIncentivos();
      return sendJSON(res, 200, { ok: true });
    }

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

// ---------------- Red de seguridad del proceso ----------------
// Sin esto, un fallo puntual de disco (por ejemplo al guardar) lanza una
// excepcion no capturada y MATA el proceso Node: Render lo reinicia, pero si
// el fallo se repite entra en bucle y la app queda caida. Con estos manejadores
// el error se registra y el servidor sigue sirviendo.
process.on('uncaughtException', (err) => {
  console.error('[excepción no capturada]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (err) => {
  console.error('[promesa rechazada sin manejar]', err && err.stack ? err.stack : err);
});

// ---------------- Inicialización ----------------
try { fs.mkdirSync(path.join(DATA_DIR, 'data'), { recursive: true }); } catch (e) { /* ya existe */ }
try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (e) { /* ya existe */ }
loadGlobalData();
loadIncentivosData();
loadModulesRegistry();
migrate();
seed();

server.listen(PORT, HOST, () => {
  console.log(`Rainbow Platform (Modular) corriendo en http://localhost:${PORT}`);
  console.log(`Módulos activos: ${modulesRegistry.modules.filter(m => m.active).map(m => m.name).join(', ')}`);
});
