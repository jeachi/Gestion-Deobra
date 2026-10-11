// Ronda 2 de auditoría -- Plano de avance (2 arreglos) y Asistencia (3 arreglos).
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

    // ==================== PLANO DE AVANCE ====================
    // ---- 1) pintarLineaDeTiempo agrupa por capaId (no por nombreCompleto) para el delta +/- ----
    // pintarLineaDeTiempo() da por hecho que abrirLineaDeTiempoPlano() ya armó este HTML adentro
    // del modal -- se arma a mano acá para no tener que simular todo el flujo (imagen del plano,
    // generación de miniaturas, etc.) que no hace falta para este chequeo puntual.
    document.getElementById("foto-avance-cuerpo").innerHTML = `
      <div id="lt-listo">
        <img id="lt-img">
        <div id="lt-etiqueta"></div>
        <div id="lt-pct"></div>
        <input type="range" id="lt-range" min="0" max="1" value="0" step="1">
        <div id="lt-leyenda"></div>
      </div>`;
    ltSnaps = [
      { id: "s1", fecha: "2026-01-01", etiqueta: "Semana 1", porcentajes: [{ nombreCompleto: "Estructura - Piso 1", capaId: "capaX", pct: 20 }] },
      { id: "s2", fecha: "2026-01-08", etiqueta: "Semana 2", porcentajes: [{ nombreCompleto: "Estructura (renombrada) - Piso 1", capaId: "capaX", pct: 55 }] },
    ];
    ltImagenes = [null, null];
    pintarLineaDeTiempo(1);
    const leyenda = document.getElementById("lt-leyenda").innerHTML;
    const r1_muestraDelta = /\+35/.test(leyenda); // 55-20=35, solo se calcula si encuentra el capaId en el snapshot anterior

    // ---- 2) El historial se ordena por FECHA antes de calcular series/deltas, no por orden de inserción ----
    // Se cargan los snapshots "fuera de orden" (el más nuevo primero en el array) -- si no se
    // reordenara por fecha, el "antes" de la capa sería el más nuevo y el "después" el más viejo.
    snapshotsPlanoActual = [
      { id: "s2", fecha: "2026-02-01", etiqueta: "Semana 2", porcentajes: [{ nombreCompleto: "Pintura", capaId: "capaY", pct: 80 }] },
      { id: "s1", fecha: "2026-01-01", etiqueta: "Semana 1", porcentajes: [{ nombreCompleto: "Pintura", capaId: "capaY", pct: 30 }] },
    ];
    renderListaSnapshots();
    const htmlLista = document.getElementById("lista-snapshots").innerHTML;
    // Si ordenó bien por fecha, el delta de la segunda fila (Semana 2) debería ser "+50" (80-30).
    const r2_ordenPorFecha = /\+50/.test(htmlLista);

    // ==================== ASISTENCIA ====================
    // ---- 3) asignarTrabajadorAFila no debe descartar los días recién tipeados en la fila extra ----
    mesActual = "2026-06";
    trabajadores = [{ id: "tExistente", nombre: "Juan", categoria: "Oficial", estado: "Activo", obra: "ObraTest" }];
    asistenciaCache[mesActual] = {
      // El trabajador YA tiene una entrada auto-creada (vacía) en la grilla estándar de este mes.
      tExistente: { obra: "ObraTest", days: {}, notaQ1: "", notaQ2: "" },
      // La fila "extra" (temporal) donde se tipearon 3 días antes de elegir a quién asignarla.
      filaTemp1: { obra: "", days: { 1: "8", 2: "8", 3: "8" }, notaQ1: "", notaQ2: "" },
    };
    asignarTrabajadorAFila("filaTemp1", "tExistente");
    const regFinal = asistenciaCache[mesActual]["tExistente"];
    const r3_diasConservados = regFinal && regFinal.days && regFinal.days["1"] === "8" && regFinal.days["2"] === "8" && regFinal.days["3"] === "8";
    const r3_filaTempBorrada = !asistenciaCache[mesActual]["filaTemp1"];

    // ---- 4) Coma decimal ("4,5") se reconoce como número (horas), no cae en "otra_obra" ----
    const r4_comaEsNumero = esNumeroPuro("4,5") && clasificarValorDia("4,5") === "presente";

    // ---- 5) "LL5" (llovió pero se trabajaron 5hs) SUMA en el total de horas de la quincena ----
    const totalConLL = totalHorasRango({ 1: "8", 2: "LL5" }, 1, 2);
    const r5_llSumaHoras = totalConLL === 13; // 8 + 5

    // ---- 6) "4,5" (coma decimal) suma 4.5, no se trunca a 4 (parseFloat corta en la coma) ----
    const r6_comaNoTruncada = totalHorasRango({ 1: "4,5" }, 1, 1) === 4.5;

    return { r1_muestraDelta, r2_ordenPorFecha, r3_diasConservados, r3_filaTempBorrada, r4_comaEsNumero, r5_llSumaHoras, r6_comaNoTruncada };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_muestraDelta) fallas.push("BUG REPRODUCIDO: la línea de tiempo debería calcular el delta +/- agrupando por capaId, no por nombreCompleto");
  if (!resultado.r2_ordenPorFecha) fallas.push("BUG REPRODUCIDO: el historial de snapshots debería ordenarse por fecha antes de calcular deltas, no por orden de inserción");
  if (!resultado.r3_diasConservados) fallas.push("BUG REPRODUCIDO: asignarTrabajadorAFila() descartó en silencio los días tipeados en la fila extra");
  if (!resultado.r3_filaTempBorrada) fallas.push("La fila temporal debería desaparecer después de asignarla");
  if (!resultado.r4_comaEsNumero) fallas.push("BUG REPRODUCIDO: '4,5' (coma decimal) debería reconocerse como horas trabajadas, no clasificarse como 'otra_obra'");
  if (!resultado.r5_llSumaHoras) fallas.push(`BUG REPRODUCIDO: 'LL5' debería sumar 5hs al total de horas de la quincena (dio ${JSON.stringify(resultado)})`);
  if (!resultado.r6_comaNoTruncada) fallas.push(`BUG REPRODUCIDO: '4,5' debería sumar 4.5hs, no truncarse a 4 (parseFloat corta en la coma) -- dio ${JSON.stringify(resultado)}`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PLANO DE AVANCE Y ASISTENCIA (RONDA 2) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
