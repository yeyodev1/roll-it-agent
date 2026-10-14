# Roll It · agente del local

Programa que corre en una PC de cada local, lee las ventas de SmartMenu y las sube al panel de Roll It cada
pocos minutos. SmartMenu solo se ve dentro de la red del local, por eso el agente tiene que estar ahí.

## Para la persona del local (Windows)

1. **Instala Node.js**: entra a <https://nodejs.org/es/download>, baja la versión **LTS** e instálala con todo
   por defecto (siguiente, siguiente, finalizar).
2. **Baja el agente**: en <https://github.com/yeyodev1/roll-it-agent> toca **Code → Download ZIP**.
   Descomprímelo en `Documentos\roll-it-agent`.
3. **Doble clic en `instalar.bat`**. Tarda unos minutos. Al final se abre `config.json` en el Bloc de notas:
   - `syncKey`: pega la llave que te pasó Bakano.
   - `branch`: `villa-club`, `marbol` o `cuenca`, según el local.
   - `smartmenuUrl`: la dirección con la que entran a SmartMenu en este local (la que está en el navegador
     de la caja, termina en `/SMARTMENU/login.html`).
   - `smartmenuKey`: la clave numérica con la que entran a SmartMenu.
   - Guarda (Archivo → Guardar) y cierra.
4. **Doble clic en `descubrir.bat`**. Se abre SmartMenu y entra solo con la clave (si no, escríbela tú).
   Ve a **Reportes → Ventas detallado**, pon las fechas de **hoy** y exporta a **Excel**. Cuando baje el
   archivo, **cierra el navegador**. En el Escritorio queda `descubrimiento-<fecha>.zip`: envíalo a Bakano.
5. **Clic derecho en `instalar-servicio.bat` → Ejecutar como administrador**. Desde ahí el agente arranca
   solo cada vez que se prende la PC. No hay que abrir nada más.

Mientras Bakano termina de configurar la descarga automática, el agente vigila la carpeta **Descargas**:
cada vez que alguien exporta el "Reporte de ventas detallado" en esa PC, se sube solo al panel.

La PC tiene que quedar **prendida y con internet**. En el panel (Ajustes → Sincronización) se ve si el agente
del local está *En vivo*.

## macOS / Linux

Lo mismo con los `.sh`: `./instalar.sh`, editar `config.json`, `./descubrir.sh`, `./instalar-servicio.sh`.

## Para Bakano

`config.json` va junto al agente y **no se sube al repo** (lleva la llave). Campos:

| Campo | Qué es |
|---|---|
| `apiUrl` | `https://roll-it-backapp.vercel.app/api` |
| `syncKey` | el `SYNC_API_KEY` del back (header `x-sync-key`) |
| `branch` | slug de la sucursal |
| `smartmenuUrl` / `smartmenuKey` | login de SmartMenu en la red del local (clave numérica, sin usuario) |
| `intervalMinutes` | cada cuánto corre un ciclo y se manda el latido (por defecto 5) |
| `downloadsDir` | carpeta que vigila el modo `carpeta` (vacío = Descargas del usuario) |
| `mode` | `carpeta`, `auto` o `descubrir` |
| `recipeUrl` | opcional. De dónde baja la receta actualizada (por defecto `smartmenu-steps.json` de `main` en este repo); `""` = solo la local |

### Modos

- **descubrir**: abre SmartMenu con el navegador visible, entra con la clave (campo de clave o teclado
  numérico en pantalla) y graba todo mientras la persona navega: HAR completo con cuerpos (`red.har`), un
  respaldo de la red escrito sobre la marcha (`red.jsonl`), captura y HTML de cada pantalla
  (`pantallas/`, con `indice.txt`), consola y lo que se descargue. Al cerrar el navegador arma el zip en el
  Escritorio. Con eso se ven los endpoints internos y se ajusta la receta.
- **carpeta**: revisa `downloadsDir` cada 20 s. Sube cada `.xls`/`.xlsx` con `VENTAS_DETALLADO` en el nombre,
  o cualquier Excel nuevo con el encabezado `REPORTE DE VENTAS DETALLADO`, a `POST /sync/upload`, y lo repite
  mientras responda `pending > 0`. Lo ya subido queda en `datos/registro.json` por hash. Solo mira archivos
  de hasta una semana antes de la primera vez que corrió. Un 4xx (otro local, archivo raro) se marca como
  rechazado y no se reintenta.
- **auto**: también vigila la carpeta, y además cada `intervalMinutes` entra a SmartMenu sin ventana, corre la receta `smartmenu-steps.json`,
  baja el reporte desde las 00:00 del día del último envío exitoso (máximo 7 días) hasta ahora, y lo sube.
  Si un paso falla deja captura + HTML en `logs/fallos/` y vuelve a intentar en el siguiente ciclo.

En `carpeta`, si la receta tiene `"activa": true` el agente también corre el ciclo de `auto`. La receta se
baja del repo en cada ciclo, así que **para pasar los tres locales a descarga automática basta con ajustar
`smartmenu-steps.json`, poner `"activa": true` y hacer push**; nadie tiene que tocar la PC. Viene en `false`
porque una receta sin probar no debe andar haciendo clics en el sistema de facturación.

En todos: latido a `POST /sync/heartbeat` cada ciclo con el último error, logs diarios en `logs/` (14
días), reintentos con espera creciente si no hay internet, y una sola copia corriendo por PC.

### La receta (`smartmenu-steps.json`)

Lista de pasos que se corren en orden. Cada paso acepta `optional: true` (si falla se sigue) y
`timeoutSeconds`.

| `action` | Campos | Hace |
|---|---|---|
| `login` | `url?` | entra con `smartmenuKey` |
| `goto` | `url` | abre una dirección |
| `click` / `hover` | `text` (lista, se prueba en orden) o `selector` | clic en enlace, botón, menú o texto visible, en cualquier frame |
| `fill` / `select` | `label` o `selector`, `value`, `format?` | llena un campo; `value` admite `{desde}`, `{hasta}`, `{hoy}`, `{ahora}` y `{desde:dd-MM-yyyy}` |
| `press` | `key` | tecla (por defecto Enter) |
| `wait` / `waitFor` | `seconds` / `text` o `selector` | espera |
| `waitForDownload` | `text` o `selector` del botón | clic y espera la descarga |

Formato de fechas: `yyyy MM dd HH hh mm ss tt` (por defecto `dateFormat` de la receta). Los campos
`type="date"` se llenan solos en el formato del navegador.

Para probar una receta en el local: `probar-receta.bat` usa la receta **local** con el navegador visible y
no sube nada (`--subir` para subir, `--oculto` sin ventana, `--remota` para probar la del repo).

### Desarrollo

```bash
npm install && npx playwright install chromium && npm run build
node dist/index.js carpeta   # o auto, descubrir, probar-receta
```

`ROLLIT_AGENT_HOME` cambia la carpeta donde busca `config.json`, la receta, `logs/` y `datos/`.
