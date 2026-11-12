#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Rainbow Platform - Utilidad de copia de seguridad
//
//   node tools/backup.js descargar [carpeta]   -> baja un snapshot de produccion
//   node tools/backup.js restaurar <archivo>  -> restaura un snapshot
//
// Guarda los backups FUERA del repositorio: el repo de GitHub es PUBLICO y un
// snapshot contiene los hashes de las contrasenas de los usuarios.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DEFAULT_BASE = 'https://planificacion-ventas-rainbow.onrender.com';
const DEFAULT_USER = 'hector';
const DEFAULT_PASS = 'rainbow2026';

function pedir(opciones, body) {
  return new Promise((resolve, reject) => {
    const modulos = opciones.url.startsWith('https') ? https : http;
    const headers = Object.assign({}, opciones.headers || {});
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = modulos.request(opciones.url, { method: opciones.method || 'GET', headers }, (res) => {
      let datos = '';
      res.on('data', c => datos += c);
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return pedir(Object.assign({}, opciones, { url: res.headers.location }), body).then(resolve, reject);
        }
        let json = null;
        try { json = JSON.parse(datos); } catch (e) { /* no es JSON */ }
        if (res.statusCode >= 400) {
          return reject(new Error('HTTP ' + res.statusCode + ': ' + (json && json.error ? json.error : datos.slice(0, 200))));
        }
        resolve({ status: res.statusCode, headers: res.headers, json, texto: datos });
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Tiempo de espera agotado')); });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function extraerCookie(headers) {
  const raw = headers['set-cookie'];
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const c of arr) {
    const m = /^sid=([^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

function marcaTiempo() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

async function main() {
  const cmd = process.argv[2];
  const base = (process.env.RAINBOW_URL || DEFAULT_BASE).replace(/\/$/, '');
  const user = process.env.RAINBOW_USER || DEFAULT_USER;
  const pass = process.env.RAINBOW_PASS || DEFAULT_PASS;

  if (!cmd || cmd === 'ayuda' || cmd === '--help') {
    console.log([
      'Uso:',
      '  node tools/backup.js descargar [carpeta]',
      '  node tools/backup.js restaurar <archivo.json>',
      '',
      'Variables opcionales: RAINBOW_URL, RAINBOW_USER, RAINBOW_PASS'
    ].join('\n'));
    return;
  }

  // --- Sesion ---
  const login = await pedir({
    url: base + '/api/login', method: 'POST'
  }, JSON.stringify({ username: user, password: pass }));
  const cookie = extraerCookie(login.headers);
  if (!cookie) throw new Error('No se pudo iniciar sesión (revisa RAINBOW_USER / RAINBOW_PASS)');
  console.log('Sesión iniciada como ' + user);

  if (cmd === 'descargar') {
    const destino = process.argv[3] || path.join(__dirname, '..', '..', 'backups-rainbow');
    fs.mkdirSync(destino, { recursive: true });

    const resp = await pedir({
      url: base + '/api/admin/backup', method: 'GET',
      headers: { Cookie: 'sid=' + cookie }
    });
    if (!resp.json || !resp.json.ok) throw new Error('El servidor no devolvió un snapshot');

    const archivo = path.join(destino, 'rainbow-backup-' + marcaTiempo() + '.json');
    fs.writeFileSync(archivo, JSON.stringify(resp.json.snapshot, null, 2), 'utf8');

    const r = resp.json.resumen || {};
    console.log('\nBackup descargado:');
    console.log('  Archivo   : ' + archivo);
    console.log('  Tamaño    : ' + (fs.statSync(archivo).size / 1024).toFixed(1) + ' KB');
    console.log('  Usuarios  : ' + r.usuarios);
    console.log('  Metas     : ' + (r.metas || 0));
    console.log('  ToDo      : ' + (r.todos || 0));
    console.log('  Registros : ' + (r.modulos || []).map(m => m.id + '=' + m.registros).join(', '));
    console.log('\nGuarda este archivo en un lugar seguro (Drive, OneDrive, disco externo).');
    console.log('NO lo subas a GitHub: el repositorio es publico y el snapshot tiene');
    console.log('los hashes de las contrasenas de los usuarios.');
    return;
  }

  if (cmd === 'restaurar') {
    const archivo = process.argv[3];
    if (!archivo) throw new Error('Indica el archivo a restaurar');
    if (!fs.existsSync(archivo)) throw new Error('No existe el archivo: ' + archivo);
    const snapshot = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    if (!snapshot || !Array.isArray(snapshot.usuarios)) throw new Error('El archivo no es un snapshot valido');

    const resumen = snapshot.usuarios.length + ' usuarios, ' +
      ((snapshot.modulos && snapshot.modulos.ventas && snapshot.modulos.ventas.rows && snapshot.modulos.ventas.rows.rows) || []).length + ' registros de ventas.';
    console.log('\nA RESTAURAR: ' + resumen);
    console.log('Se guardara antes una copia del estado actual (pre-restore).');
    if (!process.argv.includes('--si')) {
      console.log('\nEjecuta de nuevo con --si para confirmar.');
      return;
    }
    const resp = await pedir({
      url: base + '/api/admin/restore', method: 'POST',
      headers: { Cookie: 'sid=' + cookie }
    }, JSON.stringify({ confirmar: 'RESTAURAR', snapshot: snapshot }));
    console.log('\nRestauracion completada:');
    console.log('  ' + JSON.stringify(resp.json.restaurado));
    return;
  }

  throw new Error('Comando desconocido: ' + cmd);
}

main().catch(e => {
  console.error('\nERROR: ' + e.message);
  process.exit(1);
});
