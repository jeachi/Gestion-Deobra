# Gestión de Obra — Claude Code

Asistencia, Pedidos, Caja Chica y Certificados de obra. PWA para Jesús Chimino (ARQ Jesus).

## Qué es este proyecto

Un único `index.html` (~28.000 líneas) con todo el HTML/CSS/JS inline en un solo
`<script>`. **No hay build ni bundler ni `node_modules` en producción** — el archivo
se sirve tal cual. `package.json` existe solo para poder correr los tests con
`node --test`.

- **Backend**: Firebase (Firestore + Auth + Storage opcional), cargado desde CDN
  (`gstatic.com/firebasejs`) con scripts `-compat.js`, no ES modules.
- **PWA**: `manifest.json` + `sw.js` (service worker con estrategia red-primero,
  cache como plan B) + `icon-*.png`. Cambiar `CACHE_NAME` en `sw.js` cuando se
  quiera forzar que los celulares bajen una versión nueva.
- **Idioma**: todo el código, comentarios, nombres de función y UI están en
  español (es difícil de cambiar, y no hace falta).

## Reglas

- No hay build: nunca se sugiere `npm run build`, webpack, vite, etc. Si algo
  necesita una librería, se agrega por `<script src>` de CDN (cdnjs.cloudflare.com
  o jsdelivr) o inline, nunca `npm install` en el `<script>` principal.
- Editar `index.html` con cuidado: es un solo archivo enorme. Ubicar la sección
  correcta antes de tocar (buscar por nombre de función/feature), no reescribir
  bloques grandes de una.
- Los tests (`tests/*.test.js`) extraen funciones puras directo del HTML por
  nombre vía `tests/extract.js` (cuenta llaves, no entiende strings/regex con
  llaves adentro) — no se puede `require()` el HTML como módulo. Al agregar una
  función pura nueva que merezca test, agregarla a la lista de `cargarDesdeApp`
  en el test correspondiente.
- Los tests solo cubren funciones puras (fechas, moneda, texto, búsqueda) — nada
  que dependa del DOM, Firestore o estado global de la app.
- Siempre correr `npm test` después de tocar `index.html` o `tests/`.
- Nunca commitear secretos, credenciales de Firebase reales ni `.env`.
- Mantener los mensajes de commit y comentarios de código en español, como el
  resto del repo.
- Antes de dar por buena una sesión de trabajo, ejecutar `npm test`.

## CI

`.github/workflows/tests.yml` corre `npm test` en cada PR y push a `main` que
toque `index.html`, `tests/**` o `package.json`. `.github/workflows/stamp-version.yml`
actualiza un stamp de versión.

## Herramientas de Ruflo/MCP (opcional)

Este repo tiene `.mcp.json` con el servidor MCP de `ruflo` y `.claude/` con
agentes/skills/hooks instalados por `npx ruflo@latest init wizard`. Son
herramientas de coordinación opcionales para tareas grandes (swarms, memoria,
routing) — no son necesarias para trabajar en este proyecto, que es chico y de
un solo archivo. Para casi todo alcanza con leer, editar y correr los tests
directamente; no hace falta invocar agentes ni el swarm para cambios simples.
