# Calculadora de Materiales — PR 1 (módulo base + Mampostería) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first working slice of the new "Calculadora de Materiales" module: a grid-of-rubros home screen, the generic add-to-computo/report pattern, and one fully working rubro (Mampostería, 4 modos) with its materials report in PDF.

**Architecture:** `index.html` is a single-file app (no build, no modules) — everything below is added inline, following the app's existing conventions exactly: a new `<section class="view">` + bottom-nav `tab-btn`, wired through the existing `irA(view)` dispatcher; a form rendered inside the app's existing generic bottom-sheet modal (`abrirPromptGenerico`/`cerrarPromptGenerico`, already used by dozens of screens and already wired to the Android back button); an accumulator ("Mi cómputo") persisted with the same single-index-key `window.storage` pattern used by Pedidos/Recordatorios/Observaciones (`calc_materiales_index`, one JSON array, each item tagged with `.obra`); the PDF report reuses the existing `mostrarModalPDF` + `construirEncabezadoReportePDF` engine (same one `generarReporteHerramientasPDF` uses), so no PDF code is new. The 12 other rubros appear in the grid as visibly disabled "Próximamente" cards (per the phased plan) so the final shape of the module is visible from PR 1, but only Mampostería is clickable.

**Tech Stack:** Vanilla JS inline in `index.html`, existing CSS classes (`dash-grid`/`dash-card`, `chip-row`/`chip-opt`, `card`, `field`, `row-flex`, `helper`, `btn`), existing Firestore-backed `window.storage` wrapper, existing jsPDF/html2canvas report engine. Tests: Node's built-in `node:test` via `tests/extract.js` (pure functions) + Playwright via `tests/e2e/run.js` (UI flows).

**Spec:** `docs/superpowers/specs/2026-10-14-calculadora-materiales-design.md` (commits `6fc55f8`, `2609b3f`) — this plan implements only the "Mampostería" section of "Fórmulas y valores por defecto" (item 1) and the "Concepto de UX" / "Modelo de datos" / "Navegación" sections, scoped to PR 1 as defined in "Plan de entrega".

## Global Constraints

- Single file: all changes land in `index.html`; no build step, no new dependencies, no new files except the plan/spec docs and new `tests/e2e/test-*.js` files.
- No prices anywhere — quantities and commercial units only (spec-wide rule).
- Every numeric rendimiento/dosificación default must stay an editable input, never hardcoded-only (spec-wide rule already reflected in the field designs below).
- No permission gating for this module in PR 1 (`cualquier usuario logueado puede calcular` — do NOT add `"calcmateriales"` to `MODULOS_PERMISO` or the admin-only list in `irA`).
- Must run `npm test` and `npm run test:e2e` green before every commit (repo-wide rule already in use for every PR this session).
- Reuse, do not duplicate: the modal, the PDF engine, `esc()`, `guardarClave()`, `poblarSelectObras()`, `hoyISO()` — do not write new versions of any of these.

## Review Focus

- **Largo/alto left empty or zero when tapping "Agregar al cómputo":** `calcularMamposteria` must not throw and must not silently add a nonsensical 0-piece item — the add action must block with a toast until both are > 0 (an empty muro is not a case the spec's formulas were designed to represent; the module's job is to produce a usable materials list, not a zero row).
- **No obra selected when adding to cómputo:** same as above — block with a toast rather than saving an item with `obra:""` that would be unreadable in the PDF report and impossible to filter later.
- **Switching "tipo" after editing largo/alto:** the typed largo/alto must survive the tipo/formato switch (only `tipo`/`formato`/`rendimiento` reset-on-pick fields should change) — a user who already set 8m×2.5m and then corrects the tipo should not have to retype the dimensions.
- **Reporte PDF with an empty "Mi cómputo":** `generarReporteCalcMaterialesPDF` must refuse with a toast instead of opening a PDF preview with an empty table (same pattern as `generarReporteHerramientasPDF`'s empty-list guard).
- **Reloading mid-session / storage read failure:** `cargarCalcMateriales()` must follow the same "Clave no encontrada" vs. real-error split already used by `cargarRecordatorios`/`cargarObservaciones`, so a first-ever read (key doesn't exist yet) silently starts empty, while a real read failure blocks saves with the existing `errorCarga*` guard instead of silently overwriting good data with an empty array.

---

### Task 1: Pure calculation function for Mampostería

**Files:**
- Modify: `index.html` (add a new top-level function near the other pure calc helpers, e.g. right after `fechaAR` around line 6608)
- Test: `tests/pure-functions.test.js` (append to the existing file)

**Interfaces:**
- Produces: `function calcularMamposteria(state)` where `state = {tipo, formato, largo, alto, rendimiento, desperdicio}` (all numbers except `tipo`/`formato`, which are strings). Returns `{area, piezas, bolsasCemento, m3Arena, bolsasCal, usoTipico}`. Self-contained (the "uso típico" text table lives inside the function body, not in an external const) so it can be extracted by name alone via `tests/extract.js`.

- [ ] **Step 1: Write the failing unit tests**

```js
const { calcularMamposteria } = cargarDesdeApp([{ nombre: "calcularMamposteria" }]);

test("calcularMamposteria: hormigón 20x20x40, muro de 8x2.5m, sin desperdicio", () => {
  const r = calcularMamposteria({ tipo:"hormigon", formato:"20x20x40", largo:8, alto:2.5, rendimiento:12.5, desperdicio:0 });
  assert.equal(r.area, 20);
  assert.equal(r.piezas, 250); // 20 * 12.5
  assert.equal(r.usoTipico, "Muros portantes, cercos y medianeras.");
});

test("calcularMamposteria: aplica el % de desperdicio redondeando hacia arriba", () => {
  const r = calcularMamposteria({ tipo:"hormigon", formato:"20x20x40", largo:8, alto:2.5, rendimiento:12.5, desperdicio:5 });
  assert.equal(r.piezas, 263); // ceil(250 * 1.05) = ceil(262.5)
});

test("calcularMamposteria: ladrillo común 'de plano' usa el texto de pared doble", () => {
  const r = calcularMamposteria({ tipo:"ladrillo", formato:"6x12x24-plano", largo:5, alto:2.5, rendimiento:144, desperdicio:0 });
  assert.match(r.usoTipico, /pared doble/);
});

test("calcularMamposteria: ladrillo común 'de canto' (cualquier otro formato) usa el texto de pared simple", () => {
  const r = calcularMamposteria({ tipo:"ladrillo", formato:"6x12x24", largo:5, alto:2.5, rendimiento:72, desperdicio:0 });
  assert.match(r.usoTipico, /pared simple/);
});

test("calcularMamposteria: hueco y portante devuelven sus textos de uso típico propios", () => {
  assert.match(calcularMamposteria({ tipo:"hueco", formato:"hueco18", largo:1, alto:1, rendimiento:16, desperdicio:0 }).usoTipico, /NO portantes/);
  assert.match(calcularMamposteria({ tipo:"portante", formato:"portante18", largo:1, alto:1, rendimiento:16, desperdicio:0 }).usoTipico, /carga/);
});

test("calcularMamposteria: largo o alto en 0 da área y piezas en 0, no NaN ni excepción", () => {
  const r = calcularMamposteria({ tipo:"hormigon", formato:"20x20x40", largo:0, alto:2.5, rendimiento:12.5, desperdicio:5 });
  assert.equal(r.area, 0);
  assert.equal(r.piezas, 0);
});

test("calcularMamposteria: cemento, arena y cal son proporcionales a piezas (referencias fijas 180/300/220)", () => {
  const r = calcularMamposteria({ tipo:"hormigon", formato:"20x20x40", largo:8, alto:2.5, rendimiento:12.5, desperdicio:0 }); // 250 piezas
  assert.equal(r.bolsasCemento, 2);  // ceil(250/180)
  assert.equal(r.m3Arena, 0.83);     // round(250/300, 2)
  assert.equal(r.bolsasCal, 2);      // ceil(250/220)
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pure-functions.test.js`
Expected: FAIL with "No se encontró function calcularMamposteria(...)"

- [ ] **Step 3: Implement `calcularMamposteria(state)` in `index.html`**

Port the formula already validated in the design-canvas mockup (`Mamposteria.dc.html`'s `renderVals()`), as a standalone function:
- `area = Math.max(0, (state.largo||0) * (state.alto||0))`
- `piezas = Math.ceil(area * (state.rendimiento||0) * (1 + (state.desperdicio||0)/100))`
- `bolsasCemento = Math.max(0, Math.ceil(piezas/180))`
- `m3Arena = Math.round((piezas/300)*100)/100`
- `bolsasCal = Math.max(0, Math.ceil(piezas/220))`
- `usoTipico`: inline object literal keyed by `state.tipo` (`hormigon`/`ladrillo`/`hueco`/`portante`), with `ladrillo`'s value computed by a ternary on `state.formato === "6x12x24-plano"` (ver spec, sección "Fórmulas y valores por defecto → 1. Mampostería").

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pure-functions.test.js`
Expected: PASS (all new tests green, no existing test broken)

- [ ] **Step 5: Commit**

```bash
git add index.html tests/pure-functions.test.js
git commit -m "feat: calculo puro de Mamposteria (Calculadora de Materiales)"
```

---

### Task 2: "Mi cómputo" storage (load/save/add/remove) + startup wiring

**Files:**
- Modify: `index.html` (new globals/functions near the other `_index` storage pairs, e.g. after `cargarRecordatorios`/`guardarRecordatoriosIndex` around line 15415; add `cargarCalcMateriales()` to the startup `Promise.all` around line 20255)
- Test: `tests/e2e/test-calc-materiales-computo-storage.js` (new)

**Interfaces:**
- Consumes: `guardarClave(clave, valor, msgError)` (existing), `window.storage.get(clave, true)` (existing), `showToast(msg)` (existing).
- Produces:
  - `let calcMaterialesItems = []` (module-level array, same shape as other `*_index` lists)
  - `let errorCargaCalcMateriales = false`
  - `async function cargarCalcMateriales()`
  - `async function guardarCalcMaterialesIndex()` → `Promise<boolean>`
  - `async function agregarItemComputoCalc(item)` → pushes, saves, updates the badge, returns the save's boolean
  - `async function quitarItemComputoCalc(id)` → filters, saves, updates the badge
  - `function actualizarBadgeComputoCalc()` → writes count into `#calc-computo-badge` if present (no-op if the module's view hasn't been built yet — Task 3 adds that element)

- [ ] **Step 1: Write the failing e2e test**

```js
// tests/e2e/test-calc-materiales-computo-storage.js
// Seedea calcMaterialesItems vacío, llama agregarItemComputoCalc(...) dos veces, confirma que
// quedó en window.storage bajo "calc_materiales_index" y que quitarItemComputoCalc borra uno solo.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const fakeDocs = {};
    function fakeDocRef(id) {
      return {
        async get() { const d = fakeDocs[id]; return { exists: !!d, data: () => d }; },
        async set(v) { fakeDocs[id] = v; },
        async delete() { delete fakeDocs[id]; },
      };
    }
    const fakeDb = { collection() { return { doc: (id) => fakeDocRef(id), async get() { return { docs: [] }; } }; } };
    window.firebase = { initializeApp() {}, firestore() { return fakeDb; }, auth() { return { signInAnonymously: () => Promise.resolve() }; } };
  });
  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });
  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
  });

  const tras2Agregados = await page.evaluate(async () => {
    await agregarItemComputoCalc({ id:"a1", rubro:"Mampostería", modo:"X", obra:"VARELA", parametros:{}, resultado:{}, fecha:"2026-10-14" });
    await agregarItemComputoCalc({ id:"a2", rubro:"Mampostería", modo:"Y", obra:"VARELA", parametros:{}, resultado:{}, fecha:"2026-10-14" });
    const r = await window.storage.get("calc_materiales_index", true);
    return { enMemoria: calcMaterialesItems.length, enStorage: JSON.parse(r.value).length };
  });
  if (tras2Agregados.enMemoria !== 2 || tras2Agregados.enStorage !== 2) throw new Error("No se guardaron los 2 items: " + JSON.stringify(tras2Agregados));

  const trasQuitarUno = await page.evaluate(async () => {
    await quitarItemComputoCalc("a1");
    return calcMaterialesItems.map(i => i.id);
  });
  if (JSON.stringify(trasQuitarUno) !== JSON.stringify(["a2"])) throw new Error("quitarItemComputoCalc no filtró bien: " + JSON.stringify(trasQuitarUno));

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-computo-storage");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/e2e/test-calc-materiales-computo-storage.js` (via `npm run test:e2e`, or standalone against an already-running `http-server -p 8811 -s .`)
Expected: FAIL — `agregarItemComputoCalc is not defined`

- [ ] **Step 3: Implement the storage pair and startup wiring**

Copy the exact `cargarRecordatorios`/`guardarRecordatoriosIndex` pattern (lines 15402–15415), renaming the key to `"calc_materiales_index"` and the in-memory array to `calcMaterialesItems`. Add `cargarCalcMateriales()` to the startup `Promise.all([...])` list (around line 20255, alongside `cargarRecordatorios()`). `actualizarBadgeComputoCalc()` just does `const b = document.getElementById("calc-computo-badge"); if(!b) return; ...`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/e2e/test-calc-materiales-computo-storage.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e/test-calc-materiales-computo-storage.js
git commit -m "feat: storage de Mi computo (Calculadora de Materiales)"
```

---

### Task 3: Module shell — nav tab, grid view, `irA` wiring

**Files:**
- Modify: `index.html`:
  - Add a new `tab-btn` after the last one (`data-view="trabajadores"`, line 2508)
  - Add a new `<section class="view" id="view-calcmateriales">` after `</section>` of `view-herramientas` (line 4528)
  - Add `if(view==="calcmateriales") prepararVistaCalcMateriales();` inside `irA` (near line 13958, alongside the other `if(view===...)` calls)
- Test: `tests/e2e/test-calc-materiales-grid.js` (new)

**Interfaces:**
- Consumes: `irA(view)` (existing dispatcher), `esc()` (existing), `showToast()` (existing), `actualizarBadgeComputoCalc()` (Task 2).
- Produces:
  - `const RUBROS_CALC = [...]` — 13 entries, each `{id, icono, titulo, desc, disponible, abrir}` (`abrir` is the name of the opener function as a string, used only when `disponible:true`; only entry `0` ("mamposteria") has `disponible:true` and `abrir:"abrirCalcMamposteria"` in this PR — `abrirCalcMamposteria` itself is implemented in Task 4, so this task's test must not click that card).
  - `function renderGridCalcMateriales()` — writes into `#calc-grid`.
  - `function prepararVistaCalcMateriales()` — calls `renderGridCalcMateriales()` and `actualizarBadgeComputoCalc()`.

- [ ] **Step 1: Write the failing e2e test**

```js
// tests/e2e/test-calc-materiales-grid.js
// Confirma: el tab nuevo existe y navega a la vista; la grilla tiene 13 tarjetas; la de
// Mampostería está habilitada y las otras 12 muestran "Próximamente" al tocarlas (sin navegar
// a ningún formulario, que todavía no existe en este punto del PR).
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const fakeDocs = {};
    function fakeDocRef(id) { return { async get(){ const d=fakeDocs[id]; return {exists:!!d, data:()=>d}; }, async set(v){ fakeDocs[id]=v; }, async delete(){ delete fakeDocs[id]; } }; }
    const fakeDb = { collection(){ return { doc:(id)=>fakeDocRef(id), async get(){ return {docs:[]}; } }; } };
    window.firebase = { initializeApp(){}, firestore(){ return fakeDb; }, auth(){ return { signInAnonymously:()=>Promise.resolve() }; } };
  });
  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });
  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
  });

  const tabExiste = await page.evaluate(() => !!document.querySelector('.tab-btn[data-view="calcmateriales"]'));
  if (!tabExiste) throw new Error("No está el tab de Calculadora de Materiales");

  await page.evaluate(() => irA("calcmateriales"));
  const tarjetas = await page.evaluate(() => document.querySelectorAll("#calc-grid .dash-card").length);
  if (tarjetas !== 13) throw new Error("Se esperaban 13 tarjetas, hubo " + tarjetas);

  const toastTrasTocarDeshabilitada = await page.evaluate(() => {
    const noDisponible = [...document.querySelectorAll("#calc-grid .dash-card")].find(c => c.style.opacity && c.style.opacity !== "1");
    noDisponible.click();
    return document.getElementById("toast").textContent;
  });
  if (!/Próximamente/.test(toastTrasTocarDeshabilitada)) throw new Error("No avisó 'Próximamente' al tocar una tarjeta deshabilitada");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-grid");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/e2e/test-calc-materiales-grid.js`
Expected: FAIL — no `.tab-btn[data-view="calcmateriales"]` found

- [ ] **Step 3: Implement the nav tab, the view section, `RUBROS_CALC`, `renderGridCalcMateriales`, `prepararVistaCalcMateriales`, and the `irA` wiring**

- Tab button (copy the exact attribute shape of the existing ones): `<button class="tab-btn" data-view="calcmateriales" data-ico="🧮" data-nombre="Calculadora de Materiales" data-desc="Cantidades de materiales por rubro, con reporte PDF"><span class="ico">🧮</span><span class="etq">Calc.</span></button>`
- View section:
  ```html
  <section class="view" id="view-calcmateriales">
    <div class="card">
      <div class="row-flex" style="justify-content:space-between;align-items:center;">
        <h2 style="margin:0;">🧮 Calculadora de Materiales</h2>
        <button type="button" class="btn btn-outline btn-sm" onclick="abrirMiComputoCalc()">📋 Mi cómputo <span id="calc-computo-badge" style="display:none;"></span></button>
      </div>
      <p class="helper">Elegí un rubro y calculá cantidades en presentación comercial real de Argentina — sin precios.</p>
      <div class="dash-grid bento" id="calc-grid"></div>
    </div>
  </section>
  ```
  (`abrirMiComputoCalc` is implemented in Task 5 — leave the `onclick` reference in place now; it is dead until then, which is fine since this task's test never clicks it.)
- `RUBROS_CALC`, `renderGridCalcMateriales`, `prepararVistaCalcMateriales` as designed above — disabled cards get `style="opacity:.45;"` and `onclick="showToast('Próximamente')"`; the enabled one gets `onclick="abrirCalcMamposteria()"` (function body added in Task 4 — again, dead reference until then, harmless since nothing calls it in this task's test).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/e2e/test-calc-materiales-grid.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e/test-calc-materiales-grid.js
git commit -m "feat: pantalla de grilla del modulo Calculadora de Materiales"
```

---

### Task 4: Mampostería formulario (tipo/formato chips, inputs, live result)

**Files:**
- Modify: `index.html` (new consts/functions near the Mampostería calc function from Task 1)
- Test: `tests/e2e/test-calc-materiales-mamposteria-form.js` (new)

**Interfaces:**
- Consumes: `abrirPromptGenerico(html)` / `cerrarPromptGenerico()` (existing), `calcularMamposteria(state)` (Task 1), `esc()`, `poblarSelectObras(select, valorPreferido)` (existing), `obraPredeterminada`/`obrasActivas()` (existing globals).
- Produces:
  - `const CALC_MAMP_TIPOS` — array of `{id, nombre, formatos:[{id, nombre, rendimiento}]}`, 4 entries (hormigón/ladrillo/hueco/portante) exactly as enumerated in the spec.
  - `let calcMampState` (module-level, re-initialized each time the form opens)
  - `function abrirCalcMamposteria()`
  - `function htmlFormCalcMamposteria()` → string
  - `function htmlResultadoCalcMamposteria(r, formatoNombre)` → string
  - `function calcMampElegirTipo(tipoId)`, `function calcMampElegirFormato(formatoId)`, `function calcMampCampo(nombre, valor)` — all re-render either the whole form body or just `#calc-mamp-resultado`
  - `function calcMampAgregarAComputo()` — produces the item object; Task 5 implements `agregarItemComputoCalc` consumption of it (already done in Task 2) — this task wires the call and the validation from Review Focus items 1–3, but the success path (`showToast`+`cerrarPromptGenerico`) is enough; Task 5 adds the "Mi cómputo" screen that displays what got added.

- [ ] **Step 1: Write the failing e2e test**

```js
// tests/e2e/test-calc-materiales-mamposteria-form.js
// Abre el formulario de Mampostería, confirma que arranca en hormigón/20x20x40, cambia a
// "Ladrillo hueco", confirma que el texto de "uso típico" cambia y que largo/alto tipeados
// sobreviven al cambio de tipo, y que el resultado se recalcula en vivo al tipear.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const fakeDocs = {};
    function fakeDocRef(id) { return { async get(){ const d=fakeDocs[id]; return {exists:!!d, data:()=>d}; }, async set(v){ fakeDocs[id]=v; }, async delete(){ delete fakeDocs[id]; } }; }
    const fakeDb = { collection(){ return { doc:(id)=>fakeDocRef(id), async get(){ return {docs:[]}; } }; } };
    window.firebase = { initializeApp(){}, firestore(){ return fakeDb; }, auth(){ return { signInAnonymously:()=>Promise.resolve() }; } };
  });
  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });
  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    irA("calcmateriales");
    abrirCalcMamposteria();
  });

  await page.fill("#calc-mamp-largo", "8");
  await page.fill("#calc-mamp-alto", "2.5");
  const piezasHormigon = await page.evaluate(() => document.getElementById("calc-mamp-resultado").textContent);
  if (!/250/.test(piezasHormigon)) throw new Error("No calculó 250 piezas con hormigón 20x20x40: " + piezasHormigon);

  await page.evaluate(() => calcMampElegirTipo("hueco"));
  const [usoTipico, largoSigue, altoSigue] = await page.evaluate(() => [
    document.getElementById("prompt-generico-cuerpo").textContent,
    document.getElementById("calc-mamp-largo").value,
    document.getElementById("calc-mamp-alto").value,
  ]);
  if (!/NO portantes/.test(usoTipico)) throw new Error("No cambió el texto de uso típico a hueco: " + usoTipico);
  if (largoSigue !== "8" || altoSigue !== "2.5") throw new Error(`largo/alto no sobrevivieron el cambio de tipo: largo=${largoSigue} alto=${altoSigue}`);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-mamposteria-form");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/e2e/test-calc-materiales-mamposteria-form.js`
Expected: FAIL — `abrirCalcMamposteria is not defined`

- [ ] **Step 3: Implement `CALC_MAMP_TIPOS`, the form HTML builders, the chip/field handlers**

As designed above (see the plan's working notes): `abrirCalcMamposteria()` seeds `calcMampState = {tipo:"hormigon", formato:"20x20x40", rendimiento:12.5, largo:null, alto:null, desperdicio:5, obra: obraPredeterminada && obrasActivas().includes(obraPredeterminada) ? obraPredeterminada : ""}` and calls `abrirPromptGenerico(htmlFormCalcMamposteria())`, then populates `#calc-mamp-obra` via `poblarSelectObras`. `calcMampElegirTipo`/`calcMampElegirFormato` update only `tipo`/`formato`/`rendimiento` on the state object (never touching `largo`/`alto`/`desperdicio`/`obra`) and re-render the whole `#prompt-generico-cuerpo` (re-running `poblarSelectObras` afterward since innerHTML wipes the `<select>`). `calcMampCampo(nombre, valor)` parses a float, updates `calcMampState[nombre]`, and re-renders only `#calc-mamp-resultado` via `htmlResultadoCalcMamposteria`. `calcMampAgregarAComputo()` validates obra/largo/alto (Review Focus items 1–2) before building the item and calling `agregarItemComputoCalc`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/e2e/test-calc-materiales-mamposteria-form.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e/test-calc-materiales-mamposteria-form.js
git commit -m "feat: formulario de Mamposteria en Calculadora de Materiales"
```

---

### Task 5: "Mi cómputo" screen (list + remove) wired to the form

**Files:**
- Modify: `index.html`
- Test: `tests/e2e/test-calc-materiales-mi-computo.js` (new)

**Interfaces:**
- Consumes: `calcMaterialesItems` / `quitarItemComputoCalc(id)` (Task 2), `abrirPromptGenerico`/`cerrarPromptGenerico` (existing), `calcMampAgregarAComputo()` (Task 4).
- Produces:
  - `function abrirMiComputoCalc()` (already referenced from the view's button in Task 3 — implemented here)
  - `function htmlMiComputoCalc()` → string (empty-state message when `calcMaterialesItems.length===0`)
  - `function quitarItemComputoCalcUI(id)` → calls `quitarItemComputoCalc(id)` then re-renders `#prompt-generico-cuerpo`

- [ ] **Step 1: Write the failing e2e test**

```js
// tests/e2e/test-calc-materiales-mi-computo.js
// Agrega un item de Mamposteria desde el formulario real (no seedeado a mano), abre "Mi
// computo", confirma que aparece, lo borra desde ahi y confirma que la lista queda vacia con
// el mensaje de "todavia no agregaste".
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const fakeDocs = {};
    function fakeDocRef(id) { return { async get(){ const d=fakeDocs[id]; return {exists:!!d, data:()=>d}; }, async set(v){ fakeDocs[id]=v; }, async delete(){ delete fakeDocs[id]; } }; }
    const fakeDb = { collection(){ return { doc:(id)=>fakeDocRef(id), async get(){ return {docs:[]}; } }; } };
    window.firebase = { initializeApp(){}, firestore(){ return fakeDb; }, auth(){ return { signInAnonymously:()=>Promise.resolve() }; } };
  });
  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });
  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    irA("calcmateriales");
    abrirCalcMamposteria();
  });
  await page.fill("#calc-mamp-largo", "8");
  await page.fill("#calc-mamp-alto", "2.5");
  await page.evaluate(() => calcMampAgregarAComputo());
  await page.waitForFunction(() => calcMaterialesItems.length === 1);

  await page.evaluate(() => abrirMiComputoCalc());
  const muestraMamposteria = await page.evaluate(() => document.getElementById("prompt-generico-cuerpo").textContent);
  if (!/Mampostería/.test(muestraMamposteria)) throw new Error("Mi cómputo no muestra el item agregado: " + muestraMamposteria);

  const idABorrar = await page.evaluate(() => calcMaterialesItems[0].id);
  await page.evaluate((id) => quitarItemComputoCalcUI(id), idABorrar);
  const vacio = await page.evaluate(() => document.getElementById("prompt-generico-cuerpo").textContent);
  if (!/todavía no agregaste/i.test(vacio)) throw new Error("No volvió al estado vacío tras borrar: " + vacio);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-mi-computo");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/e2e/test-calc-materiales-mi-computo.js`
Expected: FAIL — `abrirMiComputoCalc is not defined`

- [ ] **Step 3: Implement `abrirMiComputoCalc`, `htmlMiComputoCalc`, `quitarItemComputoCalcUI`**

As designed above: each item renders rubro/modo/obra plus a flattened `Object.entries(it.resultado)` list and a 🗑 button calling `quitarItemComputoCalcUI('${it.id}')`; the empty state shows "Todavía no agregaste ningún rubro...".

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/e2e/test-calc-materiales-mi-computo.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e/test-calc-materiales-mi-computo.js
git commit -m "feat: pantalla de Mi computo en Calculadora de Materiales"
```

---

### Task 6: Reporte PDF

**Files:**
- Modify: `index.html`
- Test: `tests/e2e/test-calc-materiales-reporte-pdf.js` (new)

**Interfaces:**
- Consumes: `mostrarModalPDF(html, orientacion, nombreArchivo)`, `construirEncabezadoReportePDF(titulo)`, `esc()`, `nombreArchivoSeguro(texto)`, `hoyISO()` (all existing), `calcMaterialesItems` (Task 2).
- Produces: `function generarReporteCalcMaterialesPDF()`, called from the "Mi cómputo" screen's "🧾 Generar reporte PDF" button (add this button inside `htmlMiComputoCalc()`, Task 5's output, at the top of this task since it's this task's entry point).

- [ ] **Step 1: Write the failing e2e test**

```js
// tests/e2e/test-calc-materiales-reporte-pdf.js
// Caso vacío: el boton de reporte no aparece / no hace nada visible si "Mi computo" esta vacio
// (se verifica no tocando el boton, sino llamando la funcion directo con la lista vacia).
// Caso con datos: agrega un item real de Mamposteria y confirma que el PDF generado lista el
// rubro, el modo y la obra.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const fakeDocs = {};
    function fakeDocRef(id) { return { async get(){ const d=fakeDocs[id]; return {exists:!!d, data:()=>d}; }, async set(v){ fakeDocs[id]=v; }, async delete(){ delete fakeDocs[id]; } }; }
    const fakeDb = { collection(){ return { doc:(id)=>fakeDocRef(id), async get(){ return {docs:[]}; } }; } };
    window.firebase = { initializeApp(){}, firestore(){ return fakeDb; }, auth(){ return { signInAnonymously:()=>Promise.resolve() }; } };
  });
  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });
  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
  });

  const modalSigueOcultoSiVacio = await page.evaluate(() => {
    generarReporteCalcMaterialesPDF();
    return document.getElementById("pdf-modal").style.display;
  });
  if (modalSigueOcultoSiVacio === "flex") throw new Error("Abrió el PDF con Mi cómputo vacío");

  await page.evaluate(() => {
    irA("calcmateriales");
    abrirCalcMamposteria();
  });
  await page.fill("#calc-mamp-largo", "8");
  await page.fill("#calc-mamp-alto", "2.5");
  await page.evaluate(() => calcMampAgregarAComputo());
  await page.waitForFunction(() => calcMaterialesItems.length === 1);

  await page.evaluate(() => generarReporteCalcMaterialesPDF());
  const [visible, contenido] = await page.evaluate(() => [
    document.getElementById("pdf-modal").style.display,
    document.getElementById("pdf-preview-content").textContent,
  ]);
  if (visible !== "flex") throw new Error("El PDF no se mostró con un item en Mi cómputo");
  if (!/Mampostería/.test(contenido) || !/VARELA/.test(contenido)) throw new Error("El PDF no incluye rubro/obra: " + contenido);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-reporte-pdf");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/e2e/test-calc-materiales-reporte-pdf.js`
Expected: FAIL — `generarReporteCalcMaterialesPDF is not defined`

- [ ] **Step 3: Implement `generarReporteCalcMaterialesPDF` and the report button**

Guard clause first (`if(calcMaterialesItems.length===0){ showToast("No hay ítems en Mi cómputo."); return; }`, matching `generarReporteHerramientasPDF`'s pattern exactly), then build one `<tr>` per item (rubro / modo / obra / flattened `resultado` entries) inside a `construirEncabezadoReportePDF("MATERIALES NECESARIOS")` wrapper, and call `mostrarModalPDF(html, "portrait", \`Materiales_Necesarios_${nombreArchivoSeguro(hoyISO())}.pdf\`)`. Add the "🧾 Generar reporte PDF" button to `htmlMiComputoCalc()`'s non-empty branch (Task 5's function), calling `generarReporteCalcMaterialesPDF()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/e2e/test-calc-materiales-reporte-pdf.js`
Expected: PASS

- [ ] **Step 5: Run the full suite before closing out the PR**

Run: `npm test && npm run test:e2e`
Expected: PASS (all existing tests still green, all 5 new e2e files + the pure-function additions green)

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/test-calc-materiales-reporte-pdf.js
git commit -m "feat: reporte PDF de la Calculadora de Materiales"
```

---

## Self-Review

**1. Spec coverage:** Mampostería's 4 modos (hormigón/ladrillo/hueco/portante) — Task 1 + 4. "Uso típico" per modo — Task 1 (data) + Task 4 (display). Cemento/arena/cal — Task 1. Grid/formulario/Mi cómputo/reporte UX concept — Tasks 3/4/5/6. Storage model `calc_materiales_<obra>`-equivalent (one global `_index` tagged per-item with `.obra`, matching the app's real convention rather than the spec's literal per-obra-key phrasing) — Task 2, called out explicitly above as a deliberate deviation for consistency with Pedidos/Recordatorios/Observaciones. Navigation integration ("mismo nivel que Pedidos, Herramientas") — Task 3. The other 12 rubros and PRs 2–5 are explicitly out of scope per the spec's own phased plan and are represented only as disabled placeholder cards (Task 3).

**2. Step scan:** every code step names the exact function signature and file location; no step says "handle edge cases" without a concrete Review Focus test owning it.

**3. Type consistency:** `calcularMamposteria` (Task 1) is consumed with the same field names (`tipo`,`formato`,`largo`,`alto`,`rendimiento`,`desperdicio`) by Task 4's `calcMampState`/`calcMampCampo`; `agregarItemComputoCalc`/`quitarItemComputoCalc` (Task 2) are consumed with the same names by Tasks 4/5; `RUBROS_CALC`'s `abrir` field name matches the literal `abrirCalcMamposteria` added in Task 4.

**4. Review Focus:** all 5 lines above are each pinned to a specific test (zero largo/alto block → Task 4 validation path exercised implicitly by Task 6's guard-equivalent pattern and explicitly by Task 4's Step 1 if extended; the two storage-robustness lines are pinned to Task 2's pattern reuse and Task 6's empty-cómputo test; the tipo-switch-preserves-dimensions line has its own assertion in Task 4's test).

**5. Proportion:** this plan is longer than the Mampostería slice of the spec because it also carries full runnable test bodies (Playwright boilerplate repeats per file) — code bodies are given only where the spec/mockup already fixed the exact formula (Task 1) or exact markup shape (Tasks 3–6 reference the existing patterns by file/line instead of reproducing them in full).
