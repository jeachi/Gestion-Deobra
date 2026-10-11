// Pedido del usuario: un recordatorio DENTRO de la app (sin servidor), que aparezca cada 2 días,
// mostrando solo las actividades del presupuesto que siguen en ejecución este mes (no las que ya
// llegaron al 100%), con el % planificado de referencia y un campo para cargar el % REAL
// ejecutado -- ese valor pasa por fijarAcumuladoMesPresupuesto(), la misma función que alimenta la
// Curva de avance real.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());

  await page.addInitScript(() => {
    // Firestore falso pero CON estado real (a diferencia del mock trivial de otros tests) -- este
    // test necesita que guardarPresupuestoObra() (set) y cargarPresupuestoObra() (get, que
    // revisarRecordatorioAvancePresupuesto llama siempre porque el presupuesto es perezoso) vean
    // los mismos datos, igual que en la app de verdad.
    const fakeDocs = {};
    function fakeDocRef(id) {
      return {
        async get() { const d = fakeDocs[id]; return { exists: !!d, data: () => d }; },
        async set(v) { fakeDocs[id] = v; },
        async delete() { delete fakeDocs[id]; },
      };
    }
    const fakeDb = { collection() { return { doc: (id) => fakeDocRef(id), async get() { return { docs: Object.keys(fakeDocs).map((id) => ({ id, data: () => fakeDocs[id] })) }; } }; } };
    window.firebase = { initializeApp() {}, firestore() { return fakeDb; }, auth() { return { signInAnonymously: () => Promise.resolve() }; } };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  // ---- 1) Con algo pendiente y sin recordatorio previo, se abre mostrando SOLO lo no terminado ----
  const r1 = await page.evaluate(async () => {
    obraPredeterminada = "ObraRecordatorio";
    obras = ["ObraRecordatorio"];
    presupuestoItems = [
      { rubro: 1, rubroNombre: "R1", nombre: "Item sin terminar", unidad: "m2", cantidad: 10, precioConCoef: 1000, pctIncidencia: 50,
        historialMeses: [{ n: 1, anterior: 0, enElMes: 0.3, acumulado: 0.3, monto: 300 }, { n: 2, anterior: 0.3, enElMes: 0.2, acumulado: 0.5, monto: 200, planificado: 0.5 }] },
      { rubro: 1, rubroNombre: "R1", nombre: "Item ya terminado", unidad: "m2", cantidad: 5, precioConCoef: 500, pctIncidencia: 50,
        historialMeses: [{ n: 1, anterior: 0, enElMes: 1, acumulado: 1, monto: 500 }] },
    ];
    presupuestoMesActual = null; // automático -- el máximo mes cargado (2)
    await guardarPresupuestoObra(); // persiste en el Firestore falso...
    presupuestoItems = []; // ...y se vacía la memoria: el presupuesto es perezoso, revisarRecordatorioAvancePresupuesto
                            // tiene que poder encontrarlo solo (cargarPresupuestoObra), igual que en la app real.
    localStorage.removeItem("gdo_recordatorio_presupuesto_ObraRecordatorio");
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    await revisarRecordatorioAvancePresupuesto();
    const overlay = document.getElementById("prompt-generico-overlay");
    const abierto = overlay && overlay.style.display === "flex";
    const cuerpo = document.getElementById("prompt-generico-cuerpo").innerHTML;
    const inputs = [...document.querySelectorAll(".pg-input-recordatorio")];
    return {
      abierto,
      cantidadInputs: inputs.length,
      mencionaSinTerminar: cuerpo.includes("Item sin terminar"),
      mencionaTerminado: cuerpo.includes("Item ya terminado"),
      mencionaPlan: cuerpo.includes("50.00%"),
      valorPrecargado: inputs[0] ? inputs[0].value : null,
    };
  });

  // ---- 2) Guardar desde el recordatorio actualiza el % REAL (fijarAcumuladoMesPresupuesto) y persiste ----
  const r2 = await page.evaluate(async () => {
    const input = document.querySelector(".pg-input-recordatorio");
    input.value = "65";
    await guardarRecordatorioAvancePresupuesto(2);
    const overlayCerrado = document.getElementById("prompt-generico-overlay").style.display === "none";
    const it = presupuestoItems.find(x => x.nombre === "Item sin terminar");
    const entrada2 = it.historialMeses.find(m => m.n === 2);
    return {
      overlayCerrado,
      acumulado: entrada2.acumulado,
      planificadoSigueIgual: entrada2.planificado, // no debe tocarse por guardar el REAL
    };
  });

  // ---- 3) Repetir la revisión enseguida (mismo día) NO vuelve a abrir -- ya se mostró hace poco ----
  const r3 = await page.evaluate(async () => {
    document.getElementById("prompt-generico-overlay").style.display = "none";
    await revisarRecordatorioAvancePresupuesto();
    return document.getElementById("prompt-generico-overlay").style.display;
  });

  // ---- 4) Si ya pasaron 2+ días desde el último aviso, vuelve a abrirse ----
  const r4 = await page.evaluate(async () => {
    const clave = "gdo_recordatorio_presupuesto_ObraRecordatorio";
    localStorage.setItem(clave, String(Date.now() - 3 * 24 * 60 * 60 * 1000));
    document.getElementById("prompt-generico-overlay").style.display = "none";
    await revisarRecordatorioAvancePresupuesto();
    return document.getElementById("prompt-generico-overlay").style.display;
  });

  // ---- 5) Si TODO ya está al 100% este mes, no hay nada que recordar ----
  const r5 = await page.evaluate(async () => {
    const clave = "gdo_recordatorio_presupuesto_ObraRecordatorio";
    localStorage.removeItem(clave);
    presupuestoItems.forEach(it => { it.historialMeses.forEach(m => { m.acumulado = 1; }); });
    await guardarPresupuestoObra();
    presupuestoItems = [];
    document.getElementById("prompt-generico-overlay").style.display = "none";
    await revisarRecordatorioAvancePresupuesto();
    return document.getElementById("prompt-generico-overlay").style.display;
  });

  // ---- 6) Un capataz SIN permiso de presupuesto no ve el recordatorio ----
  const r6 = await page.evaluate(async () => {
    const clave = "gdo_recordatorio_presupuesto_ObraRecordatorio";
    localStorage.removeItem(clave);
    presupuestoItems.forEach(it => { it.historialMeses.forEach(m => { m.acumulado = 0.3; }); });
    await guardarPresupuestoObra();
    presupuestoItems = [];
    sesionActual = { username: "capataz1", role: "capataz", permisos: { presupuesto: false } };
    document.getElementById("prompt-generico-overlay").style.display = "none";
    await revisarRecordatorioAvancePresupuesto();
    return document.getElementById("prompt-generico-overlay").style.display;
  });

  console.log("Resultado:", JSON.stringify({ r1, r2, r3, r4, r5, r6 }, null, 2));

  const fallas = [];
  if (!r1.abierto) fallas.push("BUG: con algo pendiente y sin aviso previo, el recordatorio no se abrió");
  if (r1.cantidadInputs !== 1) fallas.push(`BUG: debería mostrar un solo ítem (el no terminado), mostró ${r1.cantidadInputs}`);
  if (!r1.mencionaSinTerminar) fallas.push("BUG: no muestra el ítem que sigue en ejecución");
  if (r1.mencionaTerminado) fallas.push("BUG: muestra un ítem que ya llegó al 100% (no debería)");
  if (!r1.mencionaPlan) fallas.push("BUG: no muestra el % planificado de referencia para este mes");
  if (r1.valorPrecargado !== "50.00") fallas.push(`BUG: el campo debería precargarse con el acumulado actual (50.00), dio ${r1.valorPrecargado}`);

  if (!r2.overlayCerrado) fallas.push("BUG: guardar desde el recordatorio no cierra el modal");
  if (Math.abs(r2.acumulado - 0.65) > 0.001) fallas.push(`BUG: el % real cargado no se guardó en historialMeses, dio ${r2.acumulado}`);
  if (Math.abs(r2.planificadoSigueIgual - 0.5) > 0.001) fallas.push("BUG REAL: cargar el REAL desde el recordatorio tocó el plan ya congelado");
  if (r3 !== "none") fallas.push("BUG: revisar de nuevo el mismo día vuelve a abrir el recordatorio (debería esperar el intervalo)");
  if (r4 !== "flex") fallas.push("BUG: pasados los 2 días, el recordatorio debería volver a abrirse");
  if (r5 !== "none") fallas.push("BUG: con todo al 100% este mes, el recordatorio no debería abrirse");
  if (r6 !== "none") fallas.push("BUG REAL: un capataz sin permiso de presupuesto vio el recordatorio");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL RECORDATORIO DE AVANCE OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
