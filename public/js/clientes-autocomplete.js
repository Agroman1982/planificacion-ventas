/**
 * Rainbow Platform - Autocompletado del listado maestro de clientes.
 * Componente independiente (sin librerías) para la app modular /app.
 * El listado es único y lo sirve GET /api/clients para todos los usuarios.
 * Busca por cualquier palabra del nombre, ignora tildes y signos, y permite
 * texto libre (el servidor marcará el nombre nuevo como cliente potencial).
 */
(function (root) {
  'use strict';

  var lista = [];
  var cargando = null;
  var instancias = [];
  var estilosPuestos = false;

  function normalizar(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim().replace(/\s+/g, ' ');
  }
  function tokens(s) {
    var limpio = normalizar(s).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!limpio) return [];
    var todas = limpio.split(/\s+/);
    var utiles = todas.filter(function (x) { return x.length >= 2; });
    return utiles.length ? utiles : todas;
  }
  function puntaje(nombre, toks) {
    if (!toks.length) return 0;
    var n = normalizar(nombre), palabras = tokens(nombre), score = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], p = -1;
      if (palabras.some(function (w) { return w.indexOf(t) === 0; })) p = 3;
      else if (palabras.some(function (w) { return w.indexOf(t) > 0; })) p = 2;
      else if (n.indexOf(t) >= 0) p = 1;
      if (p < 0) return -1;
      score += p;
    }
    var frase = toks.join(' ');
    if (n.indexOf(frase) === 0) score += 12;
    else if (n.indexOf(frase) >= 0) score += 6;
    return score;
  }
  function filtrar(query, limite) {
    var toks = tokens(query), res = [];
    if (!toks.length) return lista.slice(0, limite || 80);
    lista.forEach(function (c) {
      var p = puntaje(c, toks);
      if (p >= 0) res.push({ nombre: c, p: p });
    });
    res.sort(function (a, b) { return b.p - a.p || a.nombre.localeCompare(b.nombre, 'es'); });
    return res.slice(0, limite || 80).map(function (x) { return x.nombre; });
  }
  function totalCoincidencias(query) {
    return tokens(query).length ? filtrar(query, 5000).length : lista.length;
  }
  function resaltar(nombre, toks) {
    var frag = document.createDocumentFragment();
    nombre.split(/(\s+)/).forEach(function (parte) {
      if (/^\s+$/.test(parte)) { frag.appendChild(document.createTextNode(parte)); return; }
      var p = parte.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (toks.length && toks.some(function (t) { return p.indexOf(t) >= 0; })) {
        var b = document.createElement('span'); b.className = 'ac-mark'; b.textContent = parte;
        frag.appendChild(b);
      } else frag.appendChild(document.createTextNode(parte));
    });
    return frag;
  }
  function ponerEstilos() {
    if (estilosPuestos) return;
    estilosPuestos = true;
    var css = '.ac-wrap{position:relative}' +
      '.ac-menu{position:absolute;z-index:90;left:0;right:0;top:calc(100% + 4px);max-height:230px;overflow-y:auto;' +
      'background:#fff;border:1px solid var(--line,#CBD5E1);border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.18)}' +
      '.ac-menu.hide,.ac-hint.hide{display:none}' +
      '.ac-item{padding:9px 11px;font-size:14px;cursor:pointer;border-bottom:1px solid #EEF2F6;color:#0F172A}' +
      '.ac-item:last-child{border-bottom:none}' +
      '.ac-item:hover,.ac-item.on{background:#E8F3EE}' +
      '.ac-empty{padding:9px 11px;font-size:13px;color:#64748B}' +
      '.ac-foot{padding:7px 11px;font-size:11px;color:#64748B;background:#F8FAFC;' +
      'border-top:1px solid #E2E8F0;position:sticky;bottom:0}' +
      '.ac-mark{background:#DCFCE7;border-radius:3px;font-weight:700}' +
      '.ac-hint{font-size:12px;margin-top:5px;font-weight:600;color:#B45309}' +
      '.ac-hint.info{color:#64748B;font-weight:400}';
    var st = document.createElement('style');
    st.textContent = css;
    (document.head || document.body).appendChild(st);
  }
  function cargar() {
    if (cargando) return cargando;
    cargando = fetch('/api/clients', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        lista = (d && (d.clientes || d.shared)) || [];
        cargando = null;
        instancias.forEach(function (f) { try { f(); } catch (e) {} });
        return lista;
      })
      .catch(function () { cargando = null; return lista; });
    return cargando;
  }

  function adjuntar(input) {
    if (!input || input.getAttribute('data-ac-clientes')) return;
    ponerEstilos();
    input.setAttribute('data-ac-clientes', '1');
    input.setAttribute('autocomplete', 'off');
    if (!input.placeholder || /cartera/i.test(input.placeholder)) {
      input.placeholder = 'Escriba el nombre o una palabra del cliente…';
    }
    var wrap = document.createElement('div'); wrap.className = 'ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var menu = document.createElement('div'); menu.className = 'ac-menu hide'; wrap.appendChild(menu);
    var hint = document.createElement('div'); hint.className = 'ac-hint hide'; wrap.appendChild(hint);

    var activo = -1, actuales = [];
    function cerrar() { menu.classList.add('hide'); activo = -1; }
    function actualizarHint(modo, n) {
      var val = normalizar(input.value);
      hint.classList.add('hide'); hint.classList.remove('info');
      if (!val) return;
      if (!lista.length) {
        hint.textContent = 'Cargando listado de clientes…';
        hint.classList.add('info'); hint.classList.remove('hide'); return;
      }
      if (lista.some(function (c) { return normalizar(c) === val; })) return;
      if (modo === 'typing' && n > 0) return;
      hint.innerHTML = 'No está en el listado → se guardará como <b>cliente potencial</b>';
      hint.classList.remove('hide');
    }
    function pintar() {
      var q = input.value, toks = tokens(q);
      var res = filtrar(q, 80);
      var total = totalCoincidencias(q);
      actuales = res; activo = -1; menu.innerHTML = '';
      if (!res.length) {
        var e = document.createElement('div'); e.className = 'ac-empty';
        e.textContent = lista.length ? 'Sin coincidencias en el listado' : 'Cargando listado…';
        menu.appendChild(e);
      } else {
        res.forEach(function (nombre) {
          var it = document.createElement('div'); it.className = 'ac-item';
          it.appendChild(resaltar(nombre, toks));
          it.addEventListener('mousedown', function (ev) {
            ev.preventDefault(); input.value = nombre; cerrar(); actualizarHint('blur');
          });
          menu.appendChild(it);
        });
        var foot = document.createElement('div'); foot.className = 'ac-foot';
        foot.textContent = (total > res.length ? res.length + ' de ' + total + ' resultados · ' : '')
          + '↑↓ elegir · Enter seleccionar · Esc cerrar';
        menu.appendChild(foot);
      }
      menu.classList.remove('hide');
      actualizarHint('typing', res.length);
    }
    function mover(d) {
      if (menu.classList.contains('hide')) { pintar(); return; }
      if (!actuales.length) return;
      activo = (activo + d + actuales.length) % actuales.length;
      Array.prototype.forEach.call(menu.querySelectorAll('.ac-item'), function (el, i) {
        el.classList.toggle('on', i === activo);
      });
      var on = menu.querySelector('.ac-item.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
    input.addEventListener('focus', function () { if (!lista.length) cargar(); pintar(); });
    input.addEventListener('input', pintar);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
      else if (e.key === 'Enter' && !menu.classList.contains('hide') && activo >= 0) {
        e.preventDefault(); input.value = actuales[activo]; cerrar(); actualizarHint('blur');
      } else if (e.key === 'Enter' || e.key === 'Escape') cerrar();
    });
    input.addEventListener('blur', function () {
      setTimeout(function () { cerrar(); actualizarHint('blur'); }, 140);
    });
    instancias.push(function () {
      if (!menu.classList.contains('hide')) pintar(); else actualizarHint('blur');
    });
  }

  root.RainbowClientes = {
    cargar: cargar,
    adjuntar: adjuntar,
    filtrar: filtrar,
    normalizar: normalizar,
    tokens: tokens,
    get lista() { return lista; }
  };
})(window);
