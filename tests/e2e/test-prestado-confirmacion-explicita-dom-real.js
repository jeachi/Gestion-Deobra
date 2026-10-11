// El usuario reportó, DESPUÉS de que el fix anterior (PR #86) ya estaba desplegado en producción,
// que "el trabajador al escribir o seleccionar se desaparece de los 2 formularios de día y de
// grilla" -- ya probaron varias veces. El mecanismo anterior (oninput con debounce + onchange al
// salir del campo, intentando ADIVINAR cuándo confirmar según coincidencia exacta) seguía fallando
// en el navegador real a pesar de que los tests anteriores (llamando las funciones JS directo,
// sin pasar por el DOM real) pasaban. Este test usa interacción REAL de Playwright (locator.fill,
// locator.press, locator.click sobre los elementos tal como están renderizados en la página, no
// invocando funciones JS a mano) para los DOS formularios, con el nuevo mecanismo de confirmación
// explícita (botón ✓ / Enter) que reemplazó toda la adivinanza de eventos.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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

  await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraA";
    obras = ["ObraA", "ObraB"];
    obrasFinalizadas = [];
    categorias = ["Oficial"];
    errorCargaTrabajadores = false;
    filasExtra = 0;
    mesActual = "2026-03";
    quincenaActual = 1;
    asistenciaCache = { "2026-03": {} };
    trabajadores = [
      { id: "t1", nombre: "Marco Ruiz", categoria: "Oficial", obra: "ObraB", estado: "Activo", fechaBaja: "", obs: "" },
    ];
    document.getElementById("app-principal").style.display = "";
    document.getElementById("view-asistencia").classList.add("active");
    const loginOverlay = document.getElementById("pantalla-login");
    if(loginOverlay) loginOverlay.style.display = "none";
    const arranque = document.getElementById("pantalla-arranque");
    if(arranque) arranque.style.display = "none";
    document.getElementById("asis-filtro-obra").innerHTML = `<option value="">Todas las obras</option><option value="ObraA">ObraA</option><option value="ObraB">ObraB</option>`;
    document.getElementById("asis-filtro-obra").value = "ObraA";
    document.getElementById("sel-dia").value = "2026-03-10";
    cambiarVista("dia");
    renderVistaDia();
  });
  await page.waitForTimeout(200);

  // ---- Vista Día: escribir un nombre NUEVO letra por letra con el teclado real, y confirmar con
  // Enter (no tocar nada más). El input es el único de la lista de la Carga por día en este punto
  // (todavía no hay ninguna fila extra -- "Agregar trabajador prestado" la crea). ----
  await page.evaluate(() => agregarFilaAsistencia());
  await page.waitForTimeout(100);
  const inputDia = page.locator("#lista-dia input[type='text']").first();
  await inputDia.click();
  await inputDia.type("Lucas Nuevo", { delay: 70 }); // tecleo real, letra por letra, con pausas reales
  const vieneEscribiendoTodavia = await page.evaluate(() => trabajadores.some(t => t.nombre === "Lucas Nuevo"));
  await inputDia.press("Enter");
  await page.waitForTimeout(150);
  const r1_noSeCreoMientrasSeTipeaba = !vieneEscribiendoTodavia;
  const r2_seCreoAlConfirmarConEnterEnVistaDia = await page.evaluate(() => trabajadores.some(t => t.nombre === "Lucas Nuevo"));
  const htmlDiaTrasConfirmar = await page.locator("#lista-dia").innerHTML();
  const r3_elNombreSigueVisibleEnLaFilaTrasConfirmar = htmlDiaTrasConfirmar.includes("Lucas Nuevo");

  // ---- Vista Día: ahora un trabajador YA EXISTENTE, elegido tocando la sugerencia del datalist
  // (simulado con fill, que dispara "input" real) y confirmando con el botón ✓ (no Enter esta
  // vez, para cubrir las dos formas de confirmar). ----
  await page.evaluate(() => agregarFilaAsistencia());
  await page.waitForTimeout(100);
  const filaNuevaLocator = page.locator("#lista-dia .dia-fila-v2").last();
  const inputFilaNueva = filaNuevaLocator.locator("input[type='text']");
  await inputFilaNueva.fill("Marco Ruiz"); // como si se eligiera la sugerencia del datalist
  await filaNuevaLocator.locator("button[title='Confirmar trabajador prestado']").click();
  await page.waitForTimeout(150);
  const r4_seAsignoAlExistenteConElBotonEnVistaDia = await page.evaluate(() => Object.keys(asistenciaCache["2026-03"]).includes("t1"));

  // ---- Grilla completa: mismo caso de nombre nuevo, tecleado letra por letra, confirmado con el
  // botón ✓ (no Enter, para cubrir la otra forma también acá). ----
  await page.evaluate(async () => { cambiarVista("grilla"); await renderAsistencia(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => agregarFilaAsistencia());
  await page.waitForTimeout(150);
  const filaGrid = page.locator("#tabla-asistencia tbody tr, #tabla-asistencia tr").filter({ has: page.locator("input[list='lista-grid-nombres-trabajadores']") }).last();
  const inputGrid = filaGrid.locator("input[list='lista-grid-nombres-trabajadores']");
  await inputGrid.click();
  await inputGrid.type("Pedro Loa", { delay: 70 });
  await filaGrid.locator("button[title='Confirmar trabajador prestado']").click();
  await page.waitForTimeout(150);
  const r5_seCreoAlConfirmarEnLaGrilla = await page.evaluate(() => trabajadores.some(t => t.nombre === "Pedro Loa"));
  const htmlGridTrasConfirmar = await page.locator("#tabla-asistencia").innerHTML();
  const r6_elNombreSigueVisibleEnLaGrillaTrasConfirmar = htmlGridTrasConfirmar.includes("Pedro Loa");
  const nuevoGrid = await page.evaluate(() => trabajadores.find(t => t.nombre === "Pedro Loa"));
  const r7_laFilaSigueApareciendoBajoElFiltroEnLaGrilla = await page.evaluate((id) => filasParaMes("2026-03").some(f => f.id === id), nuevoGrid ? nuevoGrid.id : null);

  console.log("Resultado:", JSON.stringify({
    r1_noSeCreoMientrasSeTipeaba, r2_seCreoAlConfirmarConEnterEnVistaDia, r3_elNombreSigueVisibleEnLaFilaTrasConfirmar,
    r4_seAsignoAlExistenteConElBotonEnVistaDia,
    r5_seCreoAlConfirmarEnLaGrilla, r6_elNombreSigueVisibleEnLaGrillaTrasConfirmar, r7_laFilaSigueApareciendoBajoElFiltroEnLaGrilla,
  }, null, 2));

  const fallas = [];
  if (!r1_noSeCreoMientrasSeTipeaba) fallas.push("No debería crear a nadie mientras se sigue tipeando (antes de confirmar)");
  if (!r2_seCreoAlConfirmarConEnterEnVistaDia) fallas.push("BUG: en la Carga por día, tipear un nombre nuevo y confirmar con Enter (interacción real de teclado) no crea al trabajador");
  if (!r3_elNombreSigueVisibleEnLaFilaTrasConfirmar) fallas.push("BUG REPRODUCIDO: el nombre 'desaparece' de la Carga por día después de confirmar");
  if (!r4_seAsignoAlExistenteConElBotonEnVistaDia) fallas.push("BUG: en la Carga por día, elegir un nombre existente y confirmar con el botón ✓ no asigna al trabajador");
  if (!r5_seCreoAlConfirmarEnLaGrilla) fallas.push("BUG: en la Grilla completa, tipear un nombre nuevo (interacción real de teclado) y confirmar con el botón ✓ no crea al trabajador");
  if (!r6_elNombreSigueVisibleEnLaGrillaTrasConfirmar) fallas.push("BUG REPRODUCIDO: el nombre 'desaparece' de la Grilla completa después de confirmar");
  if (!r7_laFilaSigueApareciendoBajoElFiltroEnLaGrilla) fallas.push("BUG: la fila del trabajador nuevo no sigue apareciendo bajo el filtro de obra activo en la Grilla");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CONFIRMACIÓN EXPLÍCITA (DOM REAL) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
