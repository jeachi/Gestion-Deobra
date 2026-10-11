// Ronda 6 de auditoría (relanzada) -- Presupuesto General, 3 arreglos más:
// 1) Importar un Excel con el cronograma completo del contrato (con columnas de meses futuros
//    todavía en 0) inflaba maxMesCargado()/mesActualPresupuesto() al último mes de la plantilla.
// 2) "Agregar un mes nuevo" no clampeaba "enElMes" al % que realmente faltaba -- el monto
//    certificado podía superar lo que le quedaba al ítem.
// 3) "Eliminar presupuesto y volver a importar" no borraba la config (monto del contrato, mes
//    actual) ni la copia del Excel original -- una reimportación arrastraba datos del borrado.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
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

  const resultado = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];

    // ---- 1) Excel real con 3 columnas de mes en la plantilla, pero datos reales solo en el Mes 1
    // (como haría un Excel de "Cómputo y Presupuesto" de obra pública con el cronograma completo
    // del contrato precargado y los meses futuros todavía en blanco) ----
    const filaMeses = 5; // fila donde están los encabezados "MES 1"/"MES 2"/"MES 3"
    const filaItem = filaMeses + 3; // mismo offset que usa onExcelPresupuestoSeleccionado
    const filas = [];
    for (let r = 0; r <= filaItem; r++) filas.push(new Array(23).fill(null));
    filas[filaMeses][11] = "MES 1"; filas[filaMeses][15] = "MES 2"; filas[filaMeses][19] = "MES 3";
    const filaRubro = filas[filaMeses + 1];
    filaRubro[1] = 1; filaRubro[3] = "Materiales"; // fila de RUBRO (col E vacía -> no es ítem)
    const it = filas[filaItem];
    it[1] = 1; it[3] = "Item A"; it[4] = "m2"; // nombre/unidad (col E con valor -> SÍ es ítem)
    it[5] = 10; it[6] = 1000; it[7] = 1000; it[8] = 100000; it[10] = 1;
    it[11] = 0; it[12] = 0.3; it[13] = 0.3; it[14] = 30000; // Mes 1: datos reales
    it[15] = 0; it[16] = 0; it[17] = 0; it[18] = 0; // Mes 2: columnas en blanco (sin cargar todavía)
    it[19] = 0; it[20] = 0; it[21] = 0; it[22] = 0; // Mes 3: ídem

    // La librería XLSX real se carga desde un CDN externo -- no hace falta acá, y así el test
    // tampoco depende de red: se stubea con lo mínimo que usa onExcelPresupuestoSeleccionado, para
    // ejercitar el parseo/filtrado de verdad (la función de producción, sin reimplementarla).
    const hojaNombre = "Computo y Presupuesto"; // sin tilde a propósito: la regex de detección busca "comp...presup" literal
    const XLSXOriginal = window.XLSX;
    window.XLSX = {
      read: () => ({ SheetNames: [hojaNombre], Sheets: { [hojaNombre]: {} } }),
      utils: {
        sheet_to_json: () => filas,
        book_new: () => ({}),
        book_append_sheet: () => {},
      },
      write: () => "ZmFrZQ==",
    };
    const file = new File([new Uint8Array([0])], "presupuesto.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    presupuestoItems = [];
    await onExcelPresupuestoSeleccionado({ files: [file], value: "" });
    window.XLSX = XLSXOriginal;
    // onExcelPresupuestoSeleccionado() dispara prepararVistaPresupuesto() al final SIN awaitarlo --
    // si no se espera a que termine (recarga presupuestoItems desde el storage mockeado), esa
    // promesa pendiente puede resolverse en medio de la sección 2 de este mismo test y pisarla.
    await new Promise(r => setTimeout(r, 50));

    const r1_importoElItem = presupuestoItems.length === 1;
    const r1_soloUnMesConDatos = r1_importoElItem && presupuestoItems[0].historialMeses.length === 1;
    const r1_maxMesCargadoEsUno = maxMesCargado() === 1;

    // ---- 2) confirmarNuevoMesPresupuesto clampea "enElMes" al % real que falta ----
    presupuestoItems = [{
      id: "i2", nombre: "Item2", rubro: "1", rubroNombre: "Materiales", precioConCoef: 100000,
      historialMeses: [{ n: 1, anterior: 0, enElMes: 0.9, acumulado: 0.9, monto: 90000 }],
    }];
    abrirNuevoMesPresupuesto(); // crea el modal real (abrirPromptGenerico + renderFormNuevoMes)
    document.querySelector('.pg-input-mes[data-idx="0"]').value = "50";
    await confirmarNuevoMesPresupuesto(2);
    const mes2 = presupuestoItems[0].historialMeses.find(m => m.n === 2);
    const r2_acumuladoClampeado = Math.abs(mes2.acumulado - 1) < 1e-9;
    const r2_enElMesClampeado = Math.abs(mes2.enElMes - 0.1) < 1e-9; // solo quedaba 10% por certificar, no 50%
    const r2_montoClampeado = Math.abs(mes2.monto - 10000) < 1; // 10% de 100000, no 50%

    // ---- 3) eliminarPresupuestoObra borra también config y Excel original ----
    presupuestoItems = [{ id: "i3", nombre: "Item3", rubro: "1", rubroNombre: "Materiales", precioConCoef: 50000, historialMeses: [] }];
    presupuestoMontoContrato = 999999;
    presupuestoMesActual = 5;
    presupuestoMesesColsExcel = [0, 4, 8];
    presupuestoExcelOriginalBase64 = "ZmFrZS1iYXNlNjQ=";
    presupuestoExcelOriginalHoja = "Hoja1";
    await guardarPresupuestoObra();
    await eliminarPresupuestoObra();
    // Releemos de Firestore (como haría un ingreso nuevo a la obra) para confirmar que de verdad
    // se borró, no solo que se reseteó la variable en memoria.
    presupuestoMontoContrato = -1; presupuestoMesActual = -1; presupuestoMesesColsExcel = ["sucio"];
    presupuestoExcelOriginalBase64 = "sucio"; presupuestoExcelOriginalHoja = "sucio";
    await cargarPresupuestoObra();
    const r3_montoContratoBorrado = presupuestoMontoContrato === 0;
    const r3_mesActualBorrado = presupuestoMesActual === null;
    const r3_excelOriginalBorrado = presupuestoExcelOriginalBase64 === null && presupuestoExcelOriginalHoja === null;

    return {
      r1_importoElItem, r1_soloUnMesConDatos, r1_maxMesCargadoEsUno,
      r2_acumuladoClampeado, r2_enElMesClampeado, r2_montoClampeado,
      r3_montoContratoBorrado, r3_mesActualBorrado, r3_excelOriginalBorrado,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_importoElItem) fallas.push("No se importó el ítem de prueba -- revisar el layout del Excel sintético del test");
  if (!resultado.r1_soloUnMesConDatos) fallas.push("BUG REPRODUCIDO: no deberían crearse entradas de historialMeses para columnas de mes totalmente en blanco del Excel");
  if (!resultado.r1_maxMesCargadoEsUno) fallas.push("BUG REPRODUCIDO: maxMesCargado() debería dar 1 (el único mes con datos reales), no 3 (el último de la plantilla)");
  if (!resultado.r2_acumuladoClampeado) fallas.push("El acumulado debería clampearse a 100%");
  if (!resultado.r2_enElMesClampeado) fallas.push("BUG REPRODUCIDO: 'enElMes' debería clampearse a lo que realmente faltaba (10%), no al valor tipeado (50%)");
  if (!resultado.r2_montoClampeado) fallas.push("BUG REPRODUCIDO: el monto certificado ese mes debería ser proporcional al % real clampeado, no al % tipeado de más");
  if (!resultado.r3_montoContratoBorrado) fallas.push("BUG REPRODUCIDO: eliminarPresupuestoObra() debería borrar también el monto del contrato guardado");
  if (!resultado.r3_mesActualBorrado) fallas.push("BUG REPRODUCIDO: eliminarPresupuestoObra() debería borrar también el 'mes actual' elegido");
  if (!resultado.r3_excelOriginalBorrado) fallas.push("BUG REPRODUCIDO: eliminarPresupuestoObra() debería borrar también la copia del Excel original");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PRESUPUESTO -- EXCEL/MES NUEVO/ELIMINAR (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
