# Planificación Semanal de Ventas

Plantilla en línea para que cada representante comercial programe su semana de trabajo
(ubicación, cliente, trabajo a realizar, venta a concretar) y reporte lo ejecutado
(estado, venta realizada, observaciones). Acceso desde celular o laptop, con login real:
**cada vendedor solo ve y edita sus propias filas; el administrador ve la programación de todos.**

## Requisitos
- Node.js 18+ (ya disponible en este equipo). Sin dependencias externas.

## Ejecutar en local
```bash
cd planificacion-ventas
node server.js
```
Abre **http://localhost:3000** en el navegador. Para usar desde el celular en la misma
red WiFi, abre `http://<IP-local-del-equipo>:3000` (ej. `http://192.168.1.20:3000`).
La IP local la ves con `ipconfig` (Windows) en "IPv4".

## Acceso desde Internet (para que los vendedores entren desde cualquier lugar)
El servidor debe quedar alojado (hosting). Opciones sencillas y gratuitas:
- **Render / Railway / Fly.io**: sube esta carpeta como proyecto Node, comando de arranque
  `node server.js`, y se genera un link público (https).
- **VPS propio**: corre `node server.js` y expón el puerto 3000 (con nginx + HTTPS recomendado).
- Rápido para probar: tunnel `cloudflared` o `ngrok` apuntando al puerto 3000.

## Credenciales iniciales (cámbialas en el panel de administrador)
- Administrador: `hector` / `rainbow2026`
- Vendedores: `marco`, `antony`, `joan`, `alfredo` / `ventas2026`

## Gestión de vendedores
Como administrador (botón **Gestionar vendedores**) puedes:
- **Agregar** un vendedor o administrador más.
- **Renombrar** (nombre y usuario).
- **Cambiar la contraseña** temporal.
- **Retirar** un vendedor (sus actividades se eliminan con él).

Esto cubre "agregar, retirar o renombrar vendedores" sin tocar código.

## Campos de cada actividad
Representante (automático), Semana, Día, Ubicación, Cliente, Trabajo a realizar,
Venta a concretar (US$), Estado (Planificado / En curso / Realizado / No realizado),
Venta realizada (US$), Observaciones.

## Seguridad
- Contraseñas hasheadas (scrypt) y sesión por cookie HttpOnly.
- **Aislamiento a nivel de servidor**: la API filtra las filas por dueño; un vendedor
  no puede leer ni modificar las actividades de otro (se probó: devuelve 403).
- El administrador tiene vista "Todos" y puede filtrar por vendedor, además de crear
  actividades a nombre de un vendedor.

## Datos
Se guardan en `data.json` (mismo carpeta). Haz respaldo de ese archivo.
Para empezar de cero, borra `data.json` y reinicia el servidor (resembra los usuarios).

## Personalización
- Moneda: en `server.js` los montos son numéricos; el símbolo "US$" se muestra en el
  frontend (`index.html`). Para otra moneda, cambia "US$" en `index.html`.
- Más campos: agrégalos en `cleanRowInput()` (server.js) y en el formulario (index.html).
