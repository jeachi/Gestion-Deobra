// Ronda 6 de auditoría -- Dashboard: la ventana de "últimos 7 días" de las tendencias (sparkClima/
// sparkPersonal/sparkPedidos) armaba las fechas con d.toISOString() (UTC) en vez de fecha local --
// mismo bug ya encontrado y arreglado en generarTextoResumenSemanal y en "días de atraso" de
// Herramientas. Entre las ~21:00 y las 23:59 hora Argentina, el día de HOY (local) ya cae en el día
// calendario siguiente en UTC, así que el registro de HOY no se encontraba en la ventana.
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

  // 2026-09-16T01:00:00Z = 2026-09-15 22:00 hora Argentina -- "hoy" local es el 15, pero en UTC ya es el 16.
  await page.clock.setFixedTime(new Date("2026-09-16T01:00:00Z"));

  const resultado = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    usuarios = [{ username: "admin", role: "admin" }];
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    trabajadores = [];
    pedidosIndex = []; remitosIndex = []; herramientas = []; observaciones = []; recordatorios = [];
    contratistasIndex = []; presupuestoItems = []; rendicionesIndex = []; rendicionesCache = {};
    mesesConErrorDeCarga = {}; asistenciaCache = {};
    actividadLog = [];
    climaCiudadRef = null;

    // Con "hoy" = 15 (local), la ventana correcta de 7 días es [9..15] (ambos extremos incluidos).
    // El bug UTC corre la ventana entera un día hacia adelante ([10..16], el "16" es un día futuro
    // que no existe todavía) -- un registro en el extremo más viejo (el 9) queda afuera de la
    // ventana con el bug, y adentro con el fix. Es un diferenciador más confiable que poner el
    // registro en "hoy", porque el corrimiento de un día completo no saca a "hoy" de la ventana
    // (sigue estando adentro, solo que en otra posición).
    climaRegistros = [{ id: "c1", fecha: "2026-09-09", obra: "ObraTest", seTrabajo: "si" }];
    dashboardObraFiltro = null;

    await renderDashboard();
    await new Promise(r => setTimeout(r, 300));

    const htmlStats = document.getElementById("dash-stats").innerHTML;
    const r1_climaCuentaExtremoViejo = /1\/7 días trabajados/.test(htmlStats);

    return { r1_climaCuentaExtremoViejo, htmlDebug: htmlStats };
  });
  console.log("Resultado:", JSON.stringify({ r1_climaCuentaExtremoViejo: resultado.r1_climaCuentaExtremoViejo }, null, 2));

  const fallas = [];
  if (!resultado.r1_climaCuentaExtremoViejo) fallas.push(`BUG REPRODUCIDO: la ventana de "últimos 7 días" del Dashboard (22:00 hora Argentina) se arma con UTC en vez de fecha local y queda corrida un día -- fragmento: ${resultado.htmlDebug.slice(0, 400)}`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE DASHBOARD -- UTC EN TENDENCIAS (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
