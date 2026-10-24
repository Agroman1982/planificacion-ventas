# Desplegar en Render — Planificación de Ventas (Rainbow)

## Qué se preparó
- El servidor ahora guarda los datos en la carpeta `DATA_DIR` (variable de entorno).
  En Render el disco persistente se monta en `/data`, así la información de los
  representantes **no se pierde** al reiniciarse el servicio.
- `render.yaml` define el Web Service + un disco persistente de 1 GB.
- El código ya está en un repo git local, listo para subir.

## Paso 1 — Crear cuenta en GitHub (gratis)
1. Entra a https://github.com y regístrate.
2. Verifica tu correo electrónico.

## Paso 2 — Crear el repositorio
1. Click en **New repository** (arriba a la derecha).
2. Nombre: `planificacion-ventas`.
3. Elige **Private** (privado, recomendado) o Public.
4. **NO** marques "Add a README" ni nada más. Click **Create repository**.

## Paso 3 — Subir el código (dos opciones)

### A) Que yo lo suba (recomendado, más rápido)
1. En GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**.
2. Marca el permiso **repo** (todos). Expiración: 7 días está bien.
3. Copia el token y pásamelo aquí, junto con la URL de tu repo
   (ej. `https://github.com/TUUSUARIO/planificacion-ventas.git`).
4. Yo hago el `git push`. Luego borro el token de la configuración por tu seguridad.

### B) Subirlo tú desde tu laptop
1. Descarga el ZIP `planificacion-ventas-render.zip` que te pasé.
2. Descomprímelo y abre una terminal en esa carpeta.
3. Ejecuta:
   ```
   git init
   git remote add origin <URL-DE-TU-REPO>
   git add .
   git commit -m "init"
   git branch -M main
   git push -u origin main
   ```

## Paso 4 — Conectar Render (crear cuenta es gratis; el servicio es de pago ~$7/mes por el disco)
1. Entra a https://render.com y crea cuenta (puedes usar tu GitHub).
2. Dashboard → **New** → **Blueprint**.
3. Conecta tu cuenta de GitHub y elige el repo `planificacion-ventas`.
4. Render leerá `render.yaml` automáticamente. Click **Apply**.
5. En el servicio, pestaña **Environment**, confirma que existen:
   `DATA_DIR = /data` y `NODE_VERSION = 22`.
6. Espera el deploy (1–2 min). Render te dará una **URL fija**, ej.
   `https://planificacion-ventas-rainbow.onrender.com`.
7. ¡Listo! Esa URL funciona 24/7 desde cualquier celular, sin que tu laptop esté encendida.

## Paso 5 — Primer uso
- Entra a la URL de Render e inicia sesión como admin: `hector` / `rainbow2026`.
- Cambia la clave desde el panel de administrador.
- Pasa la URL a los reps con sus usuarios (`ventas2026`).

## Notas
- El plan **starter** (~$7/mes) es el que permite el disco persistente. El plan
  gratis borraría los datos al reiniciarse: por eso usamos starter.
- Si quieres un dominio propio (ej. ventas.rainbow.pe), se configura en Render
  (opcional, tiene un costo aparte).
