/**
 * Rainbow Platform - Dynamic Module Renderer
 * Renderiza formularios, listas y vistas basado en el schema del modulo
 * Soporta tipos especiales: userselect (dropdown de usuarios), evaluations (lista estructurada)
 */

(function() {
  'use strict';
  
  window.ModuleRenderer = {
    // Lista de usuarios para campos userselect (se carga al abrir el modulo)
    users: [],
    
    // Renderizar formulario dinamico
    renderForm(containerId, schema, values, isAdmin) {
      const container = document.getElementById(containerId);
      if (!container || !schema || !schema.schema || !schema.schema.fields) return;
      
      container.innerHTML = '';
      const fields = schema.schema.fields;
      const grid = document.createElement('div');
      grid.className = 'grid';
      
      fields.forEach(field => {
        const wrapper = document.createElement('div');
        if (field.type === 'textarea' || field.type === 'evaluations') wrapper.style.gridColumn = '1/-1';
        
        const label = document.createElement('label');
        label.textContent = field.label + (field.required ? ' *' : '');
        wrapper.appendChild(label);
        
        let input;
        switch (field.type) {
          case 'textarea':
            input = document.createElement('textarea');
            input.rows = 3;
            break;
          case 'select':
            input = document.createElement('select');
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '— Seleccionar —';
            input.appendChild(emptyOpt);
            field.options.forEach(opt => {
              const option = document.createElement('option');
              option.value = opt;
              option.textContent = opt;
              input.appendChild(option);
            });
            break;
          case 'userselect':
            input = document.createElement('select');
            const emptyUserOpt = document.createElement('option');
            emptyUserOpt.value = '';
            emptyUserOpt.textContent = '— Sin asignar —';
            input.appendChild(emptyUserOpt);
            (this.users || []).forEach(u => {
              const option = document.createElement('option');
              option.value = u.id;
              option.textContent = u.name + ' (' + (u.role === 'kam' ? 'KAM' : 'RTC') + ')';
              input.appendChild(option);
            });
            break;
          case 'date':
            input = document.createElement('input');
            input.type = 'date';
            break;
          case 'number':
            input = document.createElement('input');
            input.type = 'number';
            input.step = '0.01';
            input.min = '0';
            break;
          case 'evaluations':
            input = this.renderEvaluationsEditor(field, values);
            wrapper.appendChild(input);
            grid.appendChild(wrapper);
            return; // ya se agrego el wrapper
          default:
            input = document.createElement('input');
            input.type = 'text';
        }
        
        input.id = 'field_' + field.name;
        input.name = field.name;
        if (field.required) input.required = true;
        if (values && values[field.name] !== undefined) input.value = values[field.name];
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.autoFill && !isAdmin) {
          input.readOnly = true;
          input.title = 'Se calcula automaticamente';
        }
        
        wrapper.appendChild(input);
        // El campo "cliente" usa el listado maestro con filtrado por palabras.
        if (field.name === 'cliente' && window.RainbowClientes) {
          window.RainbowClientes.adjuntar(input);
        }
        grid.appendChild(wrapper);
      });
      
      container.appendChild(grid);
    },

    // Editor de evaluaciones: lista de {tipo, fechaPlanificada, fechaReal, estado, observaciones}
    renderEvaluationsEditor(field, values) {
      const container = document.createElement('div');
      container.className = 'eval-editor';
      container.id = 'field_' + field.name;
      
      const evals = (values && Array.isArray(values[field.name])) ? values[field.name] : [];
      
      const list = document.createElement('div');
      list.className = 'eval-list';
      list.id = 'eval_list';
      
      const renderRow = (ev, index) => {
        const row = document.createElement('div');
        row.className = 'eval-row';
        row.style.cssText = 'display:grid;grid-template-columns:1fr 130px 130px 130px 30px;gap:6px;align-items:end;margin-bottom:6px';
        
        // Tipo
        const tipoWrap = document.createElement('div');
        const tipoLabel = document.createElement('label');
        tipoLabel.textContent = 'Tipo';
        tipoLabel.style.fontSize = '11px';
        const tipoInput = document.createElement('input');
        tipoInput.type = 'text';
        tipoInput.placeholder = 'Instalacion, 1ra, 2da...';
        tipoInput.value = ev.tipo || '';
        tipoInput.dataset.evalField = 'tipo';
        tipoInput.dataset.evalIndex = index;
        tipoWrap.appendChild(tipoLabel);
        tipoWrap.appendChild(tipoInput);
        row.appendChild(tipoWrap);
        
        // Fecha planificada
        const fpWrap = document.createElement('div');
        const fpLabel = document.createElement('label');
        fpLabel.textContent = 'Fecha planif.';
        fpLabel.style.fontSize = '11px';
        const fpInput = document.createElement('input');
        fpInput.type = 'date';
        fpInput.value = ev.fechaPlanificada || '';
        fpInput.dataset.evalField = 'fechaPlanificada';
        fpInput.dataset.evalIndex = index;
        fpWrap.appendChild(fpLabel);
        fpWrap.appendChild(fpInput);
        row.appendChild(fpWrap);
        
        // Fecha real
        const frWrap = document.createElement('div');
        const frLabel = document.createElement('label');
        frLabel.textContent = 'Fecha real';
        frLabel.style.fontSize = '11px';
        const frInput = document.createElement('input');
        frInput.type = 'date';
        frInput.value = ev.fechaReal || '';
        frInput.dataset.evalField = 'fechaReal';
        frInput.dataset.evalIndex = index;
        frWrap.appendChild(frLabel);
        frWrap.appendChild(frInput);
        row.appendChild(frWrap);
        
        // Estado
        const esWrap = document.createElement('div');
        const esLabel = document.createElement('label');
        esLabel.textContent = 'Estado';
        esLabel.style.fontSize = '11px';
        const esInput = document.createElement('select');
        ['Pendiente', 'Realizada', 'No realizada', 'Pospuesta'].forEach(s => {
          const o = document.createElement('option');
          o.value = s; o.textContent = s;
          esInput.appendChild(o);
        });
        esInput.value = ev.estado || 'Pendiente';
        esInput.dataset.evalField = 'estado';
        esInput.dataset.evalIndex = index;
        esWrap.appendChild(esLabel);
        esWrap.appendChild(esInput);
        row.appendChild(esWrap);
        
        // Boton eliminar
        const delBtn = document.createElement('button');
        delBtn.className = 'small';
        delBtn.style.cssText = 'background:var(--bad);color:#fff;padding:6px;border-radius:8px;font-size:12px';
        delBtn.textContent = 'X';
        delBtn.title = 'Eliminar evaluacion';
        delBtn.onclick = function() { row.remove(); };
        row.appendChild(delBtn);
        
        // Observaciones (fila completa abajo)
        const obsWrap = document.createElement('div');
        obsWrap.style.cssText = 'grid-column:1/-1;margin-bottom:8px';
        const obsInput = document.createElement('textarea');
        obsInput.rows = 1;
        obsInput.placeholder = 'Observaciones de la evaluacion';
        obsInput.value = ev.observaciones || '';
        obsInput.dataset.evalField = 'observaciones';
        obsInput.dataset.evalIndex = index;
        obsInput.style.fontSize = '12px';
        obsWrap.appendChild(obsInput);
        row.appendChild(obsWrap);
        
        return row;
      };
      
      evals.forEach(ev => list.appendChild(renderRow(ev, list.children.length)));
      
      container.appendChild(list);
      
      // Boton agregar evaluacion
      const addBtn = document.createElement('button');
      addBtn.className = 'small';
      addBtn.style.cssText = 'background:var(--brand);color:#fff;margin-top:6px;font-size:12px';
      addBtn.textContent = '+ Agregar evaluacion';
      addBtn.onclick = function() {
        const newIndex = list.children.length;
        list.appendChild(renderRow({}, newIndex));
      };
      container.appendChild(addBtn);
      
      return container;
    },
    
    // Extraer valores del formulario
    getFormValues(schema) {
      if (!schema || !schema.schema || !schema.schema.fields) return {};
      const values = {};
      schema.schema.fields.forEach(field => {
        if (field.type === 'evaluations') {
          // Recolectar evaluaciones desde el editor
          const evals = [];
          const list = document.getElementById('eval_list');
          if (list) {
            // Cada .eval-row tiene inputs con data-eval-field y data-evalIndex
            const rows = list.querySelectorAll('.eval-row');
            rows.forEach((row, idx) => {
              const ev = { tipo: '', fechaPlanificada: '', fechaReal: '', estado: 'Pendiente', observaciones: '' };
              row.querySelectorAll('[data-eval-field]').forEach(inp => {
                ev[inp.dataset.evalField] = inp.value;
              });
              evals.push(ev);
            });
          }
          values[field.name] = evals;
        } else {
          const input = document.getElementById('field_' + field.name);
          if (input) {
            if (field.type === 'number') {
              values[field.name] = Number(input.value) || 0;
            } else {
              values[field.name] = input.value;
            }
          }
        }
      });
      return values;
    },
    
    // Renderizar tarjeta de actividad/fila
    renderCard(row, schema, ownerNames, currentUser) {
      if (!schema || !schema.schema) return document.createElement('div');
      
      const card = document.createElement('div');
      card.className = 'act';
      card.style.cursor = 'pointer';
      
      const header = document.createElement('div');
      header.className = 'hd';
      
      // Titulo principal (primer campo de texto)
      const titleField = schema.schema.fields.find(f => f.type === 'text');
      const title = document.createElement('div');
      title.innerHTML = '<b>' + this.esc(row[titleField ? titleField.name : 'producto']) + '</b>';
      header.appendChild(title);
      
      // Estado badge
      const states = schema.schema.states || {};
      const estadoFieldName = states.field || 'estado';
      const estadoField = schema.schema.fields.find(f => f.name === estadoFieldName);
      if (estadoField && row[estadoFieldName]) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = row[estadoFieldName];
        const color = states.colors ? states.colors[row[estadoFieldName]] : null;
        if (color) badge.style.background = color;
        badge.style.color = '#fff';
        header.appendChild(badge);
      }
      
      card.appendChild(header);
      
      // Metadatos
      const meta = document.createElement('div');
      meta.className = 'meta';
      
      schema.schema.fields.forEach(field => {
        if (field.name === estadoFieldName) return; // Ya mostrado
        if (field.type === 'evaluations') return; // Se muestra en detalle
        if (!row[field.name]) return; // Vacio
        
        const item = document.createElement('div');
        const key = document.createElement('div');
        key.className = 'k';
        key.textContent = field.label;
        
        const value = document.createElement('div');
        value.className = 'v';
        if (field.type === 'number') {
          value.innerHTML = '<span class="money">US$ ' + Number(row[field.name]).toLocaleString('en-US', {minimumFractionDigits: 2}) + '</span>';
        } else if (field.type === 'userselect') {
          // Resolver el nombre del usuario
          const u = (this.users || []).find(x => x.id === row[field.name]);
          value.textContent = u ? u.name : '—';
        } else {
          value.textContent = row[field.name];
        }
        
        item.appendChild(key);
        item.appendChild(value);
        meta.appendChild(item);
      });
      
      card.appendChild(meta);
      
      // Owner info
      if (ownerNames && row.ownerId && ownerNames[row.ownerId]) {
        const who = document.createElement('div');
        who.className = 'who';
        who.textContent = ownerNames[row.ownerId];
        card.appendChild(who);
      }
      
      return card;
    },

    // Renderizar vista Cronograma (Gantt simple)
    renderCronograma(rows, schema, ownerNames) {
      const container = document.createElement('div');
      container.className = 'cronograma';
      
      if (!rows.length) {
        container.innerHTML = '<p class="muted" style="text-align:center;padding:20px">Sin ensayos para mostrar.</p>';
        return container;
      }
      
      // Encontrar rango de fechas
      const allDates = [];
      rows.forEach(r => {
        if (r.fechaMuestras) allDates.push(r.fechaMuestras);
        if (r.fechaInstalacion) allDates.push(r.fechaInstalacion);
        if (r.fechaInformePlanificada) allDates.push(r.fechaInformePlanificada);
        if (Array.isArray(r.evaluaciones)) {
          r.evaluaciones.forEach(ev => {
            if (ev.fechaPlanificada) allDates.push(ev.fechaPlanificada);
            if (ev.fechaReal) allDates.push(ev.fechaReal);
          });
        }
      });
      
      if (!allDates.length) {
        container.innerHTML = '<p class="muted" style="text-align:center;padding:20px">Sin fechas definidas. Agrega fechas a los ensayos para ver el cronograma.</p>';
        return container;
      }
      
      allDates.sort();
      const minDate = new Date(allDates[0]);
      const maxDate = new Date(allDates[allDates.length - 1]);
      // Padding de 7 dias a cada lado
      minDate.setDate(minDate.getDate() - 7);
      maxDate.setDate(maxDate.getDate() + 7);
      const totalDays = Math.max(1, Math.round((maxDate - minDate) / 86400000));
      
      // Cabecera con meses
      const headerDiv = document.createElement('div');
      headerDiv.style.cssText = 'display:grid;grid-template-columns:180px 1fr;gap:8px;margin-bottom:8px;font-size:11px;color:var(--muted);font-weight:600';
      headerDiv.innerHTML = '<div>Ensayo</div><div style="position:relative;height:18px"></div>';
      container.appendChild(headerDiv);
      
      // Linea de tiempo con marcas de mes
      const timelineWrap = headerDiv.children[1];
      const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      let curMonth = -1;
      for (let d = 0; d <= totalDays; d++) {
        const date = new Date(minDate.getTime() + d * 86400000);
        if (date.getMonth() !== curMonth) {
          curMonth = date.getMonth();
          const mark = document.createElement('div');
          const pct = (d / totalDays) * 100;
          mark.style.cssText = 'position:absolute;left:' + pct + '%;top:0;font-size:10px;color:var(--muted);white-space:nowrap';
          mark.textContent = monthNames[curMonth] + ' ' + date.getFullYear();
          timelineWrap.appendChild(mark);
        }
      }
      
      // Filas del cronograma
      const states = schema.schema.states || {};
      const stateColors = states.colors || {};
      
      rows.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.style.cssText = 'display:grid;grid-template-columns:180px 1fr;gap:8px;margin-bottom:4px;align-items:center';
        
        const labelDiv = document.createElement('div');
        labelDiv.style.cssText = 'font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        labelDiv.textContent = row.producto || '—';
        labelDiv.title = row.producto || '';
        rowDiv.appendChild(labelDiv);
        
        const barArea = document.createElement('div');
        barArea.style.cssText = 'position:relative;height:24px;background:#f0f0f0;border-radius:6px;overflow:hidden';
        
        // Barra principal: desde fechaInstalacion hasta fechaInformePlanificada (o fecha actual)
        if (row.fechaInstalacion) {
          const start = new Date(row.fechaInstalacion);
          const end = row.fechaInformePlanificada ? new Date(row.fechaInformePlanificada) : maxDate;
          if (start >= minDate && end <= maxDate && end >= start) {
            const startPct = ((start - minDate) / (totalDays * 86400000)) * 100;
            const widthPct = Math.max(2, ((end - start) / (totalDays * 86400000)) * 100);
            const bar = document.createElement('div');
            const color = stateColors[row.estadoGeneral] || '#1976d2';
            bar.style.cssText = 'position:absolute;left:' + startPct + '%;width:' + widthPct + '%;top:2px;bottom:2px;background:' + color + ';border-radius:4px;opacity:0.6';
            barArea.appendChild(bar);
          }
        }
        
        // Marcadores de hitos
        const milestones = [
          { date: row.fechaMuestras, label: 'M', color: '#fbc02d' },
          { date: row.fechaInstalacion, label: 'I', color: '#1976d2' },
          { date: row.fechaInformePlanificada, label: 'Inf', color: '#7b1fa2' }
        ];
        milestones.forEach(ms => {
          if (!ms.date) return;
          const d = new Date(ms.date);
          if (d < minDate || d > maxDate) return;
          const pct = ((d - minDate) / (totalDays * 86400000)) * 100;
          const dot = document.createElement('div');
          dot.style.cssText = 'position:absolute;left:' + pct + '%;top:0;bottom:0;width:3px;background:' + ms.color + ';z-index:2';
          dot.title = ms.label + ': ' + ms.date;
          barArea.appendChild(dot);
        });
        
        // Evaluaciones como puntos
        if (Array.isArray(row.evaluaciones)) {
          row.evaluaciones.forEach(ev => {
            const evDate = ev.fechaReal || ev.fechaPlanificada;
            if (!evDate) return;
            const d = new Date(evDate);
            if (d < minDate || d > maxDate) return;
            const pct = ((d - minDate) / (totalDays * 86400000)) * 100;
            const dot = document.createElement('div');
            const evColor = ev.estado === 'Realizada' ? '#2e7d32' : (ev.estado === 'No realizada' ? '#c62828' : '#666');
            dot.style.cssText = 'position:absolute;left:' + pct + '%;top:6px;width:12px;height:12px;border-radius:50%;background:' + evColor + ';border:2px solid #fff;z-index:3;transform:translateX(-50%)';
            dot.title = (ev.tipo || 'Eval') + ' ' + evDate + ' (' + ev.estado + ')';
            barArea.appendChild(dot);
          });
        }
        
        rowDiv.appendChild(barArea);
        container.appendChild(rowDiv);
      });
      
      // Leyenda
      const legend = document.createElement('div');
      legend.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;font-size:11px;color:var(--muted)';
      legend.innerHTML = '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#2e7d32;margin-right:3px"></span> Realizada</span>'
        + '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#c62828;margin-right:3px"></span> No realizada</span>'
        + '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#666;margin-right:3px"></span> Pendiente</span>'
        + '<span><span style="display:inline-block;width:3px;height:12px;background:#fbc02d;margin-right:3px"></span> Muestras</span>'
        + '<span><span style="display:inline-block;width:3px;height:12px;background:#1976d2;margin-right:3px"></span> Instalacion</span>'
        + '<span><span style="display:inline-block;width:3px;height:12px;background:#7b1fa2;margin-right:3px"></span> Informe</span>';
      container.appendChild(legend);
      
      return container;
    },

    // Renderizar vista Dashboard / Resumen
    renderDashboard(rows, schema, ownerNames) {
      const container = document.createElement('div');
      container.className = 'dashboard';
      
      if (!rows.length) {
        container.innerHTML = '<p class="muted" style="text-align:center;padding:20px">Sin datos para mostrar.</p>';
        return container;
      }
      
      const states = schema.schema.states || {};
      const stateColors = states.colors || {};
      const stateValues = states.values || [];
      const stateField = states.field || 'estadoGeneral';
      
      // Contar por estado
      const porEstado = {};
      stateValues.forEach(s => porEstado[s] = 0);
      rows.forEach(r => { if (porEstado[r[stateField]] !== undefined) porEstado[r[stateField]]++; });
      
      // Tarjetas de metricas
      const metricsGrid = document.createElement('div');
      metricsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px';
      
      const totalActivos = rows.filter(r => r[stateField] !== 'Completado' && r[stateField] !== 'Suspendido').length;
      const totalCompletados = rows.filter(r => r[stateField] === 'Completado').length;
      const totalSuspendidos = rows.filter(r => r[stateField] === 'Suspendido').length;
      
      // Evaluaciones
      let evalPlanificadas = 0, evalRealizadas = 0, evalPendientes = 0, evalRetrasadas = 0;
      const hoy = new Date().toISOString().slice(0, 10);
      const proximas = [];
      
      rows.forEach(r => {
        if (Array.isArray(r.evaluaciones)) {
          r.evaluaciones.forEach(ev => {
            if (ev.fechaPlanificada || ev.fechaReal) evalPlanificadas++;
            if (ev.estado === 'Realizada') evalRealizadas++;
            if (ev.estado === 'Pendiente') {
              evalPendientes++;
              if (ev.fechaPlanificada && ev.fechaPlanificada < hoy) evalRetrasadas++;
              if (ev.fechaPlanificada) {
                const dias = Math.ceil((new Date(ev.fechaPlanificada) - new Date(hoy)) / 86400000);
                if (dias >= 0 && dias <= 14) proximas.push({ producto: r.producto, tipo: ev.tipo, fecha: ev.fechaPlanificada, dias: dias });
              }
            }
          });
        }
      });
      
      const pctCumpl = evalPlanificadas > 0 ? Math.round((evalRealizadas / evalPlanificadas) * 100) : 0;
      
      const makeCard = (label, value, color) => {
        const card = document.createElement('div');
        card.style.cssText = 'background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center';
        const valDiv = document.createElement('div');
        valDiv.style.cssText = 'font-size:28px;font-weight:800;color:' + (color || 'var(--ink)');
        valDiv.textContent = value;
        const lblDiv = document.createElement('div');
        lblDiv.style.cssText = 'font-size:12px;color:var(--muted);margin-top:4px';
        lblDiv.textContent = label;
        card.appendChild(valDiv);
        card.appendChild(lblDiv);
        return card;
      };
      
      metricsGrid.appendChild(makeCard('Ensayos activos', totalActivos, '#1976d2'));
      metricsGrid.appendChild(makeCard('Completados', totalCompletados, '#2e7d32'));
      metricsGrid.appendChild(makeCard('Suspendidos', totalSuspendidos, '#c62828'));
      metricsGrid.appendChild(makeCard('Evals. realizadas', evalRealizadas, '#2e7d32'));
      metricsGrid.appendChild(makeCard('Evals. pendientes', evalPendientes, '#fbc02d'));
      metricsGrid.appendChild(makeCard('Evals. retrasadas', evalRetrasadas, '#c62828'));
      metricsGrid.appendChild(makeCard('% Cumplimiento', pctCumpl + '%', pctCumpl >= 70 ? '#2e7d32' : (pctCumpl >= 40 ? '#fbc02d' : '#c62828')));
      
      container.appendChild(metricsGrid);
      
      // Distribucion por estado
      const stateSection = document.createElement('div');
      stateSection.className = 'card';
      stateSection.style.marginBottom = '12px';
      const stateTitle = document.createElement('h2');
      stateTitle.style.cssText = 'font-size:15px;margin:0 0 10px';
      stateTitle.textContent = 'Distribucion por estado';
      stateSection.appendChild(stateTitle);
      
      stateValues.forEach(s => {
        if (porEstado[s] === 0) return;
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
        const lbl = document.createElement('div');
        lbl.style.cssText = 'width:170px;font-size:12px;font-weight:600';
        lbl.textContent = s;
        const track = document.createElement('div');
        track.style.cssText = 'flex:1;height:20px;background:#f0f0f0;border-radius:6px;overflow:hidden';
        const fill = document.createElement('div');
        const pct = rows.length > 0 ? Math.round((porEstado[s] / rows.length) * 100) : 0;
        fill.style.cssText = 'height:100%;width:' + pct + '%;background:' + (stateColors[s] || '#999') + ';border-radius:6px';
        track.appendChild(fill);
        const num = document.createElement('div');
        num.style.cssText = 'width:40px;font-size:12px;font-weight:700;text-align:right';
        num.textContent = porEstado[s];
        bar.appendChild(lbl);
        bar.appendChild(track);
        bar.appendChild(num);
        stateSection.appendChild(bar);
      });
      container.appendChild(stateSection);
      
      // Proximas evaluaciones (7-14 dias)
      if (proximas.length) {
        proximas.sort((a, b) => a.fecha.localeCompare(b.fecha));
        const proxSection = document.createElement('div');
        proxSection.className = 'card';
        proxSection.style.marginBottom = '12px';
        const proxTitle = document.createElement('h2');
        proxTitle.style.cssText = 'font-size:15px;margin:0 0 10px';
        proxTitle.textContent = 'Proximas evaluaciones (14 dias)';
        proxSection.appendChild(proxTitle);
        
        proximas.forEach(p => {
          const item = document.createElement('div');
          item.style.cssText = 'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:13px';
          const left = document.createElement('div');
          left.innerHTML = '<b>' + this.esc(p.producto) + '</b> — ' + this.esc(p.tipo || 'Evaluacion');
          const right = document.createElement('div');
          right.style.color = p.dias <= 3 ? 'var(--bad)' : 'var(--muted)';
          right.textContent = p.fecha + (p.dias === 0 ? ' (hoy)' : ' (' + p.dias + ' dias)');
          item.appendChild(left);
          item.appendChild(right);
          proxSection.appendChild(item);
        });
        container.appendChild(proxSection);
      }
      
      // Retrasadas
      if (evalRetrasadas > 0) {
        const retSection = document.createElement('div');
        retSection.className = 'card';
        retSection.style.cssText = 'border-color:var(--bad);border-width:2px';
        const retTitle = document.createElement('h2');
        retTitle.style.cssText = 'font-size:15px;margin:0 0 8px;color:var(--bad)';
        retTitle.textContent = '\u26a0 Evaluaciones retrasadas (' + evalRetrasadas + ')';
        retSection.appendChild(retTitle);
        
        rows.forEach(r => {
          if (!Array.isArray(r.evaluaciones)) return;
          r.evaluaciones.forEach(ev => {
            if (ev.estado === 'Pendiente' && ev.fechaPlanificada && ev.fechaPlanificada < hoy) {
              const item = document.createElement('div');
              item.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;font-size:13px';
              item.innerHTML = '<div><b>' + this.esc(r.producto) + '</b> — ' + this.esc(ev.tipo || 'Eval') + '</div><div style="color:var(--bad)">' + ev.fechaPlanificada + '</div>';
              retSection.appendChild(item);
            }
          });
        });
        container.appendChild(retSection);
      }
      
      return container;
    },
    
    // Obtener color para estado
    getStateColor(estado, schema) {
      if (!schema || !schema.schema || !schema.schema.states || !schema.schema.states.colors) {
        return '#9e9e9e';
      }
      return schema.schema.states.colors[estado] || '#9e9e9e';
    },
    
    // Escapar HTML
    esc(s) {
      return s == null ? '' : String(s);
    }
  };
})();
