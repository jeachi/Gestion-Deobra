// Ronda 6 de auditoría (relanzada) -- Presupuesto General, 2 arreglos más:
// 1) El aviso del Dashboard "Mes N sin cargar todavía" solo miraba presupuestoItems[0], no el
//    estado real de TODOS los ítems -- quedaba pegado (falso positivo) si justo ese ítem ya estaba
//    al 100%, o desaparecía de más (falso negativo) si solo ESE ítem tenía una carga suelta.
// 2) El coeficiente de redeterminación caía en 1.000 en silencio si no se encontraba/parseaba la
//    celda "COEFICIENTE" del Excel, sin avisar que en realidad no se leyó ninguno.
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

  const resultado = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    dashboardObraFiltro = null;

    // ---- 1a) Falso POSITIVO: el ítem 0 ya está al 100% (no recibe más entradas), pero el resto de
    // los ítems SÍ se cargó para el mes actual -- el aviso no debería aparecer.
    presupuestoItems = [
      { id: "i1", nombre: "Item ya terminado", historialMeses: [{ n: 1, acumulado: 1, enElMes: 1, anterior: 0, monto: 100 }] },
      { id: "i2", nombre: "Item en curso", historialMeses: [{ n: 1, acumulado: 0.3, enElMes: 0.3, anterior: 0, monto: 30 }, { n: 2, acumulado: 0.6, enElMes: 0.3, anterior: 0.3, monto: 30 }] },
    ];
    let avisos = await agregarAvisosDeEstaSemana([]);
    const r1a_noQuedaAvisoFalsoPositivo = !avisos.some(a => a.view === "presupuesto");

    // ---- 1b) Falso NEGATIVO: solo el ítem 0 tiene una carga suelta del mes 2 (ej. corrección de
    // Inspección), el resto de los ítems sigue sin cargar ese mes -- el aviso SÍ debería aparecer.
    presupuestoItems = [
      { id: "i1", nombre: "Item con carga suelta", historialMeses: [{ n: 1, acumulado: 0.5, enElMes: 0.5, anterior: 0, monto: 50 }, { n: 2, acumulado: 0.6, enElMes: 0.1, anterior: 0.5, monto: 10 }] },
      { id: "i2", nombre: "Item sin cargar el mes 2", historialMeses: [{ n: 1, acumulado: 0.3, enElMes: 0.3, anterior: 0, monto: 30 }] },
    ];
    presupuestoMesActual = null; // "automático" -> usa el último mes cargado por CUALQUIER ítem (2)
    avisos = await agregarAvisosDeEstaSemana([]);
    const r1b_siApareceAvisoFaltanteReal = avisos.some(a => a.view === "presupuesto");

    // ---- 2) Aviso si no se encontró el coeficiente en el Excel ----
    const toasts = [];
    const showToastOriginal = window.showToast;
    window.showToast = (m) => toasts.push(m);
    const hojaNombre = "Computo y Presupuesto";
    const filas = [];
    for (let r = 0; r <= 8; r++) filas.push(new Array(12).fill(null));
    // A propósito, SIN ninguna celda que contenga el texto "COEFICIENTE" en ninguna fila/columna.
    filas[5][1] = "MES 1";
    filas[6][1] = 1; filas[6][3] = "Materiales"; // fila de rubro
    filas[7] = filas[7]; // placeholder fila intermedia (sin ítem)
    filas[8][1] = 1; filas[8][3] = "Item A"; filas[8][4] = "m2"; filas[8][5] = 10; filas[8][6] = 1000; filas[8][7] = 1000; filas[8][8] = 100000; filas[8][10] = 1;
    window.XLSX = {
      read: () => ({ SheetNames: [hojaNombre], Sheets: { [hojaNombre]: {} } }),
      utils: { sheet_to_json: () => filas, book_new: () => ({}), book_append_sheet: () => {} },
      write: () => "ZmFrZQ==",
    };
    const file = new File([new Uint8Array([0])], "presupuesto.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    presupuestoItems = [];
    await onExcelPresupuestoSeleccionado({ files: [file], value: "" });
    window.showToast = showToastOriginal;
    const r2_avisaSiNoEncuentraCoeficiente = toasts.some(t => t.includes("No encontré el coeficiente"));
    const r2_coeficienteQuedaEnUno = presupuestoCoeficiente.valor === 1;

    return { r1a_noQuedaAvisoFalsoPositivo, r1b_siApareceAvisoFaltanteReal, r2_avisaSiNoEncuentraCoeficiente, r2_coeficienteQuedaEnUno };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1a_noQuedaAvisoFalsoPositivo) fallas.push("BUG REPRODUCIDO: el aviso de Presupuesto no debería aparecer si TODOS los ítems ya están cargados para el mes actual, aunque el ítem 0 esté al 100%");
  if (!resultado.r1b_siApareceAvisoFaltanteReal) fallas.push("BUG REPRODUCIDO: el aviso de Presupuesto SÍ debería aparecer si la mayoría de los ítems no se cargó ese mes, aunque el ítem 0 tenga una carga suelta");
  if (!resultado.r2_avisaSiNoEncuentraCoeficiente) fallas.push("BUG REPRODUCIDO: debería avisarse si no se encontró la celda del coeficiente en el Excel");
  if (!resultado.r2_coeficienteQuedaEnUno) fallas.push("El coeficiente debería seguir cayendo en 1.000 cuando no se encuentra (solo que ahora avisando)");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PRESUPUESTO -- AVISO DASHBOARD/COEFICIENTE (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
