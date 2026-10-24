/**
 * Rainbow Platform - Módulo Manager
 * Carga configuración de módulos dinámicamente y adapta la UI
 */

(function() {
  'use strict';
  
  window.RainbowModules = {
    currentModule: null,
    modules: [],
    schema: null,
    
    // Inicializar módulos disponibles
    async init() {
      try {
        const res = await fetch('/api/modules');
        if (!res.ok) throw new Error('No autorizado');
        const data = await res.json();
        this.modules = data.modules || [];
        this.defaultModule = data.defaultModule || 'ventas';
        return this.modules;
      } catch (e) {
        console.error('Error cargando módulos:', e);
        return [];
      }
    },
    
    // Cargar schema de un módulo
    async loadSchema(moduleId) {
      try {
        const res = await fetch(`/api/modules/${moduleId}/schema`);
        if (!res.ok) throw new Error('Schema no disponible');
        this.schema = await res.json();
        this.currentModule = moduleId;
        return this.schema;
      } catch (e) {
        console.error('Error cargando schema:', e);
        return null;
      }
    },
    
    // Obtener URL base para API de un módulo
    getApiBase(moduleId) {
      return `/api/modules/${moduleId || this.currentModule}`;
    },
    
    // Adaptar campos del formulario según schema
    renderFormFields(container, schema, values = {}) {
      if (!schema || !schema.schema || !schema.schema.fields) return;
      
      container.innerHTML = '';
      const fields = schema.schema.fields;
      
      fields.forEach(field => {
        const wrapper = document.createElement('div');
        
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
            input.min = 0;
            break;
          default:
            input = document.createElement('input');
            input.type = 'text';
        }
        
        input.id = `field_${field.name}`;
        input.name = field.name;
        if (field.required) input.required = true;
        if (values[field.name] !== undefined) input.value = values[field.name];
        if (field.placeholder) input.placeholder = field.placeholder;
        
        wrapper.appendChild(input);
        container.appendChild(wrapper);
      });
    },
    
    // Extraer valores del formulario
    getFormValues(container) {
      const values = {};
      const inputs = container.querySelectorAll('input, select, textarea');
      inputs.forEach(input => {
        if (input.type === 'number') {
          values[input.name] = Number(input.value) || 0;
        } else {
          values[input.name] = input.value;
        }
      });
      return values;
    },
    
    // Renderizar selector de módulos
    renderModuleSelector(container, onChange) {
      if (this.modules.length <= 1) return; // No mostrar si solo hay uno
      
      const wrapper = document.createElement('div');
      wrapper.className = 'card';
      wrapper.style.marginBottom = '14px';
      wrapper.innerHTML = '<label>Módulo</label>';
      
      const select = document.createElement('select');
      select.id = 'moduleSelector';
      select.style.width = '100%';
      
      this.modules.forEach(mod => {
        const option = document.createElement('option');
        option.value = mod.id;
        option.textContent = `${mod.icon} ${mod.name}`;
        select.appendChild(option);
      });
      
      select.addEventListener('change', (e) => {
        if (onChange) onChange(e.target.value);
      });
      
      wrapper.appendChild(select);
      container.insertBefore(wrapper, container.firstChild);
    },
    
    // Obtener color para un estado
    getStateColor(estado) {
      if (!this.schema || !this.schema.schema || !this.schema.schema.states) return '#9e9e9e';
      return this.schema.schema.states.colors[estado] || '#9e9e9e';
    },
    
    // Verificar si una vista está habilitada
    isViewEnabled(viewName) {
      if (!this.schema || !this.schema.schema || !this.schema.schema.views) return false;
      return this.schema.schema.views[viewName] && this.schema.schema.views[viewName].enabled;
    }
  };
})();
