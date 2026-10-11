// Ronda 5 de auditoría -- Nómina/Asistencia: 4 arreglos.
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
    categorias = ["Oficial", "Sereno"];
    errorCargaTrabajadores = false;
    mesActual = "2026-04";
    quincenaActual = 1;

    // ---- 1) "Copiar semana anterior" no resucita a un trabajador dado de Baja ----
    trabajadores = [
      { id: "tActivo", nombre: "Juan Pérez", categoria: "Oficial", obra: "ObraTest", estado: "Activo", fechaBaja: "", obs: "" },
      { id: "tBaja", nombre: "Pedro López", categoria: "Oficial", obra: "ObraTest", estado: "Baja", fechaBaja: "2026-04-08", obs: "" },
    ];
    // Semana origen: 2026-03-25 (miércoles) a 2026-03-31. Semana destino: 2026-04-01 a 2026-04-07.
    asistenciaCache = {
      "2026-03": {
        tActivo: { obra: "ObraTest", days: { "25": "9" }, notaQ1: "", notaQ2: "" },
        tBaja: { obra: "ObraTest", days: { "25": "9" }, notaQ1: "", notaQ2: "" },
      },
      "2026-04": {},
    };
    abrirCopiarSemanaAnterior();
    document.getElementById("cs-fecha-desde").value = "2026-04-01";
    await confirmarCopiarSemanaAnterior();
    const r1_copioActivo = asistenciaCache["2026-04"].tActivo && asistenciaCache["2026-04"].tActivo.days["1"] === "9";
    const r1_noCopioBaja = !asistenciaCache["2026-04"].tBaja || asistenciaCache["2026-04"].tBaja.days["1"] === undefined;

    // ---- 2) La restricción de Sereno detecta la categoría sin importar mayúsculas/minúsculas ----
    trabajadores = [{ id: "tSereno", nombre: "Carlos Ruiz", categoria: "Sereno", obra: "ObraTest", estado: "Activo", fechaBaja: "", obs: "" }];
    asistenciaCache["2026-04"] = { tSereno: { obra: "ObraTest", days: {}, notaQ1: "", notaQ2: "" } };
    const toasts = [];
    const showToastOriginal = window.showToast;
    window.showToast = (msg) => toasts.push(msg);
    setDia("tSereno", 10, "8"); // intenta cargar una jornada normal para un "Sereno" (minúsculas)
    window.showToast = showToastOriginal;
    const r2_rechazaJornadaNormal = asistenciaCache["2026-04"].tSereno.days[10] === undefined;
    const r2_avisoMostrado = toasts.some(t => t.includes("Sereno"));

    // ---- 3) La nota "BAJA" no pisa la nota real de un mes ANTERIOR a la baja ----
    trabajadores = [{ id: "tNota", nombre: "Ana Gómez", categoria: "Oficial", obra: "ObraTest", estado: "Baja", fechaBaja: "2026-04-10", obs: "" }];
    asistenciaCache["2026-01"] = { tNota: { obra: "ObraTest", days: { "5": "9" }, notaQ1: "Llegó tarde 3 veces", notaQ2: "" } };
    mesActual = "2026-01";
    quincenaActual = 1;
    await renderAsistencia();
    const htmlEnero = document.getElementById("tabla-asistencia").innerHTML;
    const r3_muestraNotaReal = htmlEnero.includes("Llegó tarde 3 veces");
    const r3_noMuestraBajaRetroactiva = !htmlEnero.includes("BAJA");
    // En el mes de la baja (o posterior), la nota SÍ debería mostrar "BAJA".
    mesActual = "2026-04";
    asistenciaCache["2026-04"] = asistenciaCache["2026-04"] || {};
    asistenciaCache["2026-04"].tNota = { obra: "ObraTest", days: {}, notaQ1: "", notaQ2: "" };
    await renderAsistencia();
    const htmlAbril = document.getElementById("tabla-asistencia").innerHTML;
    const r3_muestraBajaEnMesDeLaBaja = htmlAbril.includes("BAJA");

    // ---- 4) El Excel de Nómina incluye filas sin trabajador asignado que sí tienen horas cargadas ----
    mesActual = "2026-04";
    trabajadores = [];
    // filasExtra es un CONTADOR (no un array): filasParaMes() arma los ids como "extra_0", "extra_1", ...
    asistenciaCache["2026-04"] = { extra_0: { obra: "ObraTest", days: { "1": "8", "2": "9" }, notaQ1: "", notaQ2: "" } };
    filasExtra = 1;
    let aoaCapturado = null;
    window.XLSX = {
      utils: {
        aoa_to_sheet: (aoa) => { aoaCapturado = aoa; return {}; },
        book_new: () => ({}),
        book_append_sheet: () => {},
      },
      writeFile: () => {},
    };
    descargarExcelNomina();
    const r4_incluyeFilaSinTrabajador = aoaCapturado && aoaCapturado.length === 2; // encabezado + 1 fila

    return { r1_copioActivo, r1_noCopioBaja, r2_rechazaJornadaNormal, r2_avisoMostrado, r3_muestraNotaReal, r3_noMuestraBajaRetroactiva, r3_muestraBajaEnMesDeLaBaja, r4_incluyeFilaSinTrabajador };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_copioActivo) fallas.push("'Copiar semana anterior' debería seguir copiando a un trabajador activo");
  if (!resultado.r1_noCopioBaja) fallas.push("BUG REPRODUCIDO: 'Copiar semana anterior' no debería resucitar horas de un trabajador ya dado de Baja");
  if (!resultado.r2_rechazaJornadaNormal) fallas.push("BUG REPRODUCIDO: un 'Sereno' con la categoría en minúsculas debería seguir sin poder cargar una jornada normal");
  if (!resultado.r2_avisoMostrado) fallas.push("Debería mostrarse el aviso de que Sereno solo puede cargar Pn/Pd");
  if (!resultado.r3_muestraNotaReal) fallas.push("BUG REPRODUCIDO: la Nómina de un mes ANTERIOR a la baja debería mostrar la nota real cargada ese mes");
  if (!resultado.r3_noMuestraBajaRetroactiva) fallas.push("BUG REPRODUCIDO: no debería mostrarse 'BAJA' en un mes anterior a la fecha de baja");
  if (!resultado.r3_muestraBajaEnMesDeLaBaja) fallas.push("En el mes de la baja (o posterior) sí debería mostrarse la nota de BAJA");
  if (!resultado.r4_incluyeFilaSinTrabajador) fallas.push("BUG REPRODUCIDO: el Excel de Nómina debería incluir una fila sin trabajador asignado que ya tiene horas cargadas");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE NÓMINA (RONDA 5) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
