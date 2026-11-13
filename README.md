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
Venta a concretar (US$), Estado (En curso / Realizado / No realizado),
Venta realizada (US$), Observaciones. La **Semana** se calcula sola desde la fecha
y no es editable; el **Estado** no aparece en el formulario (todo registro nace
«En curso») y se resuelve en el detalle junto con si la venta se concretó, el
motivo cuando no se logró y el monto real de la venta.

## Panel superior de metas (app unificada)
En `/` y `/app`, arriba de la barra de herramientas de Ventas se muestra:
- 4 KPIs y una barra de avance. Para un **vendedor** son su meta personal
  (Mi meta / Realizado / Falta / % Cumplimiento). Para un **supervisor,
  coordinador o administrador** —roles que *no* tienen meta de ventas propia—
  los KPIs resumen a todo su equipo («Meta del equipo»), en lugar de mostrar
  «Mi meta US$ 0,00 / Sin meta asignada».
- Tabla **Vendedor / Meta / Realizado / Falta / %** con total del equipo y barra
  de avance. **Sólo aparecen vendedores** (`retail`, `kam`, `promotor`): los
  jefes no se listan ni se cuentan en el Total. Un clic en un vendedor aplica
  el filtro a Calendario, Lista y Resumen.
- Pestañas **TOTAL** (suma anual) + Ene…Dic, selector de año y botón para plegar
  el panel (la preferencia se recuerda en el navegador).

El alcance lo fija el servidor: `/api/users`, `/api/goals` y las filas visibles ya
aplican `idsVisiblesPara()`, de modo que **cada supervisor ve únicamente las ventas
de su equipo**. `ventaRealizada` se suma por `dia` dentro del periodo elegido;
cuando no hay meta asignada se muestra «—» en lugar de un 0% engañoso.

## ToDo visible
Debajo de la barra de herramientas hay una tarjeta **ToDo** permanente, con el
número de tareas pendientes (también como contador en el botón de la barra):
- El **representante** ve únicamente las tareas que le asignaron y puede pulsar
  «Programar» para cargarlas en el formulario.
- El **supervisor / coordinador / administrador** ve las de su equipo, con el
  nombre del asignado, y además puede usar «+ Asignar tarea».
- El alta y el borrado siguen siendo exclusivos de jefes de equipo; el modal
  «Tareas ToDo» se conserva para asignar. Al guardar la actividad programada
  la tarea se elimina sola.

## Apariencia
Fondo de página claro (`--page`) y verde oscuro (`--bg`) reservado para cabeceras,
pestaña activa y acentos, de modo que el encabezado del panel de metas ya no se
confunde con el fondo. Tarjetas con sombra, cabecera con filete verde y botones
secundarios en verde suave. Aplica a Ventas, I+D, Marketing y a `/index.html`.

## Colores de estado en Ventas
`En curso` = **gris claro** (`#D1D5DB`) con texto oscuro; `Realizado` = verde (✓) y
`No realizado` = rojo (✗). En el calendario con el filtro «Todos» el color de la
pastilla identifica al representante y la marca gris ● identifica «En curso».

### Oportunidades de venta en el calendario
Toda actividad con **Venta a concretar (US$) > 0** lleva un distintivo **$** ámbar al
inicio de la pastilla, tanto con el filtro «Todos» como con un representante
seleccionado. El `$` se coloca antes del nombre del cliente para que no quede
oculto por el recorte de textos largos; al pasar el cursor se ve el monto
programado. La leyenda del calendario explica el símbolo y resume cuántas
oportunidades hay en el mes visible y por cuánto dinero, siempre sobre las
filas que el usuario tiene permiso de ver (servidor mediante `idsVisiblesPara()`).
El distintivo es informativo: no sustituye la marca ✓ / ✗ / ● del estado.

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
