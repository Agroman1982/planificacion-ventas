/* RainbowXLSX - Generador de archivos .xlsx REALES, sin librerias externas.
 *
 * Uso:
 *   RainbowXLSX.descargar('reporte.xlsx', [
 *     { name:'Detalle',
 *       cols:[ {label:'Cliente',width:34,type:'text'},
 *              {label:'Fecha',width:14,type:'date'},
 *              {label:'Monto programado (US$)',width:24,type:'money'},
 *              {label:'Monto ejecutado (US$)',width:24,type:'money'},
 *              {label:'% Cumplimiento',width:18,type:'pct'} ],
 *       rows:[ ['Agro Marino','2026-11-03',15000,3150,0.21] ],
 *       total:['TOTAL','',15000,3150,0.21] }   // opcional, va en negrita
 *   ]);
 *
 * type: 'text' | 'date' (YYYY-MM-DD) | 'money' | 'number' | 'pct' (fraccion: 0.21 = 21%)
 * Los numeros se escriben como numeros de verdad (se pueden sumar/ordenar en Excel),
 * las fechas como fechas y los porcentajes como porcentajes. No depende del separador
 * decimal ni del separador de columnas configurado en Excel.
 */
(function (root) {
  'use strict';

  var XLS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

  function xml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function colLetter(n) {
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s || 'A';
  }

  // ---- CRC32 + ZIP "stored" (sin compresion, valido para XLSX) ----
  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    CRC_TABLE = t;
    return t;
  }
  function crc32(buf) {
    var t = crcTable(), c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipParts(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var d = new Date();
    var dosTime = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31);
    var dosDate = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);

    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data, crc = crc32(data);
      var lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);   // firma local
      lv.setUint16(4, 20, true);           // version necesaria
      lv.setUint16(6, 0x0800, true);       // nombres UTF-8
      lv.setUint16(8, 0, true);            // sin compresion
      lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh, data);

      var ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + data.length;
    });

    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });
    var eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);

    var all = parts.concat(central, [eocd]), total = 0;
    all.forEach(function (p) { total += p.length; });
    var buf = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { buf.set(p, pos); pos += p.length; });
    return buf;
  }

  // ---- Estilos: 0 normal, 1 cabecera, 2 fecha, 3 money, 4 pct, 5 number,
  //              6 texto negrita, 7 money negrita, 8 pct negrita, 9 number negrita
  function stylesXml() {
    function xf(numFmt, font, fill, align) {
      var s = '<xf numFmtId="' + numFmt + '" fontId="' + font + '" fillId="' + fill + '" borderId="0" xfId="0"';
      if (numFmt) s += ' applyNumberFormat="1"';
      if (font) s += ' applyFont="1"';
      if (fill) s += ' applyFill="1"';
      if (align) s += ' applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>';
      else s += '/>';
      return s;
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<styleSheet xmlns="' + XLS_NS + '">'
      + '<numFmts count="4">'
      + '<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>'
      + '<numFmt numFmtId="165" formatCode="#,##0.00"/>'
      + '<numFmt numFmtId="166" formatCode="0.0%"/>'
      + '<numFmt numFmtId="167" formatCode="#,##0"/>'
      + '</numFmts>'
      + '<fonts count="3">'
      + '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
      + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
      + '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'
      + '</fonts>'
      + '<fills count="3">'
      + '<fill><patternFill patternType="none"/></fill>'
      + '<fill><patternFill patternType="gray125"/></fill>'
      + '<fill><patternFill patternType="solid"><fgColor rgb="FF1F6F54"/><bgColor indexed="64"/></patternFill></fill>'
      + '</fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="10">'
      + xf(0, 0, 0, false) + xf(0, 1, 2, true)
      + xf(164, 0, 0, false) + xf(165, 0, 0, false) + xf(166, 0, 0, false) + xf(167, 0, 0, false)
      + xf(0, 2, 0, false) + xf(165, 2, 0, false) + xf(166, 2, 0, false) + xf(167, 2, 0, false)
      + '</cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '<dxfs count="0"/>'
      + '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
      + '</styleSheet>';
  }

  function excelSerial(v) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    return Math.round(Date.UTC(y, mo - 1, da) / 86400000) + 25569;
  }
  function styleFor(type, bold) {
    if (type === 'date') return 2;
    if (type === 'money') return bold ? 7 : 3;
    if (type === 'number') return bold ? 9 : 5;
    if (type === 'pct') return bold ? 8 : 4;
    return bold ? 6 : 0;
  }
  function cellXml(ref, val, type, bold) {
    var s = styleFor(type, bold);
    if (val === null || val === undefined || val === '') return '<c r="' + ref + '" s="' + s + '"/>';
    if (type === 'money' || type === 'number' || type === 'pct') {
      var n = Number(val);
      if (!isFinite(n)) n = 0;
      return '<c r="' + ref + '" s="' + s + '"><v>' + n + '</v></c>';
    }
    if (type === 'date') {
      var ser = excelSerial(val);
      if (ser !== null) return '<c r="' + ref + '" s="2"><v>' + ser + '</v></c>';
    }
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + xml(val) + '</t></is></c>';
  }

  function sheetXml(sheet) {
    var cols = sheet.cols || [], data = sheet.rows || [];
    var nCols = Math.max(cols.length, 1);
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="' + XLS_NS + '">'
      + '<sheetViews><sheetView workbookViewId="0">'
      + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
      + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
      + '</sheetView></sheetViews>'
      + '<sheetFormatPr defaultRowHeight="15"/><cols>';
    cols.forEach(function (c, i) {
      x += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (Number(c.width) || 18) + '" customWidth="1"/>';
    });
    x += '</cols><sheetData><row r="1" ht="26" customHeight="1">';
    cols.forEach(function (c, i) {
      x += '<c r="' + colLetter(i + 1) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' + xml(c.label) + '</t></is></c>';
    });
    x += '</row>';
    data.forEach(function (row, ri) {
      var r = ri + 2;
      x += '<row r="' + r + '">';
      cols.forEach(function (c, ci) { x += cellXml(colLetter(ci + 1) + r, row[ci], c.type, false); });
      x += '</row>';
    });
    if (sheet.total) {
      var tr = data.length + 2;
      x += '<row r="' + tr + '">';
      cols.forEach(function (c, ci) { x += cellXml(colLetter(ci + 1) + tr, sheet.total[ci], c.type, true); });
      x += '</row>';
    }
    x += '</sheetData>';
    if (data.length) x += '<autoFilter ref="A1:' + colLetter(nCols) + (data.length + 1) + '"/>';
    x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>';
    x += '</worksheet>';
    return x;
  }

  function build(sheets) {
    if (!sheets || !sheets.length) sheets = [{ name: 'Hoja1', cols: [{ label: '', width: 18 }], rows: [] }];
    var enc = new TextEncoder(), files = [];
    function add(name, str) { files.push({ name: name, data: enc.encode(str) }); }

    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    sheets.forEach(function (s, i) {
      ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    });
    ct += '</Types>';
    add('[Content_Types].xml', ct);

    add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="' + PKG_REL_NS + '">'
      + '<Relationship Id="rId1" Type="' + REL_NS + '/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>');

    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="' + XLS_NS + '" xmlns:r="' + REL_NS + '"><sheets>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="' + PKG_REL_NS + '">';
    sheets.forEach(function (s, i) {
      var name = String(s.name || ('Hoja' + (i + 1))).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31);
      wb += '<sheet name="' + xml(name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      rels += '<Relationship Id="rId' + (i + 1) + '" Type="' + REL_NS + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      add('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s));
    });
    wb += '</sheets></workbook>';
    rels += '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + REL_NS + '/styles" Target="styles.xml"/></Relationships>';
    add('xl/workbook.xml', wb);
    add('xl/_rels/workbook.xml.rels', rels);
    add('xl/styles.xml', stylesXml());
    return zipParts(files);
  }

  function descargar(filename, sheets) {
    var buf = build(sheets);
    var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'reporte.xlsx';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  var api = { build: build, descargar: descargar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RainbowXLSX = api;
})(typeof window !== 'undefined' ? window : globalThis);
