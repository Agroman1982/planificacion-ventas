/**
 * Rainbow Platform - Herramientas del modulo Planificacion de Ventas.
 *
 * Se montan sobre la app unificada (app.html). Reutilizan exactamente los
 * mismos endpoints que usaba la app original (index.html), por lo que no
 * requieren ningun cambio en el servidor ni migracion de datos.
 *
 * Puente esperado (window.__RB): api, $, esc, toast, me, rows, ownerNames,
 * module, schema, render, renderForm, loadRows, openDetail.
 */
(function () {
  'use strict';

  var RB = null;
  var ROLE_LABEL = { admin: 'Administrador', supervisor: 'Supervisor', coordinador: 'Coordinador', retail: 'Vendedor Retail', kam: 'KAM (Agroindustria)', promotor: 'Promotor' };
  var ROLES = ['admin', 'supervisor', 'coordinador', 'retail', 'kam', 'promotor'];
  // Regla de negocio: SOLO estos roles tienen meta de ventas y pueden ser
  // elegidos como "vendedor". Coordinadores, supervisores y admin son jefes
  // de equipo: no llevan meta propia ni aparecen en la tabla de metas.
  var ROLES_VENDEDOR = ['retail', 'kam', 'promotor'];
  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var ESTADOS = ['En curso', 'Realizado', 'No realizado'];
  // "En curso" = gris claro (pendiente). El texto se ajusta por contraste.
  var ESTADO_COLOR = { 'En curso': '#D1D5DB', 'Realizado': '#4caf50', 'No realizado': '#f44336' };
  var MES_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  // Un color distinto por representante cuando el filtro esta en "Todos".
  var PALETTE = ['#1D4ED8', '#15803D', '#B45309', '#6D28D9', '#BE123C', '#0F766E', '#C2410C', '#334155', '#1E40AF', '#166534', '#9D174D', '#155E75'];
  var DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  var st = {
    usuarios: [], canManageTeam: false, tieneEquipo: false,
    myGoal: null, teamGoals: [], goalsCache: {}, metaMonth: 0, metaYear: 0,
    // Panel superior de metas: periodo, plegado, metas del periodo y
    // contador de peticiones (descarta respuestas viejas al cambiar de mes).
    pMes: 0, pAnio: 0, pAbierto: true, pGoals: {}, pReq: 0,
    todos: [], pendingTodoId: null,
    vista: 'calendario', calY: 0, calM: 0,
    catalogo: { clientes: [], editable: false, total: 0 }, catTrabajo: [],
    fSemana: '', fEstado: '', fOwner: '',
    editUserId: null
  };

  function me() { return RB.me(); }
  function rows() { return RB.rows(); }
  function ownerNames() { return RB.ownerNames(); }
  function api(m, p, b) { return RB.api(m, p, b); }
  function $(id) { return document.getElementById(id); }
  // Escape HTML propio: el esc() de app.html solo convierte a String y no
  // protege atributos ni texto, asi que aqui usamos uno completo.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(t) { RB.toast(t); }
  function money(n) { n = Number(n) || 0; return 'US$ ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  // Tinta legible sobre el color de la pastilla del calendario: los estados
  // claros (En curso, gris claro) necesitan texto oscuro.
  function tinta(color) {
    var h = String(color || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#fff';
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.65 ? '#334155' : '#fff';
  }
  function frac(r, p) { r = Number(r) || 0; p = Number(p) || 0; if (p > 0) return r / p; if (r > 0) return 1; return 0; }
  function pct(r, p) { return (frac(r, p) * 100).toFixed(0) + '%'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hoy() { return iso(new Date()); }

  // Replica EXACTA de etiquetaSemanaDesdeFecha() del servidor: numero de semana
  // ISO + rango lunes..domingo. Se usa solo para mostrar el valor automatico
  // en el formulario; el servidor siempre recalcula al guardar.
  function etiquetaSemana(s) {
    if (typeof s !== 'string' || !s) return '';
    var p = s.split('-'); if (p.length < 3) return '';
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d.getTime())) return '';
    var dow = d.getDay() || 7;
    var lun = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (dow - 1));
    var dom = new Date(lun.getFullYear(), lun.getMonth(), lun.getDate() + 6);
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var tdow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - tdow);
    var ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var n = Math.ceil((((t - ys) / 86400000) + 1) / 7);
    var rango = lun.getMonth() === dom.getMonth()
      ? lun.getDate() + '-' + dom.getDate() + ' ' + MES_ABBR[dom.getMonth()]
      : lun.getDate() + ' ' + MES_ABBR[lun.getMonth()] + '-' + dom.getDate() + ' ' + MES_ABBR[dom.getMonth()];
    return 'Sem ' + n + ' (' + rango + ')';
  }

  // Mantiene "semana" siempre sincronizada con "dia" y bloqueada.
  function ligarSemana(idDia, idSemana) {
    var dia = $(idDia), sem = $(idSemana);
    if (!dia || !sem) return;
    sem.readOnly = true;
    sem.title = 'Se calcula automaticamente a partir de la fecha';
    function sync() { setVal(idSemana, etiquetaSemana(val(idDia))); }
    if (!dia._vtSemanaLigada) {
      dia._vtSemanaLigada = true;
      dia.addEventListener('input', sync);
      dia.addEventListener('change', sync);
    }
    sync();
  }

  function esJefe() { var u = me(); return !!(u && (u.role === 'admin' || u.role === 'supervisor' || u.role === 'coordinador' || st.canManageTeam || st.tieneEquipo)); }
  function veVarios() { return esJefe(); }
  function esVendedor(u) { return !!u && ROLES_VENDEDOR.indexOf(u.role) >= 0; }
  function reps() { return st.usuarios.filter(esVendedor); }
  function setVal(id, v) { var e = $(id); if (e) e.value = v == null ? '' : v; }
  function val(id) { var e = $(id); return e ? e.value.trim() : ''; }

  // ------------------------------------------------------------------
  // Construccion del DOM: barra de herramientas, filtros y modal comun
  // ------------------------------------------------------------------
  function construirDOM() {
    var host = $('vtToolbar');
    if (!host) return;
    host.innerHTML =
      '<div class="card vt-toolbar">' +
      '  <div class="vt-botones">' +
      '    <span class="muted vt-etiqueta">Vistas:</span>' +
      '    <button class="ghost small" data-vt="calendario">Calendario</button>' +
      '    <button class="ghost small" data-vt="lista">Lista</button>' +
      '    <button class="ghost small" data-vt="resumen">Resumen</button>' +
      '    <span style="flex:1"></span>' +
      '    <button class="ghost small" data-vt="metas" id="vtMetas">Metas</button>' +
      '    <button class="ghost small" data-vt="todo" id="vtTodo">ToDo <span id="vtTodoNum" class="vt-todo-num cero">0</span></button>' +
      '    <button class="ghost small" data-vt="clientes" id="vtClientes">Clientes</button>' +
      '    <button class="ghost small" data-vt="usuarios" id="vtUsuarios">Vendedores</button>' +
      '  </div>' +
      '  <div class="grid vt-filtros">' +
      '    <div><label>Filtrar por semana</label><input id="vtFSemana" placeholder="Ej. Sem 42"></div>' +
      '    <div><label>Filtrar por estado</label><select id="vtFEstado"><option value="">Todos</option>' +
      ESTADOS.map(function (e) { return '<option value="' + e + '">' + e + '</option>'; }).join('') + '</select></div>' +
      '    <div id="vtFOwnerWrap"><label>Vendedor (equipo)</label><select id="vtFOwner"><option value="">Todos</option></select></div>' +
      '  </div>' +
      '</div>';

    host.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-vt]') : null;
      if (!b) return;
      accion(b.getAttribute('data-vt'));
    });

    ['vtFSemana', 'vtFEstado', 'vtFOwner'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', leerFiltros);
      el.addEventListener('change', leerFiltros);
    });

    var ov = document.createElement('div');
    ov.className = 'overlay hide';
    ov.id = 'vtOverlay';
    ov.innerHTML = '<div class="modal" id="vtModal">' +
      '<div class="vt-modal-hd"><h2 id="vtTitulo"></h2><button class="ghost small" id="vtCerrar">Cerrar</button></div>' +
      '<div id="vtCuerpo"></div></div>';
    document.body.appendChild(ov);
    $('vtCerrar').onclick = cerrarModal;
    ov.addEventListener('click', function (e) { if (e.target === ov) cerrarModal(); });

    construirPanelMetas();
    construirTodoPanel();
  }

  function abrirModal(titulo, html, listo) {
    $('vtTitulo').textContent = titulo;
    $('vtCuerpo').innerHTML = html;
    $('vtOverlay').classList.remove('hide');
    if (listo) listo($('vtCuerpo'));
  }
  function cerrarModal() { var o = $('vtOverlay'); if (o) o.classList.add('hide'); }
  function error(id, msg, ok) {
    var e = $(id); if (!e) return;
    e.textContent = msg || '';
    e.style.color = ok ? 'var(--ok)' : 'var(--bad)';
  }

  // ------------------------------------------------------------------
  // Panel superior de metas de venta.
  //
  // Se alimenta de tres fuentes que YA respetan la jerarquia del servidor:
  //   /api/users  -> solo el usuario y su personal a cargo
  //   /api/goals  -> metas de esos mismos usuarios (month=0 = todo el año)
  //   RB.rows()   -> filas visibles, de donde se suma ventaRealizada
  // Por eso un supervisor ve las ventas de su equipo y nadie ve datos de
  // otro equipo. No hay ningun cambio en el backend.
  // ------------------------------------------------------------------
  function construirPanelMetas() {
    var host = $('vtMetaTop');
    if (!host) return;
    host.innerHTML =
      '<div class="card vt-mtop">' +
      '  <div class="vt-mtop-hd">' +
      '    <div><h2 id="vtMtopTitulo">Metas de venta</h2><div class="vt-mtop-sub" id="vtMtopSub"></div></div>' +
      '    <div class="vt-mtop-hd-r">' +
      '      <div class="vt-mtop-year">' +
      '        <button class="ghost small" id="vtMtopPrevA" title="Año anterior">&#8249;</button>' +
      '        <b id="vtMtopAnio"></b>' +
      '        <button class="ghost small" id="vtMtopNextA" title="Año siguiente">&#8250;</button>' +
      '      </div>' +
      '      <button class="ghost small vt-mtop-toggle" id="vtMtopToggle">Ocultar</button>' +
      '    </div>' +
      '  </div>' +
      '  <div id="vtMtopContenido">' +
      '    <div class="vt-mtop-tabs" id="vtMtopTabs"></div>' +
      '    <div class="vt-mtop-body" id="vtMtopBody"><span class="muted">Cargando metas...</span></div>' +
      '  </div>' +
      '</div>';

    $('vtMtopTabs').onclick = function (e) {
      var b = e.target.closest ? e.target.closest('[data-mes]') : null;
      if (!b) return;
      st.pMes = Number(b.getAttribute('data-mes'));
      refrescarPanel();
    };
    $('vtMtopPrevA').onclick = function () { st.pAnio--; refrescarPanel(); };
    $('vtMtopNextA').onclick = function () { st.pAnio++; refrescarPanel(); };
    $('vtMtopToggle').onclick = function () {
      st.pAbierto = !st.pAbierto;
      try { localStorage.setItem('rb.metas.abierto', st.pAbierto ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
      aplicarAperturaPanel();
    };
    aplicarAperturaPanel();
  }

  function aplicarAperturaPanel() {
    var c = $('vtMtopContenido'), b = $('vtMtopToggle');
    if (c) c.classList.toggle('hide', !st.pAbierto);
    if (b) b.textContent = st.pAbierto ? 'Ocultar' : 'Ver metas';
  }

  function refrescarPanel() {
    if (!RB || RB.module() !== 'ventas' || !$('vtMtopBody')) return;
    pintarPanelMetas();                 // pestañas y periodo al instante
    var n = ++st.pReq, anio = st.pAnio, mes = st.pMes;
    api('GET', '/api/goals?month=' + mes + '&year=' + anio).then(function (res) {
      if (n !== st.pReq || RB.module() !== 'ventas') return;  // respuesta vieja
      st.pGoals = {};
      if (res.ok) (res.data.goals || []).forEach(function (g) {
        st.pGoals[g.userId] = (st.pGoals[g.userId] || 0) + (Number(g.amount) || 0);
      });
      pintarPanelMetas();
    });
  }

  function pintarPanelMetas() {
    var u = me();
    if (!u || !RB || RB.module() !== 'ventas' || !$('vtMtopBody')) return;
    var anio = st.pAnio, mes = st.pMes, total = mes === 0, ahora = new Date();
    var soyVendedor = esVendedor(u);
    var periodo = total ? 'Total anual ' + anio : MESES[mes - 1] + ' ' + anio;
    var alcance = soyVendedor ? 'Tu meta personal'
      : (u.role === 'admin' ? 'Todos los vendedores' : 'Tu equipo a cargo');
    $('vtMtopTitulo').textContent = 'Metas de venta — ' + periodo;
    $('vtMtopAnio').textContent = anio;
    $('vtMtopSub').textContent = alcance + ' · ' + (total ? 'suma de los 12 meses' : MESES[mes - 1]);

    var tabs = [{ m: 0, t: 'TOTAL' }].concat(MES_ABBR.map(function (t, i) { return { m: i + 1, t: t }; }));
    $('vtMtopTabs').innerHTML = tabs.map(function (x) {
      var cls = 'vt-mtop-tab' + (x.m === mes ? ' active' : '') +
        (x.m > 0 && x.m === ahora.getMonth() + 1 && anio === ahora.getFullYear() ? ' now' : '');
      return '<button type="button" class="' + cls + '" data-mes="' + x.m + '">' + x.t + '</button>';
    }).join('');

    // Venta realizada del periodo por vendedor. Se suma ventaRealizada de
    // todas las actividades visibles, igual que en el panel original.
    var realizado = {}, acts = {};
    rows().forEach(function (r) {
      if (!r.dia) return;
      var p = String(r.dia).split('-');
      if (Number(p[0]) !== anio) return;
      if (!total && Number(p[1]) !== mes) return;
      var id = r.ownerId || u.id;
      realizado[id] = (realizado[id] || 0) + (Number(r.ventaRealizada) || 0);
      acts[id] = (acts[id] || 0) + 1;
    });

    function avance(r, g) { return g > 0 ? Math.min(100, r / g * 100) : 0; }
    // Sin meta asignada no se inventa un 0%: se muestra una raya.
    function porcentaje(r, g) { return g > 0 ? pct(r, g) : '—'; }
    function barra(r, g) {
      var over = g > 0 && r >= g;
      return '<div class="vt-bar"><i class="' + (over ? 'over' : '') + '" style="width:' + avance(r, g).toFixed(1) + '%"></i></div>';
    }

    // Solo vendedores (retail / kam / promotor): ni coordinadores, ni
    // supervisores, ni admin tienen meta de ventas ni aparecen como filas.
    var vistos = {};
    var lista = (st.usuarios.length ? st.usuarios : [u]).filter(function (x) {
      if (!x || !x.id || !esVendedor(x) || vistos[x.id]) return false;
      vistos[x.id] = true; return true;
    });
    var tMeta = 0, tReal = 0, tActs = 0, sinMeta = 0;
    lista.forEach(function (x) {
      var g = st.pGoals[x.id] || 0, r = realizado[x.id] || 0;
      if (!g) sinMeta++;
      tMeta += g; tReal += r; tActs += (acts[x.id] || 0);
    });

    // Un jefe sin meta propia ve los TOTALES DE SU EQUIPO en los 4 KPIs,
    // en lugar de un "Mi meta US$ 0,00 / Sin meta asignada" sin sentido.
    var kpiMeta = soyVendedor ? (st.pGoals[u.id] || 0) : tMeta;
    var kpiReal = soyVendedor ? (realizado[u.id] || 0) : tReal;
    var kpiActs = soyVendedor ? (acts[u.id] || 0) : tActs;
    var notaMeta = soyVendedor
      ? (kpiMeta > 0 ? periodo : 'Sin meta asignada')
      : (lista.length ? lista.length + ' vendedores · ' + periodo : 'Sin vendedores a cargo');
    var html = '<div class="vt-kpis">' +
      '<div class="vt-kpi"><span>' + (soyVendedor ? 'Mi meta' : 'Meta del equipo') + '</span><b>' + money(kpiMeta) + '</b><small>' + notaMeta + '</small></div>' +
      '<div class="vt-kpi"><span>Realizado</span><b>' + money(kpiReal) + '</b><small>' + kpiActs + ' actividades</small></div>' +
      '<div class="vt-kpi"><span>Falta</span><b>' + money(Math.max(0, kpiMeta - kpiReal)) + '</b><small>' + (kpiMeta > 0 && kpiReal >= kpiMeta ? '¡Meta cumplida!' : 'para llegar a la meta') + '</small></div>' +
      '<div class="vt-kpi"><span>% Cumplimiento</span><b>' + porcentaje(kpiReal, kpiMeta) + '</b><small>' + (kpiMeta > 0 ? 'sobre la meta' : 'sin meta asignada') + '</small></div>' +
      '</div>' + barra(kpiReal, kpiMeta);

    if (lista.length > 1) {
      var filas = lista.map(function (x) {
        var g = st.pGoals[x.id] || 0, r = realizado[x.id] || 0;
        var yo = x.id === u.id;
        var cls = (yo ? 'vt-mtop-yo' : '') + (st.fOwner === x.id ? ' vt-mtop-sel' : '');
        return '<tr data-uid="' + esc(x.id) + '" class="' + cls + '" title="Click para filtrar la vista por ' + esc(x.name) + '">' +
          '<td>' + esc(x.name) + (yo ? ' <b>(yo)</b>' : '') +
            '<div class="vt-mtop-nota" style="margin:0">' + esc(ROLE_LABEL[x.role] || x.role) + ' · ' + (acts[x.id] || 0) + ' activ.</div></td>' +
          '<td class="r">' + money(g) + '</td>' +
          '<td class="r">' + money(r) + '</td>' +
          '<td class="r">' + money(Math.max(0, g - r)) + '</td>' +
          '<td class="r">' + porcentaje(r, g) + '<div class="vt-mtop-mini"><i style="width:' + avance(r, g).toFixed(1) + '%"></i></div></td>' +
          '</tr>';
      }).join('');
      html += '<div class="vt-mtop-team"><table><thead><tr>' +
        '<th>Vendedor</th><th class="r">Meta</th><th class="r">Realizado</th><th class="r">Falta</th><th class="r">%</th>' +
        '</tr></thead><tbody>' + filas +
        '<tr class="vt-mtop-total"><td>Total (' + lista.length + ' vendedores)</td><td class="r">' + money(tMeta) + '</td>' +
        '<td class="r">' + money(tReal) + '</td><td class="r">' + money(Math.max(0, tMeta - tReal)) + '</td>' +
        '<td class="r">' + porcentaje(tReal, tMeta) + '</td></tr>' +
        '</tbody></table></div>' + barra(tReal, tMeta) +
        '<div class="vt-mtop-nota">Avance del equipo. ' + (sinMeta ? sinMeta + ' sin meta asignada en este periodo. ' : '') +
        'Click en un vendedor para filtrar la vista.</div>';
    } else {
      html += '<div class="vt-mtop-nota">' + (soyVendedor
        ? 'Solo ves tus propias ventas. La venta realizada se suma de las actividades del periodo.'
        : (lista.length ? 'Un vendedor a cargo. La venta realizada se suma de las actividades del periodo.'
          : 'No hay vendedores visibles a cargo en este periodo.')) + '</div>';
    }
    var body = $('vtMtopBody');
    body.innerHTML = html;
    body.querySelectorAll('[data-uid]').forEach(function (tr) {
      tr.onclick = function () {
        var id = tr.getAttribute('data-uid');
        st.fOwner = (st.fOwner === id) ? '' : id;
        var sel = $('vtFOwner'); if (sel) sel.value = st.fOwner;
        pintarPanelMetas();   // refleja la fila seleccionada
        RB.render();          // aplica el filtro a Calendario / Lista / Resumen
      };
    });
    aplicarAperturaPanel();
  }

  function actualizarPermisos() {
    if (!$('vtToolbar')) return;
    var u = me(); if (!u) return;
    var jefe = esJefe();
    // ToDo es visible para TODOS: cada usuario debe ver sus tareas asignadas.
    // El alta de tareas sigue siendo exclusiva de jefes de equipo.
    [['vtMetas', jefe], ['vtClientes', u.role === 'admin' || u.role === 'supervisor'], ['vtUsuarios', u.role === 'admin']].forEach(function (p) {
      var el = $(p[0]); if (el) el.classList.toggle('hide', !p[1]);
    });
    var asignar = $('vtTodoAsignar'); if (asignar) asignar.classList.toggle('hide', !jefe);
    var fw = $('vtFOwnerWrap'); if (fw) fw.classList.toggle('hide', !jefe);
    var sel = $('vtFOwner');
    if (sel && jefe) {
      var cur = st.fOwner;
      sel.innerHTML = '<option value="">Todos</option>' + st.usuarios.map(function (x) {
        return '<option value="' + esc(x.id) + '">' + esc(x.name) + (x.id === u.id ? ' (yo)' : '') + '</option>';
      }).join('');
      sel.value = cur || '';
    }
    document.querySelectorAll('[data-vt]').forEach(function (b) {
      b.classList.toggle('vt-activo', b.getAttribute('data-vt') === (st.vista || 'lista'));
    });
  }

  function leerFiltros() {
    st.fSemana = val('vtFSemana');
    st.fEstado = $('vtFEstado') ? $('vtFEstado').value : '';
    st.fOwner = $('vtFOwner') ? $('vtFOwner').value : '';
    RB.render();
  }

  function filtrar(lista) {
    return (lista || []).filter(function (r) {
      if (st.fSemana && String(r.semana || '').toLowerCase().indexOf(st.fSemana.toLowerCase()) < 0) return false;
      if (st.fEstado && r.estado !== st.fEstado) return false;
      if (st.fOwner && r.ownerId !== st.fOwner) return false;
      return true;
    });
  }

  function accion(nombre) {
    if (nombre === 'lista' || nombre === 'calendario' || nombre === 'resumen') {
      st.vista = nombre === 'lista' ? null : nombre;
      actualizarPermisos();
      RB.render();
      return;
    }
    if (nombre === 'metas') abrirMetas();
    if (nombre === 'todo') abrirTodo();
    if (nombre === 'clientes') abrirClientes();
    if (nombre === 'usuarios') abrirUsuarios();
  }

  // ------------------------------------------------------------------
  // Formulario: selector de representante para jefes de equipo
  // ------------------------------------------------------------------
  function decorarFormulario() {
    var f = $('dynamicForm');
    if (!f || RB.module() !== 'ventas') return;

    // 1) Semana automatica y NO editable para cualquier rol (incluido admin).
    ligarSemana('field_dia', 'field_semana');

    // 2) Estado: oculto. Todo registro nuevo nace en "En curso"; al editar
    //    se conserva el estado real (Realizado / No realizado).
    var est = $('field_estado');
    if (est) {
      if (est.parentElement) est.parentElement.style.display = 'none';
      if (!est.value || est.value === 'Planificado') est.value = 'En curso';
    }
    // La venta lograda tampoco se elige al crear: se responde en el detalle.
    var logr = $('field_ventaLograda');
    if (logr) {
      if (logr.parentElement) logr.parentElement.style.display = 'none';
      if (!logr.value) logr.value = 'Pendiente';
    }

    if (!esJefe()) return;
    var sel = $('vtOwner');
    if (!sel) {
      var grid = f.querySelector('.grid') || f;
      var wrap = document.createElement('div');
      wrap.style.gridColumn = '1/-1';
      wrap.innerHTML = '<label>Representante</label><select id="vtOwner"></select>';
      grid.appendChild(wrap);
      sel = $('vtOwner');
    }
    // Se repuebla siempre: /api/users puede llegar despues de renderizar el
    // formulario y, si no se refresca, el equipo apareceria vacio.
    var anterior = sel.value;
    var u = me();
    var candidatos = reps().slice();
    if (candidatos.length === 0 && u) candidatos = [u];
    sel.innerHTML = (u ? '<option value="' + esc(u.id) + '">' + esc(u.name) + ' (yo)</option>' : '') +
      candidatos.filter(function (x) { return !u || x.id !== u.id; }).map(function (x) {
        return '<option value="' + esc(x.id) + '">' + esc(x.name) + ' (' + esc(ROLE_LABEL[x.role] || x.role) + ')</option>';
      }).join('');
    if (anterior && Array.prototype.some.call(sel.options, function (o) { return o.value === anterior; })) sel.value = anterior;
    else if (u) sel.value = u.id;
  }

  // ------------------------------------------------------------------
  // Metas mensuales
  // ------------------------------------------------------------------
  function abrirMetas() {
    var y = new Date().getFullYear();
    var html = '<div class="grid" style="margin-bottom:12px">' +
      '<div><label>Mes</label><select id="vtGoalMonth">' + MESES.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + '</option>'; }).join('') + '</select></div>' +
      '<div><label>A&ntilde;o</label><select id="vtGoalYear">' + [y - 1, y, y + 1, y + 2].map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('') + '</select></div>' +
      '</div>' +
      '<label class="vt-check"><input type="checkbox" id="vtGoalTotal"> Ver total anual (suma de los 12 meses)</label>' +
      '<div id="vtMetaResumen" class="vt-panel"></div>' +
      '<h3 style="margin:14px 0 8px">Metas del equipo</h3>' +
      '<div id="vtGoalHint" class="muted" style="font-size:12px;margin:0 0 6px"></div>' +
      '<div style="overflow-x:auto"><table class="vt-tbl" id="vtGoalsTable"></table></div>' +
      '<div id="vtGoalErr" class="vt-err"></div>' +
      '<button id="vtSaveGoals" style="margin-top:12px">Guardar metas</button>';
    abrirModal('Metas de venta', html, function () {
      setVal('vtGoalMonth', st.metaMonth || new Date().getMonth() + 1);
      setVal('vtGoalYear', st.metaYear || y);
      $('vtGoalMonth').onchange = cargarMetas;
      $('vtGoalYear').onchange = cargarMetas;
      $('vtGoalTotal').onchange = cargarMetas;
      $('vtSaveGoals').onclick = guardarMetas;
      cargarMetas();
    });
  }

  function cargarMetas() {
    var m = Number($('vtGoalMonth').value), y = Number($('vtGoalYear').value);
    var total = $('vtGoalTotal').checked;
    st.metaMonth = m; st.metaYear = y;
    var url = '/api/goals?month=' + (total ? 0 : m) + '&year=' + y;
    api('GET', url).then(function (res) {
      if (!res.ok) { error('vtGoalErr', res.data.error || 'No se pudieron cargar las metas'); return; }
      st.goalsCache = {};
      var goles = res.data.goals || [];
      goles.forEach(function (g) { st.goalsCache[g.userId] = (st.goalsCache[g.userId] || 0) + Number(g.amount || 0); });
      pintarMetas(m, y, total);
    });
  }

  function pintarMetas(m, y, total) {
    var u = me();
    var realizadoPorUsuario = {};
    rows().forEach(function (r) {
      if (!r.dia) return;
      var p = String(r.dia).split('-');
      if (Number(p[0]) !== y) return;
      if (!total && Number(p[1]) !== m) return;
      realizadoPorUsuario[r.ownerId] = (realizadoPorUsuario[r.ownerId] || 0) + Number(r.ventaRealizada || 0);
    });
    // Los jefes (supervisor / coordinador / admin) no tienen meta propia:
    // el resumen del modal tambien muestra el agregado de sus vendedores.
    var lista = reps().filter(function (x) { return x.id !== u.id; });
    var tMeta = 0, tReal = 0;
    lista.forEach(function (x) {
      tMeta += st.goalsCache[x.id] || 0;
      tReal += realizadoPorUsuario[x.id] || 0;
    });
    var jefe = !esVendedor(u);
    var kMeta = jefe ? tMeta : (st.goalsCache[u.id] || 0);
    var kReal = jefe ? tReal : (realizadoPorUsuario[u.id] || 0);
    $('vtMetaResumen').innerHTML = '<div class="vt-meta-grid">' +
      '<div><span>' + (jefe ? 'Meta del equipo' : 'Mi meta') + '</span><b>' + money(kMeta) + '</b></div>' +
      '<div><span>Realizado</span><b>' + money(kReal) + '</b></div>' +
      '<div><span>Falta</span><b>' + money(Math.max(0, kMeta - kReal)) + '</b></div>' +
      '<div><span>Cumplimiento</span><b>' + pct(kReal, kMeta) + '</b></div>' +
      '</div>';
    // En modo "total anual" las celdas son sumas de 12 meses: son de solo
    // lectura, porque guardarlas en un mes concreto destruiria el detalle.
    var soloLectura = !!total;
    var hint = $('vtGoalHint');
    if (hint) hint.textContent = soloLectura
      ? 'Vista anual de solo lectura. Desmarca "Ver total anual" para editar las metas de un mes.'
      : '';
    var btn = $('vtSaveGoals');
    if (btn) { btn.disabled = soloLectura; btn.title = soloLectura ? 'Desmarca el total anual para editar' : ''; }

    var t = $('vtGoalsTable');
    t.innerHTML = '<tr><th>Integrante</th><th>Meta (US$)</th><th>Realizado</th><th>%</th></tr>';
    if (!lista.length) t.innerHTML += '<tr><td colspan="4" class="muted">No hay vendedores visibles.</td></tr>';
    lista.forEach(function (x) {
      var g = st.goalsCache[x.id] || 0, r = realizadoPorUsuario[x.id] || 0;
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(x.name) + ' <span class="muted">(' + esc(ROLE_LABEL[x.role] || x.role) + ')</span></td>' +
        '<td><input type="number" min="0" step="0.01" class="vt-goal-input" data-uid="' + esc(x.id) + '" value="' + (st.goalsCache[x.id] !== undefined ? g : '') + '"' + (soloLectura ? ' disabled' : '') + '></td>' +
        '<td>' + money(r) + '</td><td>' + pct(r, g) + '</td>';
      t.appendChild(tr);
    });
  }

  function guardarMetas() {
    error('vtGoalErr', '');
    if ($('vtGoalTotal') && $('vtGoalTotal').checked) {
      error('vtGoalErr', 'Desmarca "Ver total anual" para editar metas mensuales.');
      return;
    }
    var m = Number($('vtGoalMonth').value), y = Number($('vtGoalYear').value);
    var pend = [];
    document.querySelectorAll('#vtGoalsTable .vt-goal-input').forEach(function (inp) {
      var v = inp.value.trim();
      if (v === '') return;
      var uid = inp.getAttribute('data-uid');
      var anterior = st.goalsCache[uid] || 0;
      if (Number(v) !== anterior) pend.push(api('POST', '/api/goals', { userId: uid, amount: v, month: m, year: y }));
    });
    if (!pend.length) { error('vtGoalErr', 'No hay cambios que guardar.'); return; }
    Promise.all(pend).then(function (rs) {
      if (rs.every(function (r) { return r.ok; })) {
        error('vtGoalErr', 'Metas guardadas correctamente.', true);
        cargarMetas();
        refrescarPanel();   // el panel superior refleja el cambio al instante
      } else error('vtGoalErr', 'No se pudieron guardar todas las metas.');
    });
  }

  // ------------------------------------------------------------------
  // ToDo del supervisor
  // ------------------------------------------------------------------
  // Panel ToDo siempre visible (representante y supervisor). Antes el ToDo
  // solo existia dentro de un modal y el boton se ocultaba a los vendedores.
  function construirTodoPanel() {
    var host = $('vtTodoTop');
    if (!host) return;
    host.innerHTML =
      '<div class="card vt-todo-top">' +
      '  <div class="vt-todo-hd">' +
      '    <div><h2>ToDo <span id="vtTodoBadge" class="vt-todo-badge">0</span></h2>' +
      '    <div class="vt-todo-sub" id="vtTodoSub"></div></div>' +
      '    <div class="vt-todo-hd-r">' +
      '      <button class="small" id="vtTodoAsignar">+ Asignar tarea</button>' +
      '      <button class="ghost small" id="vtTodoRefrescar" title="Actualizar lista">Actualizar</button>' +
      '    </div>' +
      '  </div>' +
      '  <div id="vtTodoCuerpo" class="vt-todo-cuerpo"></div>' +
      '</div>';
    $('vtTodoAsignar').onclick = abrirTodo;
    $('vtTodoRefrescar').onclick = cargarTodos;
  }

  function htmlTarea(t, on) {
    return '<div class="vt-todo"><div class="vt-todo-info">' +
      '<b>' + esc(t.cliente || 'Sin cliente') + '</b>' +
      (t.ubicacion ? '<div>' + esc(t.ubicacion) + '</div>' : '') +
      (t.trabajo ? '<div>' + esc(t.trabajo) + '</div>' : '') +
      (t.producto ? '<div>Producto: ' + esc(t.producto) + '</div>' : '') +
      (t.ventaConcretar > 0 ? '<div>Objetivo: ' + money(t.ventaConcretar) + '</div>' : '') +
      (t.assigneeName ? '<div>Asignado a: <b>' + esc(t.assigneeName) + '</b></div>' : (t.assigneeId && on[t.assigneeId] ? '<div>Asignado a: <b>' + esc(on[t.assigneeId]) + '</b></div>' : '')) +
      '</div><div class="vt-todo-acc">' +
      '<button class="small" data-todo="' + esc(t.id) + '">Programar</button> ' +
      (esJefe() ? '<button class="ghost small" data-borrar-todo="' + esc(t.id) + '">Borrar</button>' : '') +
      '</div></div>';
  }

  function ligarTareas(box) {
    box.querySelectorAll('[data-todo]').forEach(function (b) {
      b.onclick = function () { programarTodo(b.getAttribute('data-todo')); };
    });
    box.querySelectorAll('[data-borrar-todo]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Eliminar esta tarea ToDo?')) return;
        api('DELETE', '/api/todos/' + b.getAttribute('data-borrar-todo')).then(function (r) {
          if (r.ok) cargarTodos(); else toast(r.data.error || 'No se pudo eliminar');
        });
      };
    });
  }

  function pintarTodoPanel() {
    var cuerpo = $('vtTodoCuerpo');
    if (!cuerpo) return;
    var jefe = esJefe(), n = st.todos.length;
    $('vtTodoSub').textContent = jefe
      ? 'Tareas pendientes de tu equipo · "Programar" las carga en el formulario'
      : 'Tus tareas pendientes · "Programar" las carga en el formulario';
    var badge = $('vtTodoBadge'); if (badge) badge.textContent = n;
    var asignar = $('vtTodoAsignar'); if (asignar) asignar.classList.toggle('hide', !jefe);
    var num = $('vtTodoNum');
    if (num) { num.textContent = n; num.classList.toggle('cero', !n); }
    if (!n) {
      cuerpo.innerHTML = '<div class="vt-todo-vacio">No hay tareas pendientes. ' +
        (jefe ? 'Usa «+ Asignar tarea» para crear una.' : 'Las tareas que te asignen aparecerán aquí.') + '</div>';
      return;
    }
    var on = ownerNames();
    cuerpo.innerHTML = st.todos.map(function (t) { return htmlTarea(t, on); }).join('');
    ligarTareas(cuerpo);
  }

  function cargarTodos() {
    return api('GET', '/api/todos').then(function (res) {
      if (res.ok) st.todos = res.data.todos || [];
      if ($('vtTodoLista')) pintarTodos();
      pintarTodoPanel();
    });
  }

  function abrirTodo() {
    var html = '<div id="vtTodoLista"></div>' +
      '<div id="vtTodoFormWrap">' +
      '<h3 style="margin:16px 0 8px">Asignar nueva tarea</h3>' +
      '<div class="grid">' +
      '<div><label>Representante</label><select id="vtTodoAssignee"></select></div>' +
      '<div><label>Cliente</label><input id="vtTodoCliente"></div>' +
      '<div><label>Ubicaci&oacute;n</label><input id="vtTodoUbicacion"></div>' +
      '<div><label>Producto</label><input id="vtTodoProducto"></div>' +
      '<div style="grid-column:1/-1"><label>Trabajo a realizar</label><textarea id="vtTodoTrabajo"></textarea></div>' +
      '<div><label>Venta a concretar (US$)</label><input id="vtTodoVenta" type="number" min="0" step="0.01"></div>' +
      '<div><label>Observaciones</label><input id="vtTodoObs"></div>' +
      '</div><div id="vtTodoErr" class="vt-err"></div>' +
      '<button id="vtSaveTodo" style="margin-top:12px">Asignar tarea</button></div>';
    abrirModal('Tareas ToDo', html, function () {
      var sel = $('vtTodoAssignee');
      sel.innerHTML = reps().filter(function (x) { return x.id !== me().id; }).map(function (x) {
        return '<option value="' + esc(x.id) + '">' + esc(x.name) + ' (' + esc(ROLE_LABEL[x.role] || x.role) + ')</option>';
      }).join('');
      $('vtSaveTodo').onclick = guardarTodo;
      // El representante ve la lista, pero NO puede asignar tareas.
      var wrap = $('vtTodoFormWrap'); if (wrap) wrap.classList.toggle('hide', !esJefe());
      pintarTodos();
      cargarTodos();
    });
  }

  function pintarTodos() {
    var box = $('vtTodoLista'); if (!box) return;
    if (!st.todos.length) { box.innerHTML = '<p class="muted">No hay tareas pendientes de programar.</p>'; return; }
    var on = ownerNames();
    box.innerHTML = '<p class="muted" style="font-size:13px;margin:0 0 10px">Haz click en "Programar" para cargar la tarea en el formulario.</p>' +
      st.todos.map(function (t) { return htmlTarea(t, on); }).join('');
    ligarTareas(box);
  }

  function guardarTodo() {
    error('vtTodoErr', '');
    var body = {
      assigneeId: $('vtTodoAssignee').value, cliente: val('vtTodoCliente'), ubicacion: val('vtTodoUbicacion'),
      producto: val('vtTodoProducto'), trabajo: val('vtTodoTrabajo'), ventaConcretar: val('vtTodoVenta'),
      observaciones: val('vtTodoObs')
    };
    if (!body.assigneeId) { error('vtTodoErr', 'Selecciona un representante.'); return; }
    api('POST', '/api/todos', body).then(function (res) {
      if (!res.ok) { error('vtTodoErr', res.data.error || 'No se pudo asignar'); return; }
      ['vtTodoCliente', 'vtTodoUbicacion', 'vtTodoProducto', 'vtTodoTrabajo', 'vtTodoVenta', 'vtTodoObs'].forEach(function (id) { setVal(id, ''); });
      error('vtTodoErr', 'Tarea asignada.', true);
      cargarTodos();
    });
  }

  function programarTodo(id) {
    var t = st.todos.find(function (x) { return x.id === id; });
    if (!t) return;
    cerrarModal();
    st.vista = null;
    actualizarPermisos();
    RB.render();
    setVal('field_cliente', t.cliente || '');
    setVal('field_ubicacion', t.ubicacion || '');
    setVal('field_producto', t.producto || '');
    setVal('field_trabajo', t.trabajo || '');
    setVal('field_ventaConcretar', t.ventaConcretar || '');
    setVal('field_observaciones', t.observaciones || '');
    setVal('field_estado', 'En curso');
    if (t.assigneeId && $('vtOwner')) $('vtOwner').value = t.assigneeId;
    st.pendingTodoId = id;
    var d = $('field_dia'); if (d) d.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Tarea cargada en el formulario: elige la fecha y guarda.');
  }

  function afterSave() {
    if (!st.pendingTodoId) return;
    var id = st.pendingTodoId;
    st.pendingTodoId = null;
    api('DELETE', '/api/todos/' + id).then(function () { cargarTodos(); });
  }

  // ------------------------------------------------------------------
  // Catalogo maestro de clientes
  // ------------------------------------------------------------------
  function cargarCatalogo() {
    return api('GET', '/api/clients').then(function (res) {
      if (!res.ok) return;
      st.catalogo = { clientes: res.data.clientes || res.data.shared || [], editable: !!res.data.editable, total: res.data.total || 0 };
      st.catTrabajo = st.catalogo.clientes.slice();
      if ($('vtCatLista')) pintarCatalogo();
    });
  }

  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

  function abrirClientes() {
    var html = '<div class="grid">' +
      '<div><label>Buscar en el listado</label><input id="vtCatBuscar" placeholder="Escribe parte del nombre"></div>' +
      '<div><label>Agregar clientes (uno por l&iacute;nea)</label><textarea id="vtCatNuevos" placeholder="Ej. Agroindustrias del Sur"></textarea></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin:10px 0 6px"><span class="muted" id="vtCatCount"></span>' +
      '<button class="ghost small" id="vtCatAgregar">Agregar los escritos</button></div>' +
      '<div id="vtCatLista" class="vt-scroll"></div>' +
      '<h3 style="margin:14px 0 8px">Clientes potenciales detectados</h3><div id="vtPotenciales"></div>' +
      '<div id="vtCatErr" class="vt-err"></div>' +
      '<button id="vtCatGuardar" style="margin-top:12px">Guardar listado</button>';
    abrirModal('Listado maestro de clientes', html, function () {
      $('vtCatBuscar').addEventListener('input', pintarCatalogo);
      $('vtCatAgregar').onclick = function () {
        var nuevos = $('vtCatNuevos').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        nuevos.forEach(function (n) {
          if (!st.catTrabajo.some(function (c) { return norm(c) === norm(n); })) st.catTrabajo.push(n);
        });
        setVal('vtCatNuevos', '');
        pintarCatalogo();
      };
      $('vtCatGuardar').onclick = function () {
        error('vtCatErr', '');
        api('PUT', '/api/clients', { clientes: st.catTrabajo }).then(function (res) {
          if (!res.ok) { error('vtCatErr', res.data.error || 'No se pudo guardar'); return; }
          error('vtCatErr', 'Listado guardado correctamente.', true);
          cargarCatalogo().then(function () { RB.loadRows(); });
        });
      };
      pintarCatalogo();
      cargarCatalogo();
    });
  }

  function pintarCatalogo() {
    var box = $('vtCatLista'); if (!box) return;
    var q = norm($('vtCatBuscar') ? $('vtCatBuscar').value : '');
    var lista = st.catTrabajo.filter(function (c) { return !q || norm(c).indexOf(q) >= 0; });
    $('vtCatCount').textContent = lista.length + ' de ' + st.catTrabajo.length + ' clientes (base: ' + st.catalogo.total + ')';
    box.innerHTML = lista.length ? lista.map(function (c) {
      return '<div class="vt-cat-row"><span>' + esc(c) + '</span><button class="ghost small" data-cat="' + esc(c) + '">Quitar</button></div>';
    }).join('') : '<p class="muted">Sin coincidencias.</p>';
    box.querySelectorAll('[data-cat]').forEach(function (b) {
      b.onclick = function () {
        var k = norm(b.getAttribute('data-cat'));
        st.catTrabajo = st.catTrabajo.filter(function (c) { return norm(c) !== k; });
        pintarCatalogo();
      };
    });
    pintarPotenciales();
  }

  function pintarPotenciales() {
    var box = $('vtPotenciales'); if (!box) return;
    var on = ownerNames();
    var map = {};
    rows().forEach(function (r) {
      if (!r.clientePotencial || !r.cliente) return;
      var k = r.cliente + '\u0001' + (on[r.ownerId] || '');
      if (!map[k]) map[k] = { cliente: r.cliente, quien: on[r.ownerId] || '—', n: 0 };
      map[k].n++;
    });
    var keys = Object.keys(map);
    if (!keys.length) { box.innerHTML = '<span class="muted">Ninguno por ahora.</span>'; return; }
    box.innerHTML = keys.sort().map(function (k) {
      var x = map[k];
      return '<div class="vt-cat-row"><span>' + esc(x.cliente) + ' · ' + esc(x.quien) + (x.n > 1 ? ' · ' + x.n + ' actividades' : '') + '</span>' +
        '<button class="ghost small" data-pot="' + esc(x.cliente) + '">Agregar al listado</button></div>';
    }).join('');
    box.querySelectorAll('[data-pot]').forEach(function (b) {
      b.onclick = function () {
        var nombre = b.getAttribute('data-pot');
        var nueva = st.catalogo.clientes.slice();
        if (!nueva.some(function (c) { return norm(c) === norm(nombre); })) nueva.push(nombre);
        api('PUT', '/api/clients', { clientes: nueva }).then(function (res) {
          if (!res.ok) { error('vtCatErr', res.data.error || 'No se pudo guardar'); return; }
          cargarCatalogo().then(function () { RB.loadRows(); pintarCatalogo(); });
        });
      };
    });
  }

  // ------------------------------------------------------------------
  // Administracion de usuarios (solo admin)
  // ------------------------------------------------------------------
  function abrirUsuarios() {
    var html = '<div style="overflow-x:auto"><table class="vt-tbl" id="vtUsersTable"></table></div>' +
      '<h3 id="vtUserFormTitle" style="margin:16px 0 8px">Nuevo usuario</h3>' +
      '<div class="grid">' +
      '<div><label>Nombre</label><input id="vtUNombre"></div>' +
      '<div><label>Usuario</label><input id="vtUUsuario"></div>' +
      '<div><label>Contrase&ntilde;a <span class="muted">(vac&iacute;o = no cambiar)</span></label><input id="vtUPass" type="password"></div>' +
      '<div><label>Rol</label><select id="vtURol">' + ROLES.map(function (r) { return '<option value="' + r + '">' + ROLE_LABEL[r] + '</option>'; }).join('') + '</select></div>' +
      '<div style="grid-column:1/-1"><label>Responsables (mant&eacute;n Ctrl para varios)</label><select id="vtUSup" multiple size="4"></select></div>' +
      '</div><div id="vtUserErr" class="vt-err"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px"><button id="vtUserSave">Guardar</button>' +
      '<button class="ghost" id="vtUserCancel">Cancelar edici&oacute;n</button></div>';
    abrirModal('Vendedores y accesos', html, function () {
      $('vtUserSave').onclick = guardarUsuario;
      $('vtUserCancel').onclick = limpiarUsuario;
      pintarUsuarios();
    });
  }

  function pintarUsuarios() {
    api('GET', '/api/users').then(function (res) {
      if (!res.ok) return;
      st.usuarios = res.data.users || [];
      var t = $('vtUsersTable'); if (!t) return;
      t.innerHTML = '<tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Acciones</th></tr>';
      st.usuarios.forEach(function (u) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + esc(u.name) + (u.id === me().id ? ' (tú)' : '') + '</td>' +
          '<td>' + esc(u.username) + '</td><td>' + esc(ROLE_LABEL[u.role] || u.role) + '</td>' +
          '<td><button class="ghost small" data-edit="' + esc(u.id) + '">Editar</button> ' +
          '<button class="ghost small" data-pass="' + esc(u.id) + '">Clave</button>' +
          (u.id !== me().id ? ' <button class="ghost small" data-del="' + esc(u.id) + '">Retirar</button>' : '') + '</td>';
        t.appendChild(tr);
      });
      t.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { editarUsuario(b.getAttribute('data-edit')); }; });
      t.querySelectorAll('[data-pass]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-pass');
          var p = prompt('Nueva contraseña para este usuario:');
          if (!p) return;
          api('PUT', '/api/users/' + id, { password: p }).then(function (r) { toast(r.ok ? 'Contraseña actualizada.' : (r.data.error || 'No se pudo cambiar')); });
        };
      });
      t.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-del');
          var u = st.usuarios.find(function (x) { return x.id === id; });
          if (!confirm('Retirar a ' + (u ? u.name : id) + ' y sus actividades?')) return;
          api('DELETE', '/api/users/' + id).then(function (r) {
            if (r.ok) { pintarUsuarios(); RB.loadRows(); } else toast(r.data.error || 'No se pudo retirar');
          });
        };
      });
      llenarSupervisores();
    });
  }

  function llenarSupervisores(seleccion) {
    var sel = $('vtUSup'); if (!sel) return;
    sel.innerHTML = st.usuarios.filter(function (u) { return u.id !== st.editUserId; }).map(function (u) {
      return '<option value="' + esc(u.id) + '">' + esc(u.name) + ' (' + esc(ROLE_LABEL[u.role] || u.role) + ')</option>';
    }).join('');
    if (seleccion) Array.prototype.forEach.call(sel.options, function (o) { o.selected = seleccion.indexOf(o.value) >= 0; });
  }

  function editarUsuario(id) {
    var u = st.usuarios.find(function (x) { return x.id === id; }); if (!u) return;
    st.editUserId = id;
    $('vtUserFormTitle').textContent = 'Editar: ' + u.name;
    setVal('vtUNombre', u.name); setVal('vtUUsuario', u.username); setVal('vtUPass', '');
    setVal('vtURol', u.role);
    llenarSupervisores(u.supervisorIds || (u.supervisorId ? [u.supervisorId] : []));
    error('vtUserErr', '');
  }

  function limpiarUsuario() {
    st.editUserId = null;
    $('vtUserFormTitle').textContent = 'Nuevo usuario';
    ['vtUNombre', 'vtUUsuario', 'vtUPass'].forEach(function (id) { setVal(id, ''); });
    setVal('vtURol', 'retail');
    llenarSupervisores();
    error('vtUserErr', '');
  }

  function guardarUsuario() {
    error('vtUserErr', '');
    var sups = [];
    var sel = $('vtUSup');
    if (sel) Array.prototype.forEach.call(sel.selectedOptions, function (o) { sups.push(o.value); });
    var body = { name: val('vtUNombre'), username: val('vtUUsuario'), role: $('vtURol').value, supervisorIds: sups };
    var p = val('vtUPass');
    if (!body.name || !body.username) { error('vtUserErr', 'Nombre y usuario son obligatorios.'); return; }
    if (!st.editUserId && !p) { error('vtUserErr', 'La contraseña es obligatoria para un usuario nuevo.'); return; }
    if (p) body.password = p;
    var url = st.editUserId ? '/api/users/' + st.editUserId : '/api/users';
    api(st.editUserId ? 'PUT' : 'POST', url, body).then(function (r) {
      if (!r.ok) { error('vtUserErr', r.data.error || 'No se pudo guardar'); return; }
      error('vtUserErr', 'Usuario guardado.', true);
      limpiarUsuario();
      pintarUsuarios();
      RB.loadRows();
    });
  }

  // ------------------------------------------------------------------
  // Vista Calendario de Ventas (bajo demanda)
  // ------------------------------------------------------------------
  function renderCalendario(container) {
    var d = new Date(st.calY, st.calM, 1);
    var nombre = MESES[st.calM] + ' ' + st.calY;
    var lista = filtrar(rows());
    var porDia = {}, repsVistos = {};
    var on = ownerNames();

    lista.forEach(function (r) {
      if (!r.dia) return;
      var clave = String(r.dia).slice(0, 10);
      (porDia[clave] = porDia[clave] || []).push(r);
      repsVistos[r.ownerId] = on[r.ownerId] || r.ownerId || '—';
    });

    // Con el filtro "Todos" cada representante tiene su propio color; si hay
    // un vendedor concreto seleccionado (o el usuario solo ve lo suyo) se
    // mantiene el color por estado.
    var porVendedor = veVarios() && !st.fOwner;
    var ids = Object.keys(repsVistos).sort(function (a, b) {
      return String(repsVistos[a]).localeCompare(String(repsVistos[b]), 'es');
    });
    var colorOwner = {};
    ids.forEach(function (id, i) { colorOwner[id] = PALETTE[i % PALETTE.length]; });

    var html = '<div class="card"><div class="vt-nav">' +
      '<button class="ghost small" id="vtCalPrev">Anterior</button>' +
      '<b>' + nombre + '</b>' +
      '<button class="ghost small" id="vtCalHoy">Hoy</button>' +
      '<button class="ghost small" id="vtCalNext">Siguiente</button></div>' +
      '<div class="cal-scroll"><div class="cal-month">' +
      DIAS.map(function (x) { return '<div class="cal-mday-h">' + x + '</div>'; }).join('');

    // Domingo = 0: la primera columna es Domingo y la ultima Sabado.
    var inicio = d.getDay();
    var primero = new Date(st.calY, st.calM, 1 - inicio);
    for (var i = 0; i < 42; i++) {
      var dia = new Date(primero.getFullYear(), primero.getMonth(), primero.getDate() + i);
      var clave = iso(dia);
      var fuera = dia.getMonth() !== st.calM;
      var fin = dia.getDay() === 0 || dia.getDay() === 6;
      html += '<div class="cal-mday' + (fuera ? ' out' : '') + (fin ? ' weekend' : '') + (clave === hoy() ? ' today' : '') + '">' +
        '<div class="cal-dayhd"><span class="dnum">' + dia.getDate() + '</span>' +
        '<span class="cal-add" data-day="' + clave + '" title="Agregar un registro en este dia">+</span></div>';
      var delDia = porDia[clave] || [];
      delDia.slice(0, 8).forEach(function (r) {
        var color = porVendedor ? (colorOwner[r.ownerId] || '#64748b') : (ESTADO_COLOR[r.estado] || '#64748b');
        // "En curso" lleva siempre una marca gris claro: asi se distingue
        // tambien cuando la pastilla esta coloreada por representante.
        var marca = r.estado === 'Realizado' ? '<span class="cal-mark ok">✓</span>'
          : r.estado === 'No realizado' ? '<span class="cal-mark no">✗</span>'
          : '<span class="cal-mark pend">&#9679;</span>';
        var tip = (porVendedor ? (on[r.ownerId] || '') + ' — ' : '') + (r.cliente || '') + ' · ' + (r.estado || 'En curso');
        html += '<span class="cal-chip" data-row="' + esc(r.id) + '" title="' + esc(tip) + '" style="background:' + color + ';color:' + tinta(color) + '">' +
          marca + esc(r.cliente || r.trabajo || 'Actividad') + '</span>';
      });
      if (delDia.length > 8) html += '<span class="muted">+' + (delDia.length - 8) + ' más</span>';
      html += '</div>';
    }
    html += '</div></div><div class="cal-leyenda-reps">';
    if (porVendedor) {
      ids.forEach(function (id) {
        html += '<span><i style="background:' + colorOwner[id] + ';border:1px solid #B9C6C2"></i>' + esc(repsVistos[id]) + '</span>';
      });
      if (!ids.length) html += '<span>Sin actividades para este filtro.</span>';
    } else {
      Object.keys(ESTADO_COLOR).forEach(function (e) {
        html += '<span><i style="background:' + ESTADO_COLOR[e] + ';border:1px solid #B9C6C2"></i>' + esc(e) + '</span>';
      });
    }
    html += '</div><div class="cal-legend" style="font-size:11px">' +
      '<span><span class="cal-mark ok">✓</span> Realizado</span>' +
      '<span><span class="cal-mark no">✗</span> No realizado</span>' +
      '<span><span class="cal-mark pend">&#9679;</span> En curso (gris claro)</span></div></div>';
    container.innerHTML = html;

    $('vtCalPrev').onclick = function () { moverCal(-1); };
    $('vtCalNext').onclick = function () { moverCal(1); };
    $('vtCalHoy').onclick = function () { st.calY = new Date().getFullYear(); st.calM = new Date().getMonth(); RB.render(); };
    container.querySelectorAll('[data-row]').forEach(function (c) {
      c.onclick = function () { RB.openDetail(c.getAttribute('data-row')); };
    });
    container.querySelectorAll('[data-day]').forEach(function (a) {
      a.onclick = function () { abrirNuevoRegistro(a.getAttribute('data-day')); };
    });
  }

  function moverCal(delta) {
    var d = new Date(st.calY, st.calM + delta, 1);
    st.calY = d.getFullYear(); st.calM = d.getMonth();
    RB.render();
  }

  // ------------------------------------------------------------------
  // Ventana flotante del "+" de cada dia del calendario.
  // Usa el mismo schema y el mismo POST que el formulario principal, pero
  // con ids propios (vtN_*) para no chocar con los campos field_* de app.html.
  // ------------------------------------------------------------------
  function campoNuevo(f) {
    var id = 'vtN_' + f.name;
    // Estado y venta lograda NO se eligen al crear: viajan ocultos con su
    // valor inicial y se resuelven despues desde el detalle de la actividad.
    if (f.hiddenInForm) {
      return '<input type="hidden" id="' + id + '" value="' + esc(f.default || (f.options && f.options[0]) || '') + '">';
    }
    // "semana" es automatica y no editable para TODOS, admin incluido.
    var solo = f.autoFill ? ' readonly title="Se calcula automaticamente a partir de la fecha"' : '';
    var ctrl;
    if (f.type === 'textarea') ctrl = '<textarea id="' + id + '" rows="2"' + solo + '></textarea>';
    else if (f.type === 'select') ctrl = '<select id="' + id + '">' + (f.options || []).map(function (o) {
      return '<option value="' + esc(o) + '">' + esc(o) + '</option>';
    }).join('') + '</select>';
    else if (f.type === 'date') ctrl = '<input type="date" id="' + id + '"' + solo + '>';
    else if (f.type === 'number') ctrl = '<input type="number" step="0.01" min="0" id="' + id + '" value="' + (f.default || 0) + '">';
    else ctrl = '<input type="text" id="' + id + '"' + solo + '>';
    return '<div' + (f.type === 'textarea' ? ' style="grid-column:1/-1"' : '') + '>' +
      '<label>' + esc(f.label) + (f.required ? ' *' : '') + '</label>' + ctrl + '</div>';
  }

  function abrirNuevoRegistro(dia) {
    var schema = RB.schema();
    if (RB.module() !== 'ventas' || !schema || !schema.schema) return;
    var fields = schema.schema.fields || [];
    var u = me();
    var html = '<div class="grid">' + fields.map(function (f) { return campoNuevo(f); }).join('') + '</div>';

    if (esJefe()) {
      var candidatos = reps().slice();
      if (!candidatos.length && u) candidatos = [u];
      var opciones = (u ? '<option value="' + esc(u.id) + '">' + esc(u.name) + ' (yo)</option>' : '') +
        candidatos.filter(function (x) { return !u || x.id !== u.id; }).map(function (x) {
          return '<option value="' + esc(x.id) + '">' + esc(x.name) + ' (' + esc(ROLE_LABEL[x.role] || x.role) + ')</option>';
        }).join('');
      html += '<div style="margin-top:10px"><label>Representante</label><select id="vtNuevoOwner">' + opciones + '</select></div>';
    }
    html += '<div id="vtNuevoErr" class="vt-err"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button id="vtNuevoGuardar" style="flex:1">Guardar registro</button>' +
      '<button class="ghost" id="vtNuevoCancelar">Cancelar</button></div>';

    abrirModal('Nuevo registro · ' + dia, html, function () {
      fields.forEach(function (f) {
        if (f.default !== undefined && f.type === 'select') setVal('vtN_' + f.name, f.default);
        if (f.type === 'number') setVal('vtN_' + f.name, f.default || 0);
      });
      setVal('vtN_dia', dia);
      setVal('vtN_estado', 'En curso');
      setVal('vtN_ventaLograda', 'Pendiente');
      ligarSemana('vtN_dia', 'vtN_semana');
      if (window.RainbowClientes && $('vtN_cliente')) RainbowClientes.adjuntar($('vtN_cliente'));
      $('vtNuevoCancelar').onclick = cerrarModal;
      $('vtNuevoGuardar').onclick = function () { guardarNuevoRegistro(dia); };
      if ($('vtN_cliente')) $('vtN_cliente').focus();
    });
  }

  function guardarNuevoRegistro(dia) {
    var schema = RB.schema();
    var fields = (schema && schema.schema && schema.schema.fields) || [];
    var values = {}, faltan = [];
    fields.forEach(function (f) {
      var el = $('vtN_' + f.name);
      if (!el) return;
      var v = el.value == null ? '' : String(el.value).trim();
      values[f.name] = (f.type === 'number') ? (Number(v) || 0) : v;
      if (f.required && !v) faltan.push(f.label);
    });
    if (faltan.length) { error('vtNuevoErr', 'Completa los campos: ' + faltan.join(', ')); return; }
    // Valores de control, nunca editables por el usuario al crear.
    values.estado = 'En curso';
    values.ventaLograda = 'Pendiente';
    values.semana = etiquetaSemana(values.dia || '');
    var sel = $('vtNuevoOwner');
    values.ownerId = (sel && sel.value) ? sel.value : me().id;
    error('vtNuevoErr', 'Guardando...', true);
    api('POST', '/api/modules/ventas/rows', values).then(function (res) {
      if (!res.ok) { error('vtNuevoErr', (res.data && res.data.error) || 'No se pudo guardar'); return; }
      // Si el "+" era de un dia del mes vecino, el calendario salta a ese mes
      // para que el registro recien creado quede a la vista.
      var p = String(dia).split('-');
      st.calY = Number(p[0]); st.calM = Number(p[1]) - 1;
      cerrarModal();
      RB.loadRows();
      var row = res.data && res.data.row;
      if (row && row.clientePotencial) {
        toast('Cliente nuevo guardado como potencial: ' + values.cliente + '. Tu supervisor puede agregarlo al listado.');
      } else {
        toast('Registro guardado correctamente.');
      }
    });
  }

  // ------------------------------------------------------------------
  // Vista Resumen + exportacion Excel de 3 hojas
  // ------------------------------------------------------------------
  function renderResumen(container) {
    var lista = filtrar(rows());
    if (!lista.length) { container.innerHTML = '<div class="card center muted">Sin actividades para resumir.</div>'; return; }
    var on = ownerNames();
    var semanas = {}, porCliente = {}, porVendedor = {}, tP = 0, tR = 0;
    lista.forEach(function (r) {
      var p = Number(r.ventaConcretar) || 0, x = Number(r.ventaRealizada) || 0;
      tP += p; tR += x;
      var s = r.semana || '—', c = r.cliente || '—', v = on[r.ownerId] || '—';
      semanas[s] = semanas[s] || { p: 0, r: 0, n: 0 };
      semanas[s].p += p; semanas[s].r += x; semanas[s].n++;
      porCliente[c] = porCliente[c] || { p: 0, r: 0, n: 0 };
      porCliente[c].p += p; porCliente[c].r += x; porCliente[c].n++;
      porVendedor[v] = porVendedor[v] || { p: 0, r: 0, n: 0 };
      porVendedor[v].p += p; porVendedor[v].r += x; porVendedor[v].n++;
    });
    var filas = function (obj, titulo) {
      return '<tr><th>' + titulo + '</th><th class="r">Activ.</th><th class="r">Planificado</th><th class="r">Realizado</th><th class="r">%</th></tr>' +
        Object.keys(obj).sort().map(function (k) {
          var g = obj[k];
          return '<tr><td>' + esc(k) + '</td><td class="r">' + g.n + '</td><td class="r">' + money(g.p) + '</td><td class="r">' + money(g.r) + '</td><td class="r">' + pct(g.r, g.p) + '</td></tr>';
        }).join('') +
        '<tr class="vt-total"><td>Total</td><td class="r">' + lista.length + '</td><td class="r">' + money(tP) + '</td><td class="r">' + money(tR) + '</td><td class="r">' + pct(tR, tP) + '</td></tr>';
    };
    container.innerHTML = '<div class="card">' +
      '<div class="vt-nav"><h2 style="margin:0">Resumen de Ventas</h2><button class="ghost small" id="vtResExport">Exportar a Excel</button></div>' +
      '<h3 style="margin:14px 0 6px">Por semana</h3><div style="overflow-x:auto"><table class="vt-tbl">' + filas(semanas, 'Semana') + '</table></div>' +
      '<h3 style="margin:14px 0 6px">Por cliente</h3><div style="overflow-x:auto"><table class="vt-tbl">' + filas(porCliente, 'Cliente') + '</table></div>' +
      '<h3 style="margin:14px 0 6px">Por vendedor</h3><div style="overflow-x:auto"><table class="vt-tbl">' + filas(porVendedor, 'Vendedor') + '</table></div>' +
      '</div>';
    $('vtResExport').onclick = function () { exportarResumen(lista, on); };
  }

  function exportarResumen(lista, on) {
    if (typeof RainbowXLSX === 'undefined') { toast('No se pudo cargar el generador de Excel.'); return; }
    var varios = veVarios();
    var nombre = function (r) { return on[r.ownerId] || '—'; };
    var tP = 0, tR = 0;
    var det = lista.slice().sort(function (a, b) { return String(a.dia || '').localeCompare(String(b.dia || '')); }).map(function (r) {
      var p = Number(r.ventaConcretar) || 0, x = Number(r.ventaRealizada) || 0;
      tP += p; tR += x;
      return (varios ? [nombre(r)] : []).concat([r.cliente || '—', r.dia || '', r.semana || '', r.ubicacion || '', r.producto || '', r.trabajo || '', r.estado || '', p, x, frac(x, p), r.resultado || '', r.observaciones || '']);
    });
    var base = [{ label: 'Cliente', width: 34, type: 'text' }, { label: 'Fecha', width: 14, type: 'date' },
      { label: 'Semana', width: 20, type: 'text' }, { label: 'Ubicación', width: 22, type: 'text' },
      { label: 'Producto', width: 28, type: 'text' }, { label: 'Trabajo', width: 40, type: 'text' },
      { label: 'Estado', width: 16, type: 'text' }, { label: 'Monto programado (US$)', width: 24, type: 'money' },
      { label: 'Monto ejecutado (US$)', width: 24, type: 'money' }, { label: '% Cumplimiento', width: 18, type: 'pct' },
      { label: 'Resultado / Motivo', width: 40, type: 'text' }, { label: 'Observaciones', width: 36, type: 'text' }];
    var colsDet = (varios ? [{ label: 'Vendedor', width: 24, type: 'text' }] : []).concat(base);
    var totalDet = (varios ? [''] : []).concat(['TOTAL', '', '', '', '', '', '', tP, tR, frac(tR, tP), '', '']);

    var grupos = {};
    lista.forEach(function (r) {
      var key = (varios ? nombre(r) + '\u0001' : '') + (r.cliente || '—');
      if (!grupos[key]) grupos[key] = { v: varios ? nombre(r) : '', c: r.cliente || '—', n: 0, p: 0, x: 0 };
      var g = grupos[key];
      g.n++; g.p += Number(r.ventaConcretar) || 0; g.x += Number(r.ventaRealizada) || 0;
    });
    var cliRows = Object.keys(grupos).sort().map(function (k) {
      var g = grupos[k];
      return (varios ? [g.v] : []).concat([g.c, g.n, g.p, g.x, frac(g.x, g.p)]);
    });
    var colsCli = (varios ? [{ label: 'Vendedor', width: 24, type: 'text' }] : []).concat([
      { label: 'Cliente', width: 36, type: 'text' }, { label: 'Actividades', width: 14, type: 'number' },
      { label: 'Monto programado (US$)', width: 24, type: 'money' }, { label: 'Monto ejecutado (US$)', width: 24, type: 'money' },
      { label: '% Cumplimiento', width: 18, type: 'pct' }]);
    var cliTotal = (varios ? [''] : []).concat(['TOTAL', lista.length, tP, tR, frac(tR, tP)]);

    var sheets = [
      { name: 'Detalle', cols: colsDet, rows: det, total: totalDet },
      { name: 'Por cliente', cols: colsCli, rows: cliRows, total: cliTotal }
    ];
    if (varios) {
      var pv = {};
      lista.forEach(function (r) {
        var v = nombre(r); if (!pv[v]) pv[v] = { p: 0, x: 0 };
        pv[v].p += Number(r.ventaConcretar) || 0; pv[v].x += Number(r.ventaRealizada) || 0;
      });
      sheets.push({
        name: 'Por vendedor',
        cols: [{ label: 'Vendedor', width: 26, type: 'text' }, { label: 'Monto programado (US$)', width: 24, type: 'money' },
          { label: 'Monto ejecutado (US$)', width: 24, type: 'money' }, { label: '% Cumplimiento', width: 18, type: 'pct' }],
        rows: Object.keys(pv).sort().map(function (v) { return [v, pv[v].p, pv[v].x, frac(pv[v].x, pv[v].p)]; }),
        total: ['TOTAL', tP, tR, frac(tR, tP)]
      });
    }
    RainbowXLSX.descargar('resumen_ventas_' + hoy() + '.xlsx', sheets);
  }

  // ------------------------------------------------------------------
  // Cambio de modulo y edicion de registros
  // ------------------------------------------------------------------
  // Las herramientas de Ventas solo deben verse cuando el modulo activo es
  // "ventas". Al entrar (o volver) se abre siempre el Calendario, que es la
  // vista marcada por defecto; al salir se limpia la vista alternativa.
  function onModuleChange(id) {
    var host = $('vtToolbar');
    if (host) host.classList.toggle('hide', id !== 'ventas');
    var top = $('vtMetaTop');
    if (top) top.classList.toggle('hide', id !== 'ventas');
    var todo = $('vtTodoTop');
    if (todo) todo.classList.toggle('hide', id !== 'ventas');
    st.vista = (id === 'ventas') ? (st.vista || 'calendario') : null;
    actualizarPermisos();
    if (id === 'ventas') refrescarPanel();
  }

  // El boton "Editar" del modal de detalle re-renderiza el formulario por su
  // cuenta; hay que volver a insertar el selector de representante y dejarlo
  // en el dueno real del registro (el PUT conserva ese owner en el servidor).
  function alEditar(row) {
    if (!row || RB.module() !== 'ventas') return;
    decorarFormulario();
    var sel = $('vtOwner');
    if (sel && row.ownerId && Array.prototype.some.call(sel.options, function (o) { return o.value === row.ownerId; })) {
      sel.value = row.ownerId;
    }
  }

  // ------------------------------------------------------------------
  // API publica
  // ------------------------------------------------------------------
  window.VentasTools = {
    init: function (bridge) {
      RB = bridge;
      st.calY = new Date().getFullYear(); st.calM = new Date().getMonth();
      st.metaMonth = st.calM + 1; st.metaYear = st.calY;
      st.pAnio = st.calY; st.pMes = st.calM + 1;
      try { st.pAbierto = localStorage.getItem('rb.metas.abierto') !== '0'; } catch (e) { st.pAbierto = true; }
      construirDOM();
      api('GET', '/api/me').then(function (res) {
        if (res.ok) {
          st.canManageTeam = !!res.data.canManageTeam;
          st.myGoal = res.data.currentGoal || null;
          st.teamGoals = res.data.teamGoals || [];
        }
        return api('GET', '/api/users');
      }).then(function (res) {
        if (res && res.ok) {
          st.usuarios = res.data.users || [];
          st.tieneEquipo = st.usuarios.filter(function (u) { return u.id !== me().id; }).length > 0;
        }
        actualizarPermisos();
        decorarFormulario();
        refrescarPanel();
        RB.render();
      });
      cargarTodos();
      cargarCatalogo();
      VentasTools.onModuleChange(RB.module());
    },
    onModuleChange: onModuleChange,
    // loadRows() ya vuelve a pintar la vista; aqui solo se recalcula el panel
    // de metas con las ventas recien llegadas.
    onRowsLoaded: function () { if (RB && RB.module() === 'ventas') pintarPanelMetas(); },
    decorarFormulario: decorarFormulario,
    alEditar: alEditar,
    filtrar: filtrar,
    afterSave: afterSave,
    vistaActual: function () { return st.vista; },
    renderVista: function (container) {
      if (st.vista === 'calendario') renderCalendario(container);
      else if (st.vista === 'resumen') renderResumen(container);
    }
  };
})();
