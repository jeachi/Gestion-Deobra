// Ronda 6 de auditoría -- Minutas: generarMinutaPDF() mentía éxito si el guardado quedaba pendiente.
// window.storage.set nunca rechaza -- ni siquiera si el documento no entra en Firestore por el
// límite de 1 MiB (riesgo real acá: varias firmas dibujadas como imagen base64 pueden superarlo).
// Solo encola en localStorage y devuelve {pendiente:true}. El código mostraba "Minuta guardada ✓"
// igual, sin avisar que en realidad nunca llegó (ni va a llegar, si el motivo es el tamaño) a la nube.
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
    obraPredeterminada = "ObraA";
    obras = ["ObraA", "ObraB"];
    obrasFinalizadas = [];
    minutasIndex = [];
    correlativoMinutaSiguiente = 1;
    irA("minutas");

    window.jspdf = { jsPDF: function () { this.addImage = () => {}; this.save = () => {}; this.internal = { getNumberOfPages: () => 1 }; this.output = () => new Blob(); } };
    window.mostrarModalPDF = () => {};

    document.getElementById("min-obra").value = "ObraA";
    document.getElementById("min-fecha").value = "2026-03-01";
    document.getElementById("min-contenido").value = "Minuta con firmas muy pesadas.";

    // Simulamos exactamente lo que hace window.storage.set cuando el documento no entra en
    // Firestore (o no hay conexión): nunca tira una excepción, devuelve {pendiente:true}.
    const setOriginal = window.storage.set;
    window.storage.set = async (k, v, s) => ({ key: k, value: v, shared: s, pendiente: true });

    await generarMinutaPDF();

    const r1_noDiceGuardadoSiPendiente = document.getElementById("nexo-chip-flotante-texto").textContent.includes("✓") === false;
    const r1_avisaPendiente = document.getElementById("nexo-chip-flotante").classList.contains("error");
    const r1_noQuedaEnIndiceSiPendiente = minutasIndex.length === 0;
    const r1_noAvanzaCorrelativoSiPendiente = correlativoMinutaSiguiente === 1;

    // Con el guardado funcionando de verdad, sí debe guardarse y avanzar el correlativo.
    window.storage.set = setOriginal;
    await generarMinutaPDF();
    const r2_siGuardaSiFunciona = minutasIndex.length === 1 && correlativoMinutaSiguiente === 2;

    return { r1_noDiceGuardadoSiPendiente, r1_avisaPendiente, r1_noQuedaEnIndiceSiPendiente, r1_noAvanzaCorrelativoSiPendiente, r2_siGuardaSiFunciona };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_noDiceGuardadoSiPendiente) fallas.push("BUG REPRODUCIDO: no debería mostrarse 'Minuta guardada ✓' si el guardado quedó pendiente (posible documento demasiado grande)");
  if (!resultado.r1_avisaPendiente) fallas.push("Debería mostrarse un aviso de error/pendiente cuando el guardado no llegó a Firestore");
  if (!resultado.r1_noQuedaEnIndiceSiPendiente) fallas.push("BUG: si el guardado del detalle quedó pendiente, no debería agregarse igual al índice de minutas");
  if (!resultado.r1_noAvanzaCorrelativoSiPendiente) fallas.push("BUG: si el guardado quedó pendiente, no debería consumirse un número del correlativo");
  if (!resultado.r2_siGuardaSiFunciona) fallas.push("Con el guardado funcionando de verdad, la minuta sí debería guardarse y avanzar el correlativo");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE MINUTAS -- GUARDADO PENDIENTE (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
