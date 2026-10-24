'use strict';
// Genera íconos PNG (sin dependencias) para la PWA.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const crcTable = (function () {
  const c = [];
  for (let n = 0; n < 256; n++) { let x = n; for (let k = 0; k < 8; k++) x = (x & 1) ? (0xEDB88320 ^ (x >>> 1)) : (x >>> 1); c[n] = x >>> 0; }
  return c;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const cd = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cd), 0);
  return Buffer.concat([len, cd, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      const p = y * width + x;
      raw[o] = rgba[p * 4]; raw[o + 1] = rgba[p * 4 + 1]; raw[o + 2] = rgba[p * 4 + 2]; raw[o + 3] = rgba[p * 4 + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function makeIcon(S) {
  const buf = new Uint8Array(S * S * 4);
  function set(x, y, r, g, b, a) { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a; }
  function rect(x0, y0, x1, y1, r, g, b, a) { for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) set(x, y, r, g, b, a); }
  rect(0, 0, S, S, 31, 111, 235, 255);            // fondo azul marca
  const base = S * 0.74, bw = S * 0.12;
  const xs = [S * 0.24, S * 0.44, S * 0.64];
  const hs = [S * 0.36, S * 0.50, S * 0.28];
  for (let i = 0; i < 3; i++) rect(xs[i], base - hs[i], xs[i] + bw, base, 255, 255, 255, 255); // barras blancas
  rect(S * 0.20, base, S * 0.80, base + S * 0.03, 255, 255, 255, 255);                       // línea base
  return Buffer.from(buf);
}
const out = [
  [512, 'icon-512.png'],
  [192, 'icon-192.png'],
  [180, 'apple-touch-icon.png'],
  [64, 'favicon.png']
];
out.forEach(([s, f]) => {
  const png = encodePNG(s, s, makeIcon(s));
  fs.writeFileSync(path.join('public', f), png);
  console.log('generado', f, s + 'x' + s, '(' + png.length + ' bytes)');
});
