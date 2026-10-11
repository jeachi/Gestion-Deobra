// Bug real encontrado en auditoría: guardarRegistroClima() siempre agregaba un registro NUEVO, sin
// chequear si ya existía uno para la misma obra+fecha. Dos registros contradictorios para el mismo
// día (ej: "Soleado, se trabajó" y después "Lluvia, no se trabajó" sin borrar el primero) hacían que
// climaNoLaborable() -- la usa Asistencia para el descuento automático de días no laborables --
// dependiera del orden del array en vez de cuál es el dato real. Tampoco había forma de "editar" un
// día ya cargado, solo borrar y recargar.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    irA("clima");
  });

  // ---- 1) Cargar el clima del mismo día dos veces ACTUALIZA, no duplica ----
  const r1 = await page.evaluate(async () => {
    climaRegistros = [];
    document.getElementById("clima-obra").innerHTML = `<option value="ObraTest">ObraTest</option>`;
    document.getElementById("clima-obra").value = "ObraTest";
    document.getElementById("clima-fecha").value = "2026-06-15";
    document.getElementById("clima-observaciones").value = "";

    // Primera carga: soleado, se trabajó normal.
    seleccionarCondicionClima("Soleado");
    seleccionarTrabajoClima("si");
    await guardarRegistroClima();
    const cantidadTrasPrimera = climaRegistros.length;
    const noLaborableTrasPrimera = climaNoLaborable("2026-06-15", "ObraTest");

    // Más tarde ese mismo día: en realidad llovió a la tarde y se paró la obra -- se vuelve a
    // cargar el MISMO día, sin borrar el registro anterior primero.
    document.getElementById("clima-obra").value = "ObraTest";
    document.getElementById("clima-fecha").value = "2026-06-15";
    seleccionarCondicionClima("Lluvia");
    seleccionarTrabajoClima("no");
    await guardarRegistroClima();

    return {
      cantidadTrasPrimera,
      cantidadTrasSegunda: climaRegistros.length,
      condicionFinal: climaRegistros[0].condicion,
      seTrabajoFinal: climaRegistros[0].seTrabajo,
      noLaborableTrasPrimera,
      noLaborableFinal: climaNoLaborable("2026-06-15", "ObraTest"),
    };
  });
  console.log("1) Cargar el mismo día dos veces actualiza en vez de duplicar:", JSON.stringify(r1));
  if (r1.cantidadTrasPrimera !== 1) throw new Error(`1) Tras la primera carga debería haber 1 registro, hay ${r1.cantidadTrasPrimera}`);
  if (r1.cantidadTrasSegunda !== 1) throw new Error(`1) BUG REPRODUCIDO: tras recargar el MISMO día, debería seguir habiendo 1 solo registro (no duplicarse), hay ${r1.cantidadTrasSegunda}`);
  if (r1.condicionFinal !== "Lluvia") throw new Error(`1) El registro debería reflejar la corrección (Lluvia), quedó "${r1.condicionFinal}"`);
  if (r1.seTrabajoFinal !== "no") throw new Error(`1) El registro debería reflejar "no se trabajó" tras la corrección, quedó "${r1.seTrabajoFinal}"`);
  if (r1.noLaborableTrasPrimera) throw new Error("1) Con el primer registro (soleado, se trabajó), el día NO debería contar como no laborable");
  if (!r1.noLaborableFinal) throw new Error("1) BUG REPRODUCIDO: tras la corrección (lluvia, no se trabajó), el día debería contar como no laborable -- climaNoLaborable() no puede depender de cuál quedó primero en el array");

  // ---- 2) Un día distinto sigue agregando un registro nuevo, sin pisar el anterior ----
  const r2 = await page.evaluate(async () => {
    document.getElementById("clima-fecha").value = "2026-06-16";
    seleccionarCondicionClima("Nublado");
    seleccionarTrabajoClima("si");
    await guardarRegistroClima();
    return { cantidadTotal: climaRegistros.length };
  });
  console.log("2) Un día distinto sigue agregando un registro nuevo:", JSON.stringify(r2));
  if (r2.cantidadTotal !== 2) throw new Error(`2) Debería haber 2 registros (dos días distintos), hay ${r2.cantidadTotal}`);

  console.log("Errores de página:", JSON.stringify(errs));
  if (errs.length) throw new Error("Hubo errores de página durante las pruebas");

  console.log("\nTODOS LOS CHEQUEOS DE CLIMA (SIN DUPLICADOS POR DÍA) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
