// Ronda 6 de auditoría (relanzada) -- Libro climático, 5 arreglos más:
// 1) El selector "¿Se trabajó?" no se reseteaba después de guardar (a diferencia de la condición).
// 2) quitarRegistroClima() sin chequeo de rol ni registro de actividad.
// 3) UTC-vs-local en el aviso de lluvia para mañana (mismo bug ya arreglado en el resumen semanal
//    y en las tendencias del Dashboard).
// 4) Sin aviso de fecha futura al guardar un registro climático (Caja Chica sí lo tiene).
// 5) sparkClima del Dashboard usaba .find() en vez de agregar con .some() entre varias obras.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ timezoneId: "America/Argentina/Buenos_Aires" });
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
    usuarios = [{ username: "admin", role: "admin" }];
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest", "ObraB"];
    obrasFinalizadas = [];
    climaRegistros = [];
    actividadLog = [];
    irA("clima");

    // ---- 1) El selector "¿Se trabajó?" se resetea después de guardar ----
    document.getElementById("clima-obra").value = "ObraTest";
    document.getElementById("clima-fecha").value = "2026-01-05";
    seleccionarCondicionClima("Lluvia");
    seleccionarTrabajoClima("no"); // marco "No se trabajó" para esta obra (lluvia de verdad)
    await guardarRegistroClima();

    // Cargo el día siguiente para OTRA obra -- normal, soleado -- solo toco la condición.
    document.getElementById("clima-fecha").value = "2026-01-06";
    seleccionarCondicionClima("Soleado");
    // OJO: a propósito NO toco seleccionarTrabajoClima acá -- así se reproduce el escenario real.
    await guardarRegistroClima();
    const registroDia6 = climaRegistros.find(r => r.fecha === "2026-01-06");
    const r1_noHeredaNoDelDiaAnterior = registroDia6 && registroDia6.seTrabajo === "si";

    // ---- 2) quitarRegistroClima exige admin y registra actividad ----
    const idABorrar = climaRegistros[0].id;
    sesionActual = { username: "capataz1", role: "capataz", permisos: { ...PERMISOS_CAPATAZ_DEFAULT, clima: true } };
    const lenAntes = climaRegistros.length;
    await quitarRegistroClima(idABorrar);
    const r2_noBorraSiNoEsAdmin = climaRegistros.length === lenAntes;
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    await quitarRegistroClima(idABorrar);
    const r2_borraSiEsAdmin = climaRegistros.length === lenAntes - 1;
    const r2_quedaEnActividad = actividadLog.length > 0 && actividadLog[0].texto.includes("eliminó el registro climático");

    // ---- 4) Aviso de fecha futura (no bloqueante) ----
    const toasts = [];
    const showToastOriginal = window.showToast;
    window.showToast = (msg) => toasts.push(msg);
    document.getElementById("clima-fecha").value = "2099-01-01";
    seleccionarCondicionClima("Soleado");
    seleccionarTrabajoClima("si");
    await guardarRegistroClima();
    window.showToast = showToastOriginal;
    const r4_avisaFechaFutura = toasts.some(t => t.includes("fecha futura"));

    // ---- 5) sparkClima del Dashboard agrega entre varias obras (no .find()) ----
    pedidosIndex = []; remitosIndex = []; herramientas = []; observaciones = []; recordatorios = [];
    contratistasIndex = []; presupuestoItems = []; rendicionesIndex = []; rendicionesCache = {};
    mesesConErrorDeCarga = {}; asistenciaCache = {}; trabajadores = [];
    climaCiudadRef = null; dashboardObraFiltro = null;
    const hoy = new Date();
    const hoyStr = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
    // ObraTest (PRIMERA en el array) NO trabajó hoy; ObraB (segunda) SÍ trabajó -- con .find(),
    // el primer match (ObraTest, "no") gana aunque ObraB sí haya trabajado, dando 0/7 en vez de 1/7.
    climaRegistros = [
      { id: "cA", fecha: hoyStr, obra: "ObraTest", seTrabajo: "no" },
      { id: "cB", fecha: hoyStr, obra: "ObraB", seTrabajo: "si" },
    ];
    await renderDashboard();
    await new Promise(r => setTimeout(r, 300));
    const htmlStats = document.getElementById("dash-stats").innerHTML;
    const r5_cuentaSiAlgunaObraTrabajo = /1\/7 días trabajados/.test(htmlStats);

    return {
      r1_noHeredaNoDelDiaAnterior,
      r2_noBorraSiNoEsAdmin, r2_borraSiEsAdmin, r2_quedaEnActividad,
      r4_avisaFechaFutura,
      r5_cuentaSiAlgunaObraTrabajo,
    };
  });

  // El aviso de lluvia (UTC-vs-local) se prueba aparte con el reloj fijado a las 22:00 hora Argentina.
  await page.clock.setFixedTime(new Date("2026-09-16T01:00:00Z")); // = 2026-09-15 22:00 ART
  const resultadoUtc = await page.evaluate(async () => {
    climaCiudadRef = "Buenos Aires";
    avisoLluviaCache = null;
    const fetchOriginal = window.fetch;
    let fechaConsultada = null;
    window.fetch = async (url) => {
      // "Mañana" local es el 16. Con el bug UTC, el código viejo buscaba "2026-09-17" (un día de más).
      const tramos = [
        { dt_txt: "2026-09-16 12:00:00", weather: [{ id: 500, description: "lluvia moderada" }], pop: 0.8 },
      ];
      return { ok: true, json: async () => ({ list: tramos }) };
    };
    const r = await obtenerPronosticoLluviaManana();
    window.fetch = fetchOriginal;
    return { r3_encuentraPronosticoDeManana: !!(r && r.llueve) };
  });

  console.log("Resultado:", JSON.stringify({ ...resultado, ...resultadoUtc }, null, 2));

  const fallas = [];
  if (!resultado.r1_noHeredaNoDelDiaAnterior) fallas.push("BUG REPRODUCIDO: el selector '¿Se trabajó?' no se resetea después de guardar -- un día normal hereda 'No se trabajó' del registro anterior");
  if (!resultado.r2_noBorraSiNoEsAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder eliminar un registro climático");
  if (!resultado.r2_borraSiEsAdmin) fallas.push("quitarRegistroClima debería seguir funcionando para un admin");
  if (!resultado.r2_quedaEnActividad) fallas.push("BUG REPRODUCIDO: eliminar un registro climático debería quedar registrado en Actividad");
  if (!resultadoUtc.r3_encuentraPronosticoDeManana) fallas.push("BUG REPRODUCIDO: el aviso de lluvia para mañana no encuentra el tramo del pronóstico por mezclar UTC con fecha local (22:00 hora Argentina)");
  if (!resultado.r4_avisaFechaFutura) fallas.push("BUG REPRODUCIDO: no se avisa si un registro climático se guardó con fecha futura");
  if (!resultado.r5_cuentaSiAlgunaObraTrabajo) fallas.push("BUG REPRODUCIDO: sparkClima del Dashboard debería contar el día como trabajado si CUALQUIER obra visible trabajó, no solo la que el .find() encuentre primero");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE LIBRO CLIMÁTICO (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
