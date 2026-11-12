# Copia de seguridad — Rainbow Platform

Los datos de la aplicación (registros de ventas, ensayos de I+D, metas, to-do,
usuarios y el catálogo de clientes) viven en el **disco persistente de Render**
(`/data`). Ese disco puede perderse o ser reemplazado.

Este documento explica cómo hacer una copia de seguridad y cómo restaurarla.

---

## ⚠️ Antes de nada: dónde guardar el backup

**El repositorio de GitHub es PÚBLICO.** Un snapshot contiene los *hashes* de las
contraseñas de los usuarios, así que:

> **Nunca subas un archivo `rainbow-backup-*.json` a GitHub ni a ningún sitio
> público.** Ya está en `.gitignore` por si acaso.

Guárdalo en un lugar **privado**: tu Google Drive, OneDrive, un disco externo o
una carpeta local. Cualquiera de esos sirve. Lo importante es que esté fuera
del disco de Render y fuera de GitHub.

---

## Cómo hacer una copia de seguridad

Desde una terminal, en la carpeta `planificacion-ventas`:

```bash
# 1) Indica tus credenciales (no se guardan en el código)
export RAINBOW_USER=hector
export RAINBOW_PASS=tu-contraseña

# 2) Descarga el snapshot
node tools/backup.js descargar
```

El archivo se guarda en `backups-rainbow/rainbow-backup-AAAAMMDD-HHMM.json`
dentro de la carpeta del proyecto. Puedes indicar otra carpeta:

```bash
node tools/backup.js descargar "C:/mis-backups/rainbow"
```

### Qué incluye el snapshot

| Contenido | Detalle |
|---|---|
| `usuarios` | Con `salt` y `hash`: al restaurar, las contraseñas siguen siendo las mismas |
| `metas` | Las metas mensuales de venta |
| `clientes` | Altas y bajas del catálogo (las 393 clientes de la base ya están en el repo) |
| `todos` | Las tareas del to-do del supervisor |
| `modulos` | Los registros de **ventas**, **marketing** e **I+D** |

**No incluye las sesiones**: caducan solas en 7 días y no aportan nada a una
restauración (tras restaurar hay que volver a iniciar sesión).

---

## Cómo restaurar

```bash
export RAINBOW_USER=hector
export RAINBOW_PASS=tu-contraseña

# Primero, muestra qué se va a restaurar (NO cambia nada)
node tools/backup.js restaurar backups-rainbow/rainbow-backup-20261112-0810.json

# Cuando confirmes que es el archivo correcto, aplica
node tools/backup.js restaurar backups-rainbow/rainbow-backup-20261112-0810.json --si
```

**Antes de sobrescribir nada**, la restauración guarda el estado actual del
servidor en `/data/backups/pre-restore-<fecha>.json`. Si algo sale mal, ese
archivo permite deshacer el cambio.

> **Restaurar invalida las sesiones abiertas.** Todos tendrán que volver a
> iniciar sesión. Es a propósito: una restauración cambia el estado de los
> usuarios.

### Cuándo restaurar

- El disco de Render se perdió o se reemplazó.
- Alguien borró datos por error y sabes qué día pasó.
- Tras una actualización grande, si algo quedó mal.

---

## Los endpoints (avanzado)

Si prefieres hacerlo por HTTP, con la sesión iniciada:

```bash
# Descargar
curl -b cookies.txt https://planificacion-ventas-rainbow.onrender.com/api/admin/backup -o backup.json

# Restaurar
curl -b cookies.txt -X POST https://planificacion-ventas-rainbow.onrender.com/api/admin/restore \
  -H "Content-Type: application/json" \
  -d '{"confirmar":"RESTAURAR","snapshot":{...}}'
```

Ambos exigen rol **administrador o supervisor**.

---

## Recomendación: una copia automática

Lo ideal es no depender de que alguien se acuerde. Una opción sencilla es
programar en Windows (Programador de tareas) una tarea diaria que ejecute:

```
node "C:\...\planificacion-ventas\tools\backup.js" descargar "C:\mis-backups\rainbow"
```

Revisa el archivo de texto en `C:\mis-backups\rainbow\` y pásalo a tu Drive de
vez en cuando.

---

## Cómo está protegido el servidor

Como parte de este trabajo, el servidor quedó más difícil de tumbar:

- **Escrituras atómicas**: todos los JSON se escriben en un archivo temporal y
  se renombran al final. Si el proceso se corta a mitad de escritura, el
  archivo anterior queda intacto en lugar de quedar truncado.
- **Excepciones controladas**: un fallo puntual de disco ya no mata el proceso
  Node; se registra y el servidor sigue sirviendo.
