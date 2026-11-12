#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Descifra un backup cifrado con tools/cifrar-backup.js
//
//   node tools/descifrar-backup.js <archivo.enc> <salida.json> [contrasena]
//
// Formato del archivo .enc: SALT(16) | IV(12) | TAG(16) | DATOS
// ---------------------------------------------------------------------------

const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');

function pedirContrasena(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.output.write(prompt);
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
    console.log('Uso: node tools/descifrar-backup.js <archivo.enc> <salida.json> [contrasena]');
    process.exit(1);
  }
  if (!fs.existsSync(entrada)) {
    console.error('No existe el archivo: ' + entrada);
    process.exit(1);
  }

  const contrasena = process.argv[4] || await pedirContrasena('Contrasena: ');
  const buf = fs.readFileSync(entrada);

  if (buf.length < 44) {
    console.error('El archivo esta danado o no es un backup cifrado.');
    process.exit(1);
  }
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const datos = buf.subarray(44);

  const clave = crypto.scryptSync(contrasena, salt, 32);
  try {
    const descifrador = crypto.createDecipheriv('aes-256-gcm', clave, iv);
    descifrador.setAuthTag(tag);
    const claro = Buffer.concat([descifrador.update(datos), descifrador.final()]);
    fs.writeFileSync(salida, claro);
    console.log('\nDescifrado: ' + salida);
    console.log('  Tamaño: ' + (claro.length / 1024).toFixed(1) + ' KB');
  } catch (e) {
    console.error('No se pudo descifrar: contrasena incorrecta o archivo danado.');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('ERROR: ' + e.message);
  process.exit(1);
});
