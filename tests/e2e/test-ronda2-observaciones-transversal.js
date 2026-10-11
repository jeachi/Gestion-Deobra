// Ronda 2 de auditoría -- Observaciones (4 arreglos) y transversal (4 arreglos).
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

    // ==================== OBSERVACIONES ====================
    // ---- 1) Editar una observación de una obra FINALIZADA no debe dejar el select en blanco ----
    observaciones = [{ id: "o1", titulo: "Fisura", obra: "ObraFinalizada", responsable: "", descripcion: "", prioridad: "alta", estado: "detectado", foto: null }];
    obsEditandoId = null;
    editarObservacion("o1");
    const r1_obraVisible = document.getElementById("obs-obra").value === "ObraFinalizada";

    // ---- 2) Migración de fotos pesadas cubre fotoDespues, no solo foto ----
    const fotoChica = "data:image/png;base64,abc";
    const fotoPesada = "data:image/png;base64," + "x".repeat(25000);
    observaciones = [{ id: "o2", titulo: "Con foto después pesada", obra: "ObraActiva", foto: fotoChica, fotoDespues: fotoPesada, estado: "detectado", prioridad: "media" }];
    observacionesMigracionIntentada = false;
    errorCargaObservaciones = false;
    let recomprimida = false;
    window.recomprimirDataUrlAMiniatura = async (d) => { recomprimida = true; return "data:image/png;base64,recomprimida"; };
    await migrarFotosObservacionesSiHaceFalta();
    const r2_fotoDespuesRecomprimida = recomprimida && observaciones[0].fotoDespues === "data:image/png;base64,recomprimida";

    // ---- 3) Notificación push de observaciones críticas respeta obrasActivas() ----
    // Se llama a la función REAL (revisarNotificacionesGenerales), no a una copia de su lógica --
    // así el test se rompería si algún día se revierte el fix, en vez de validarse a sí mismo.
    observaciones = [
      { id: "o3a", titulo: "Crítica en obra activa", obra: "ObraActiva", prioridad: "alta", estado: "detectado" },
      { id: "o3b", titulo: "Crítica en obra finalizada", obra: "ObraFinalizada", prioridad: "alta", estado: "detectado" },
    ];
    configAsistente = { detectores: { pedidosVencidos: false, observaciones: true, recordatorios: false } };
    pedidosIndex = [];
    recordatorios = [];
    localStorage.removeItem("gdo_notif_ya_avisados");
    window.Notification = { permission: "granted" };
    let cuerposNotificados = [];
    const mostrarNotificacionSistemaOriginal = window.mostrarNotificacionSistema;
    window.mostrarNotificacionSistema = async (titulo, cuerpo) => { cuerposNotificados.push(cuerpo); };
    await revisarNotificacionesGenerales();
    window.mostrarNotificacionSistema = mostrarNotificacionSistemaOriginal;
    const textoNotificado = cuerposNotificados.join("\n");
    const r3_soloActivaEnCriticas = textoNotificado.includes("Crítica en obra activa") && !textoNotificado.includes("Crítica en obra finalizada");

    // ---- 4) guardarObservacionDirecta valida que haya una obra activa ----
    obraPredeterminada = "";
    obras = [];
    obrasFinalizadas = [];
    observaciones = [];
    let toastMsg = null;
    const showToastOriginal = window.showToast;
    window.showToast = (m) => { toastMsg = m; };
    await guardarObservacionDirecta("Algo urgente", "alta");
    window.showToast = showToastOriginal;
    const r4_noGuardoSinObra = observaciones.length === 0 && !!toastMsg;

    // ==================== TRANSVERSAL ====================
    // ---- 5) La tabla de usuarios/permisos incluye la columna "Presupuesto" ----
    const thead = document.querySelector("#tabla-usuarios thead");
    const r5_headerPresupuesto = thead && thead.textContent.includes("Presupuesto");
    const r5_arraysCompletos = ("presupuesto" in PERMISOS_ADMIN) && ("presupuesto" in PERMISOS_CAPATAZ_DEFAULT) && ("presupuesto" in NOMBRES_MODULO);

    // ---- 6) Sesión del día usa permisos VIGENTES, no los cacheados en localStorage ----
    usuarios = [{ username: "juan", role: "capataz", permisos: { caja: false } }]; // acceso a Caja ya revocado
    localStorage.setItem(CLAVE_SESION_DIA, JSON.stringify({ username: "juan", role: "capataz", permisos: { caja: true }, fecha: hoyISO() }));
    let sesionResultante = null;
    window.ingresarComo = (s) => { sesionResultante = s; };
    intentarSesionAutomaticaDelDia();
    const r6_permisosVigentes = sesionResultante && sesionResultante.permisos && sesionResultante.permisos.caja === false;

    // ---- 7) Catálogo de materiales colapsa espacios internos repetidos ----
    materialesCatalogo = [];
    actualizarCatalogoMateriales([{ desc: "Cemento Portland", un: "kg" }]);
    actualizarCatalogoMateriales([{ desc: "Cemento  Portland", un: "kg" }]); // doble espacio en el medio
    const r7_sinDuplicados = materialesCatalogo.length === 1;

    return { r1_obraVisible, r2_fotoDespuesRecomprimida, r3_soloActivaEnCriticas, r4_noGuardoSinObra, r5_headerPresupuesto, r5_arraysCompletos, r6_permisosVigentes, r7_sinDuplicados };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_obraVisible) fallas.push("BUG REPRODUCIDO: editar una observación de una obra finalizada debería conservar esa obra en el select, no dejarlo en blanco");
  if (!resultado.r2_fotoDespuesRecomprimida) fallas.push("BUG REPRODUCIDO: la migración de fotos pesadas debería cubrir también fotoDespues, no solo foto");
  if (!resultado.r3_soloActivaEnCriticas) fallas.push("BUG REPRODUCIDO: las notificaciones de observaciones críticas deberían excluir obras finalizadas");
  if (!resultado.r4_noGuardoSinObra) fallas.push("BUG REPRODUCIDO: guardarObservacionDirecta() no debería guardar con obra:'' cuando no hay obra activa");
  if (!resultado.r5_headerPresupuesto) fallas.push("BUG REPRODUCIDO: la tabla de usuarios/permisos debería tener una columna de encabezado 'Presupuesto'");
  if (!resultado.r5_arraysCompletos) fallas.push("BUG REPRODUCIDO: PERMISOS_ADMIN/PERMISOS_CAPATAZ_DEFAULT/NOMBRES_MODULO deberían incluir 'presupuesto'");
  if (!resultado.r6_permisosVigentes) fallas.push("BUG REPRODUCIDO: la sesión automática del día debería usar los permisos VIGENTES, no los cacheados en localStorage");
  if (!resultado.r7_sinDuplicados) fallas.push("BUG REPRODUCIDO: el catálogo de materiales debería colapsar espacios internos repetidos para no duplicar entradas");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE OBSERVACIONES Y TRANSVERSAL (RONDA 2) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
