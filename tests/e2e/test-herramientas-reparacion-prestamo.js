// Tres bugs reales encontrados en auditoría, en el módulo Herramientas:
// 1) Una herramienta enviada a "reparación" quedaba atascada ahí para siempre -- no existía ningún
//    botón/función para volver a marcarla en servicio.
// 2) El modal de préstamo precargaba la "Fecha de recepción" del ÚLTIMO préstamo ya cerrado incluso
//    al iniciar un préstamo NUEVO (herramienta actualmente "bien"), pudiendo hacer que se guarde
//    como ya devuelta sin querer.
// 3) Registrar la devolución de un préstamo podía "revivir" una herramienta que mientras tanto se
//    había mandado a reparar, pisando su estado "reparacion" con "bien" sin que en realidad haya
//    vuelto del taller.
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
    errorCargaHerramientas = false;
    document.getElementById("herr-filtro-obra").innerHTML = `<option value="">Todas las obras</option>`;
  });

  // ---- 1) Volver una herramienta de "reparación" a servicio ----
  const r1b = await page.evaluate(async () => {
    herramientas = [
      { id: "h1", nombre: "Taladro", obra: "ObraTest", cantidad: 1, condicionInicial: "usada", fechaCompra: "2025-01-01", estado: "bien" },
    ];
    irA("herramientas");
    renderInventarioHerramientas();
    const h = herramientas.find(x => x.id === "h1");
    // Simulamos "Enviar a reparar" llenando el modal a mano (como haría abrirModalReparacion).
    document.getElementById("herr-modal-panel").innerHTML = `<input type="date" id="modal-rep-fecha" value="2026-01-10"><input type="text" id="modal-rep-motivo" value="Se rompió el mandril">`;
    await guardarReparacionHerramienta("h1");
    renderInventarioHerramientas();
    const htmlEnReparacion = document.getElementById("lista-herramientas").innerHTML;
    const tieneBotonVolver = htmlEnReparacion.includes("finalizarReparacionHerramienta('h1')");
    const yaNoTieneEnviarAReparar = !htmlEnReparacion.includes("abrirModalReparacion('h1')");

    await finalizarReparacionHerramienta("h1");
    const estadoFinal = h.estado;
    const reparacionLimpia = h.reparacion === null || h.reparacion === undefined;
    const quedoEnHistorial = h.historialReparaciones && h.historialReparaciones.length === 1 && h.historialReparaciones[0].motivo === "Se rompió el mandril";

    return { tieneBotonVolver, yaNoTieneEnviarAReparar, estadoFinal, reparacionLimpia, quedoEnHistorial };
  });
  console.log("1) Volver de reparación:", JSON.stringify(r1b));
  if (!r1b.tieneBotonVolver) throw new Error("1) BUG REPRODUCIDO: no aparece ningún botón para volver de reparación");
  if (!r1b.yaNoTieneEnviarAReparar) throw new Error("1) Mientras está en reparación no debería seguir ofreciendo 'Enviar a reparar' de nuevo");
  if (r1b.estadoFinal !== "bien") throw new Error(`1) BUG REPRODUCIDO: tras "volver de reparación" el estado debería ser "bien", quedó "${r1b.estadoFinal}"`);
  if (!r1b.reparacionLimpia) throw new Error("1) El objeto 'reparacion' debería quedar limpio tras volver a servicio");
  if (!r1b.quedoEnHistorial) throw new Error("1) La reparación debería quedar archivada en historialReparaciones");

  // ---- 2) El modal de préstamo no debe precargar la fecha de recepción de un préstamo viejo ----
  const r2 = await page.evaluate(() => {
    herramientas.push({
      id: "h2", nombre: "Amoladora", obra: "ObraTest", cantidad: 1, condicionInicial: "nueva", fechaCompra: "2025-01-01",
      estado: "bien", // disponible -- un préstamo nuevo, no el que sigue en curso
      prestamo: { tipo: "obra", obraDestino: "ObraVieja", fechaEnvio: "2025-06-01", fechaEntrega: "2025-06-10", fechaRecepcion: "2025-06-09" },
    });
    abrirModalPrestamo("h2");
    return { fechaRecepcionPrecargada: document.getElementById("modal-prest-recepcion").value };
  });
  console.log("2) Préstamo nuevo no arrastra la fecha de recepción del préstamo anterior:", JSON.stringify(r2));
  if (r2.fechaRecepcionPrecargada !== "") throw new Error(`2) BUG REPRODUCIDO: la fecha de recepción debería estar vacía para un préstamo nuevo, precargó "${r2.fechaRecepcionPrecargada}"`);

  // ---- 3) Registrar la devolución de un préstamo no debe revivir una herramienta en reparación ----
  const r3 = await page.evaluate(async () => {
    herramientas.push({
      id: "h3", nombre: "Sierra", obra: "ObraTest", cantidad: 1, condicionInicial: "usada", fechaCompra: "2025-01-01",
      estado: "reparacion", // se mandó a reparar MIENTRAS estaba prestada
      reparacion: { fechaEnvio: "2026-02-01", motivo: "Se rompió estando afuera" },
      prestamo: { tipo: "persona", persona: "Carlos", fechaEnvio: "2026-01-01", fechaEntrega: "2026-01-20", fechaRecepcion: "" },
    });
    document.getElementById("herr-modal-panel").innerHTML = `
      <div class="chip-row" id="modal-prest-tipo-row"><div class="chip-opt sel" data-val="persona">persona</div></div>
      <input type="text" id="modal-prest-persona" value="Carlos">
      <input type="date" id="modal-prest-envio" value="2026-01-01">
      <input type="date" id="modal-prest-entrega" value="2026-01-20">
      <input type="date" id="modal-prest-recepcion" value="2026-02-05">
    `;
    await guardarPrestamoHerramienta("h3");
    const h = herramientas.find(x => x.id === "h3");
    return { estado: h.estado, quedoEnHistorialPrestamos: h.historialPrestamos && h.historialPrestamos.length === 1 };
  });
  console.log("3) Registrar devolución de préstamo no revive una herramienta en reparación:", JSON.stringify(r3));
  if (r3.estado !== "reparacion") throw new Error(`3) BUG REPRODUCIDO: la herramienta debería seguir "en reparación", quedó "${r3.estado}"`);
  if (!r3.quedoEnHistorialPrestamos) throw new Error("3) El préstamo debería igual quedar archivado en el historial de préstamos");

  console.log("Errores de página:", JSON.stringify(errs));
  if (errs.length) throw new Error("Hubo errores de página durante las pruebas");

  console.log("\nTODOS LOS CHEQUEOS DE HERRAMIENTAS (REPARACIÓN Y PRÉSTAMO) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
