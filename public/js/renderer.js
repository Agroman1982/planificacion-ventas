/**
 * Rainbow Platform - Dynamic Module Renderer
 * Renderiza formularios, listas y vistas basado en el schema del módulo
 */

(function() {
  'use strict';
  
  window.ModuleRenderer = {
    // Renderizar formulario dinámico
    renderForm(containerId, schema, values, isAdmin) {
      const container = document.getElementById(containerId);
      if (!container || !schema || !schema.schema || !schema.schema.fields) return;
      
      container.innerHTML = '';
      const fields = schema.schema.fields;
      const grid = document.createElement('div');
      grid.className = 'grid';
      
      fields.forEach(field => {
        const wrapper = document.createElement('div');
        if (field.type === 'textarea') wrapper.style.gridColumn = '1/-1';
        
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
            field.options.forEach(opt => {
              const option = document.createElement('option');
              option.value = opt;
              option.textContent = opt;
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
          input.title = 'Se calcula automáticamente';
        }
        
        wrapper.appendChild(input);
        grid.appendChild(wrapper);
      });
      
      container.appendChild(grid);
    },
    
    // Extraer valores del formulario
    getFormValues(schema) {
      if (!schema || !schema.schema || !schema.schema.fields) return {};
      const values = {};
      schema.schema.fields.forEach(field => {
        const input = document.getElementById('field_' + field.name);
        if (input) {
          if (field.type === 'number') {
            values[field.name] = Number(input.value) || 0;
          } else {
            values[field.name] = input.value;
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
      
      // Título principal (primer campo de texto)
      const titleField = schema.schema.fields.find(f => f.type === 'text');
      const title = document.createElement('div');
      title.innerHTML = '<b>' + this.esc(row[titleField ? titleField.name : 'nombre']) + '</b>';
      header.appendChild(title);
      
      // Estado badge
      const estadoField = schema.schema.fields.find(f => f.name === 'estado');
      if (estadoField && row.estado) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = row.estado;
        badge.style.background = this.getStateColor(row.estado, schema);
        badge.style.color = '#fff';
        header.appendChild(badge);
      }
      
      card.appendChild(header);
      
      // Metadatos
      const meta = document.createElement('div');
      meta.className = 'meta';
      
      schema.schema.fields.forEach(field => {
        if (field.name === 'estado') return; // Ya mostrado
        if (!row[field.name]) return; // Vacío
        
        const item = document.createElement('div');
        const key = document.createElement('div');
        key.className = 'k';
        key.textContent = field.label;
        
        const value = document.createElement('div');
        value.className = 'v';
        if (field.type === 'number') {
          value.innerHTML = '<span class="money">US$ ' + Number(row[field.name]).toLocaleString('en-US', {minimumFractionDigits: 2}) + '</span>';
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
