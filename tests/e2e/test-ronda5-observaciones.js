// Ronda 5 de auditoría -- Observaciones y Recordatorios: 3 arreglos.
// 1) crearRecordatorio (Tool Layer de NEXO) siempre decía "Listo, creé..." aunque el guardado real
//    hubiera fallado (guardarRecordatorioDirecto devuelve false sin obra activa).
// 2) eliminarRecordatorio no chequeaba rol admin ni registraba actividad, a diferencia de
//    eliminarObservacion (misma pantalla, mismo permiso).
// 3) generarTextoResumenSemanal mezclaba hoyISO() (local) con .toISOString() (UTC) para el rango de
//    7 días -- entre las ~21:00 y las 23:59 hora Argentina, el día de HOY quedaba excluido.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  // Forzamos zona horaria Argentina -- el bug de UTC-vs-local solo se nota cuando difieren.
  const page = await browser.newPage({ timezoneId: "America/Argentina/Buenos_Aires" });
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

    // ---- 1) crearRecordatorio (NEXO) no miente éxito si falla el guardado ----
    obraPredeterminada = ""; // sin obra activa -> guardarRecordatorioDirecto debe fallar
    obras = [];
    const toasts = [];
    const showToastOriginal = window.showToast;
    window.showToast = (msg) => toasts.push(msg);
    const resultadoNexo = await NEXO_TOOLS.crearRecordatorio.ejecutar({ titulo: "Comprar cemento", fecha: null });
    window.showToast = showToastOriginal;
    const r1_noDiceExitoFalso = !resultadoNexo.includes("Listo, creé");
    const r1_diceQueFallo = resultadoNexo.includes("No pude");
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];

    // ---- 2) eliminarRecordatorio exige admin y registra actividad ----
    // confirm() se fuerza a "true" -- en el código viejo (sin chequeo de rol) alcanza con un
    // window.confirm() nativo, que Playwright auto-rechaza si no se lo pisa, y eso enmascararía el
    // bug real (haría parecer que "no dejó borrar" por el motivo equivocado).
    const confirmOriginal = window.confirm;
    window.confirm = () => true;
    recordatorios = [{ id: "r1", titulo: "Llamar al proveedor", obra: "ObraTest", fecha: null, prioridad: "media", estado: "pendiente", fechaCreacion: "2026-01-01", creadoPor: "admin" }];
    actividadLog = [];
    sesionActual = { username: "capataz1", role: "capataz", permisos: {} };
    await eliminarRecordatorio("r1");
    const r2_noBorraSiNoEsAdmin = recordatorios.length === 1;
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    await eliminarRecordatorio("r1");
    const r2_borraSiEsAdmin = recordatorios.length === 0;
    const r2_quedaEnActividad = actividadLog.length > 0 && actividadLog[0].texto.includes("Llamar al proveedor");
    window.confirm = confirmOriginal;

    // ---- 3) El resumen semanal no excluye el día de HOY por una mezcla UTC/local ----
    // Fijamos el reloj a las 22:00 hora Argentina de un día puntual -- ahí es donde el bug se nota
    // (la fecha en UTC ya cae en el día calendario siguiente).
    return { r1_noDiceExitoFalso, r1_diceQueFallo, r2_noBorraSiNoEsAdmin, r2_borraSiEsAdmin, r2_quedaEnActividad };
  });

  // El clock hay que fijarlo desde Node (page.clock), no desde adentro del evaluate.
  await page.clock.setFixedTime(new Date("2026-09-16T01:00:00Z")); // = 2026-09-15 22:00 ART
  const resultadoUtc = await page.evaluate(async () => {
    trabajadores = [{ id: "t1", nombre: "Juan", categoria: "Oficial", obra: "ObraTest", estado: "Activo", fechaBaja: "", obs: "" }];
    // Con "hoy" = 15 (local), el día 9 es el 7mo día de la ventana ([9..15], local, ambos incluidos).
    // El bug UTC-vs-local hacía que el código viejo NUNCA llegara a leer ese día (el mapeo corrido
    // por la conversión a UTC se queda corto un día en el otro extremo de la ventana) -- es un
    // diferenciador más confiable que probar con el día de hoy, porque el corrimiento de un día
    // completo puede hacer que "hoy" coincida por casualidad con otro índice del mismo bucle.
    asistenciaCache = { "2026-09": { t1: { obra: "ObraTest", days: { "9": "9" }, notaQ1: "", notaQ2: "" } } };
    climaRegistros = [];
    rendicionesIndex = [];
    pedidosIndex = [];
    const texto = await generarTextoResumenSemanal();
    const r3_incluyeHoy = /1 día trabajado/.test(texto);
    return { r3_incluyeHoy, textoDebug: texto };
  });

  console.log("Resultado:", JSON.stringify({ ...resultado, ...resultadoUtc }, null, 2));

  const fallas = [];
  if (!resultado.r1_noDiceExitoFalso) fallas.push("BUG REPRODUCIDO: crearRecordatorio (NEXO) no debería decir 'Listo, creé...' si el guardado falló (sin obra activa)");
  if (!resultado.r1_diceQueFallo) fallas.push("crearRecordatorio (NEXO) debería avisar que no pudo crear el recordatorio");
  if (!resultado.r2_noBorraSiNoEsAdmin) fallas.push("BUG REPRODUCIDO: eliminarRecordatorio no debería permitir borrar a un capataz (no admin)");
  if (!resultado.r2_borraSiEsAdmin) fallas.push("eliminarRecordatorio debería seguir funcionando para un admin");
  if (!resultado.r2_quedaEnActividad) fallas.push("BUG REPRODUCIDO: eliminar un recordatorio debería quedar registrado en Actividad");
  if (!resultadoUtc.r3_incluyeHoy) fallas.push(`BUG REPRODUCIDO: el resumen semanal debería incluir el día de HOY (22:00 hora Argentina) -- texto: ${resultadoUtc.textoDebug}`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE OBSERVACIONES/RECORDATORIOS (RONDA 5) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
