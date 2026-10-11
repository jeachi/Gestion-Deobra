// Ronda 3 de auditoría -- Recordatorios: 4 arreglos (mismos patrones ya arreglados en
// Observaciones/Minutas, que nunca se replicaron acá).
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
    obraPredeterminada = "ObraActiva";
    obras = ["ObraActiva", "ObraFinalizada"];
    obrasFinalizadas = ["ObraFinalizada"];

    // ---- 1) Editar un recordatorio de una obra finalizada conserva esa obra en el select ----
    recordatorios = [{ id: "r1", titulo: "Llamar al proveedor", obra: "ObraFinalizada", asunto: "", fecha: "2026-05-01", prioridad: "media", contactoNombre: "", contactoTel: "", estado: "pendiente" }];
    editarRecordatorio("r1");
    const r1_obraConservada = document.getElementById("rec-obra").value === "ObraFinalizada";

    // ---- 2) guardarRecordatorioDirecto valida que haya obra activa ----
    obraPredeterminada = "";
    obras = [];
    obrasFinalizadas = [];
    recordatorios = [];
    let toastMsg = null;
    const showToastOriginal = window.showToast;
    window.showToast = (m) => { toastMsg = m; };
    await guardarRecordatorioDirecto("Llamar al plomero", "2026-06-01", "alta");
    const r2_noGuardoSinObra = recordatorios.length === 0 && !!toastMsg;

    // ---- 3) guardarRecordatorio (formulario manual) valida que haya obra ----
    recEditandoId = null;
    document.getElementById("rec-titulo").value = "Pedir presupuesto";
    document.getElementById("rec-obra").innerHTML = ""; // sin obras activas, el select queda vacío
    document.getElementById("rec-asunto").value = "";
    document.getElementById("rec-fecha").value = "";
    document.getElementById("rec-contacto-nombre").value = "";
    document.getElementById("rec-contacto-tel").value = "";
    recPrioridadSel = "baja";
    toastMsg = null;
    await guardarRecordatorio();
    window.showToast = showToastOriginal;
    const r3_noGuardoSinObra = recordatorios.length === 0 && !!toastMsg;

    // ---- 4) Notificación push de recordatorios urgentes respeta obrasActivas() ----
    obraPredeterminada = "ObraActiva";
    obras = ["ObraActiva", "ObraFinalizada"];
    obrasFinalizadas = ["ObraFinalizada"];
    recordatorios = [
      { id: "r4a", titulo: "Urgente en obra activa", obra: "ObraActiva", prioridad: "alta", estado: "pendiente", fecha: null },
      { id: "r4b", titulo: "Urgente en obra finalizada", obra: "ObraFinalizada", prioridad: "alta", estado: "pendiente", fecha: null },
    ];
    configAsistente = { detectores: { pedidosVencidos: false, observaciones: false, recordatorios: true } };
    pedidosIndex = [];
    observaciones = [];
    localStorage.removeItem("gdo_notif_ya_avisados");
    window.Notification = { permission: "granted" };
    let cuerposNotificados = [];
    const mostrarNotificacionSistemaOriginal = window.mostrarNotificacionSistema;
    window.mostrarNotificacionSistema = async (titulo, cuerpo) => { cuerposNotificados.push(cuerpo); };
    await revisarNotificacionesGenerales();
    window.mostrarNotificacionSistema = mostrarNotificacionSistemaOriginal;
    const textoNotificado = cuerposNotificados.join("\n");
    const r4_soloActivaEnUrgentes = textoNotificado.includes("Urgente en obra activa") && !textoNotificado.includes("Urgente en obra finalizada");

    return { r1_obraConservada, r2_noGuardoSinObra, r3_noGuardoSinObra, r4_soloActivaEnUrgentes };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_obraConservada) fallas.push("BUG REPRODUCIDO: editar un recordatorio de una obra finalizada debería conservar esa obra en el select");
  if (!resultado.r2_noGuardoSinObra) fallas.push("BUG REPRODUCIDO: guardarRecordatorioDirecto() no debería guardar con obra:'' cuando no hay obra activa");
  if (!resultado.r3_noGuardoSinObra) fallas.push("BUG REPRODUCIDO: guardarRecordatorio() no debería guardar sin obra elegida");
  if (!resultado.r4_soloActivaEnUrgentes) fallas.push("BUG REPRODUCIDO: las notificaciones de recordatorios urgentes deberían excluir obras finalizadas");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE RECORDATORIOS (RONDA 3) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
