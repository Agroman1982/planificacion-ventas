#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Cifra un snapshot de backup con AES-256-GCM.
// El resultado es un archivo .enc que se puede guardar en Drive, OneDrive o
// cualquier nube sin担心: sin la contrasena no se puede leer.
//
//   node tools/cifrar-backup.js <archivo.json> <salida.enc> [contrasena]
//
// Sin argumentos, pide la contrasena por consola.
// ---------------------------------------------------------------------------

const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');

function pedirContrasena(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Oculta lo que se escribe
    const onData = char => {
      if (['\n', '\r', ''].includes(char.toString('utf8'))) return;
      readline.moveCursor(process.stdout, -1, 0);
      readline.clearLine(process.stdout, 0);
      process.stdout.write('*');
    };
    rl.output.write(prompt);
    rl.on('keypress', (char) => { if (char.toString('utf8') !== '\r') onData(char); });
    rl.question('', (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const entrada = process.argv[2];
  const salida = process.argv[3];
  if (!entrada || !salida) {
    console.log('Uso: node tools/cifrar-backup.js <archivo.json> <salida.enc> [contrasena]');
    process.exit(1);
  }
  if (!fs.existsSync(entrada)) {
    console.error('No existe el archivo: ' + entrada);
    process.exit(1);
  }

  const contrasena = process.argv[4] || await pedirContrasena('Contrasena para cifrar: ');
  if (!contrasena || contrasena.length < 8) {
    console.error('La contrasena debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const datos = fs.readFileSync(entrada);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const clave = crypto.scryptSync(contrasena, salt, 32);

  const cifrador = crypto.createCipheriv('aes-256-gcm', clave, iv);
  const cifrado = Buffer.concat([cifrador.update(datos), cifrador.final()]);
  const tag = cifrador.getAuthTag();

  // Formato: SALT(16) | IV(12) | TAG(16) | DATOS
  const archivo = Buffer.concat([salt, iv, tag, cifrado]);
  fs.writeFileSync(salida, archivo);

  console.log('\nCifrado: ' + salida);
  console.log('  Tamaño  : ' + (archivo.length / 1024).toFixed(1) + ' KB');
  console.log('  Algoritmo: AES-256-GCM');
  console.log('\nGuarda la contrasena en un lugar SEPARADO de este archivo.');
  console.log('Sin ella, el archivo no se puede descifrar.');
}

main().catch(e => {
  console.error('ERROR: ' + e.message);
  process.exit(1);
});
