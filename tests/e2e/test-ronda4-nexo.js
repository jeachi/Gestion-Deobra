// Ronda 4 de auditoría -- Asistente unificado NEXO: 5 arreglos.
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
    trabajadores = [
      { id: "t1", nombre: "Andrés Gómez", categoria: "Oficial", obra: "ObraTest", estado: "Activo", fechaBaja: "", obs: "" },
      { id: "t2", nombre: "Juan Pérez", categoria: "Oficial", obra: "ObraTest", estado: "Activo", fechaBaja: "", obs: "" },
    ];
    mesesConErrorDeCarga = {};
    asistenciaCache = {};

    // Usamos el mes real (mesHoyISO()) en vez de un string hardcodeado -- un "2026-09" fijo se
    // rompe apenas el reloj real cruza a octubre, porque aplicarPreviewAsistenciaAsistente()/
    // aplicarAccionesMultiIntencion() siempre escriben en mesHoyISO(), no en lo que el test asuma.
    const mesHoy = mesHoyISO();

    // ---- 1) guardarAsistenciaMes devuelve false si el guardado quedó pendiente (offline) ----
    const setOriginal = window.storage.set;
    window.storage.set = async (k, v, s) => ({ key: k, value: v, shared: s, pendiente: true }); // simula fallo/offline
    asistenciaCache[mesHoy] = { t1: { obra: "ObraTest", days: { "5": "9" }, notaQ1: "", notaQ2: "" } };
    const r1_devuelveFalseSiPendiente = (await guardarAsistenciaMes(mesHoy)) === false;
    window.storage.set = setOriginal;
    const r1_devuelveTrueSiOk = (await guardarAsistenciaMes(mesHoy)) === true;

    // ---- 2) aplicarPreviewAsistenciaAsistente no muestra "✓" falso si el guardado quedó pendiente ----
    const toasts = [];
    const showToastOriginal = window.showToast;
    window.showToast = (msg) => toasts.push(msg);
    window.storage.set = async (k, v, s) => ({ key: k, value: v, shared: s, pendiente: true });
    window.__previewAsistenciaAsistente = [{ id: "t1", nombre: "Andrés Gómez", estado: "A", badge: "❌ Ausente", clase: "badge-ausente" }];
    await aplicarPreviewAsistenciaAsistente();
    window.storage.set = setOriginal;
    const r2_noMuestraExitoFalso = !toasts.some(t => t.includes("✓ Asistencia de hoy cargada"));
    const r2_muestraAvisoPendiente = toasts.some(t => t.includes("Pendiente") || t.includes("Sin conexión"));

    // ---- 3) La asistencia del multi-intención NO se aplica sola -- requiere el segundo toque ----
    toasts.length = 0;
    asistenciaCache[mesHoy] = {}; // limpio: si se aplicó sola, va a aparecer acá
    document.getElementById("asistente-preview-multi").style.display = "none";
    window.__accionesMultiPendientes = [
      { tipo: "asistencia", ausentes: ["Andrés Gómez"], enfermos: [], resumen: "Andrés faltó" },
    ];
    await aplicarAccionesMultiIntencion();
    const r3_noAplicoSolo = !("t1" in (asistenciaCache[mesHoy] || {})); // la grilla real no se tocó todavía
    const r3_muestraPreviewAsistencia = document.getElementById("asistente-preview-asistencia").style.display === "block";
    // Confirmando de verdad (segundo toque, como hace el botón real) sí debe guardar.
    await aplicarPreviewAsistenciaAsistente();
    const r3_confirmarSiGuarda = "t1" in (asistenciaCache[mesHoy] || {});

    // ---- 4) Comparación de nombres normaliza tildes/mayúsculas (Andres sin tilde debe matchear) ----
    mostrarPreviewAsistenciaAsistente(trabajadores, ["andres gomez"], []); // sin tilde, minúscula
    const htmlPreview = document.getElementById("asistente-preview-asistencia").innerHTML;
    const r4_reconoceSinTilde = /Andrés Gómez[\s\S]*?❌ Ausente/.test(htmlPreview);

    // ---- 5) Toast de éxito de observación/recordatorio del multi-intención no cuenta fallos ----
    obraPredeterminada = ""; // sin obra activa -> guardarObservacionDirecta/guardarRecordatorioDirecto deben fallar
    obras = [];
    toasts.length = 0;
    observaciones = [];
    recordatorios = [];
    window.__accionesMultiPendientes = [
      { tipo: "observacion", observacionTitulo: "Filtración en el techo", resumen: "Filtración" },
      { tipo: "recordatorio", recordatorioTitulo: "Comprar cemento", resumen: "Comprar cemento" },
    ];
    document.getElementById("asistente-preview-multi").style.display = "none";
    await aplicarAccionesMultiIntencion();
    const r5_noMuestraExitoObservacionFallida = !toasts.some(t => t.includes("Se guardaron") && t.includes("observación"));
    const r5_noMuestraExitoRecordatorioFallido = !toasts.some(t => t.includes("Se guardaron") && t.includes("recordatorio"));
    const r5_noSeGuardoNiUnaObservacion = observaciones.length === 0;

    // ---- 6) "recordatorio: texto" (con dos puntos) ahora exige confirmación, igual que "recordame ..." ----
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    recordatorios = [];
    document.getElementById("asistente-texto").value = "recordatorio: comprar cemento";
    asistenteModoForzado = null;
    asistenteImagenesData = [];
    asistenteDocumentoPDF = null;
    await procesarAsistentePedidos();
    // Si el bug siguiera ahí, se guardaría directo (recordatorios.length===1) sin pedir nada.
    const r6_noGuardaDirecto = recordatorios.length === 0;
    // Debe haber quedado una burbuja pidiendo confirmación (con botón "Confirmar").
    const hayBotonConfirmar = !!document.querySelector("#asistente-chat-mensajes button, .btn-primary.btn-sm");
    const r6_pideConfirmacion = Array.from(document.querySelectorAll("button")).some(b => b.textContent.trim() === "Confirmar");

    window.showToast = showToastOriginal;

    return {
      r1_devuelveFalseSiPendiente, r1_devuelveTrueSiOk,
      r2_noMuestraExitoFalso, r2_muestraAvisoPendiente,
      r3_noAplicoSolo, r3_muestraPreviewAsistencia, r3_confirmarSiGuarda,
      r4_reconoceSinTilde,
      r5_noMuestraExitoObservacionFallida, r5_noMuestraExitoRecordatorioFallido, r5_noSeGuardoNiUnaObservacion,
      r6_noGuardaDirecto, r6_pideConfirmacion,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_devuelveFalseSiPendiente) fallas.push("BUG REPRODUCIDO: guardarAsistenciaMes debería devolver false si el guardado quedó pendiente (offline)");
  if (!resultado.r1_devuelveTrueSiOk) fallas.push("guardarAsistenciaMes debería devolver true si el guardado fue real");
  if (!resultado.r2_noMuestraExitoFalso) fallas.push("BUG REPRODUCIDO: no debería mostrarse '✓ Asistencia de hoy cargada' si el guardado quedó pendiente (offline)");
  if (!resultado.r2_muestraAvisoPendiente) fallas.push("Debería mostrarse un aviso de 'pendiente/sin conexión' cuando el guardado no llegó a Firestore");
  if (!resultado.r3_noAplicoSolo) fallas.push("BUG REPRODUCIDO: el asistente NO debería aplicar la asistencia a la grilla real sin un segundo toque de confirmación explícito");
  if (!resultado.r3_muestraPreviewAsistencia) fallas.push("Debería mostrarse la vista previa por trabajador de asistencia dentro del flujo multi-intención");
  if (!resultado.r3_confirmarSiGuarda) fallas.push("Confirmando explícitamente (segundo toque) sí debería guardarse la asistencia");
  if (!resultado.r4_reconoceSinTilde) fallas.push("BUG REPRODUCIDO: 'andres gomez' (sin tilde) debería reconocer a 'Andrés Gómez' y marcarlo Ausente, no quedar como Presente en silencio");
  if (!resultado.r5_noMuestraExitoObservacionFallida) fallas.push("BUG REPRODUCIDO: no debería mostrarse '✓ Se guardaron observación(es)' si guardarObservacionDirecta falló (sin obra activa)");
  if (!resultado.r5_noMuestraExitoRecordatorioFallido) fallas.push("BUG REPRODUCIDO: no debería mostrarse '✓ Se guardaron recordatorio(s)' si guardarRecordatorioDirecto falló (sin obra activa)");
  if (!resultado.r5_noSeGuardoNiUnaObservacion) fallas.push("Sin obra activa, no debería haberse guardado ninguna observación de verdad");
  if (!resultado.r6_noGuardaDirecto) fallas.push("BUG REPRODUCIDO: 'recordatorio: texto' (con dos puntos) no debería guardarse directo sin confirmación");
  if (!resultado.r6_pideConfirmacion) fallas.push("'recordatorio: texto' debería pedir confirmación explícita (botón Confirmar), igual que 'recordame texto'");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE NEXO (RONDA 4) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
