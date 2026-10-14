// Pedido del usuario: "también quiero el botón de reporte en la parte de afuera donde está el
// compartir avance, ese se puede colocar allí también" -- el botón "REPORTE" (PDF con tabla de %
// por actividad) solo vivía DENTRO del editor completo del plano. Ahora también hay un botón
// "🧾 Reporte PDF" en la Vista rápida (modo lectura), al lado de "📤 Compartir avance".
//
// El riesgo real: generarReportePlanoAvancePDF() arma la imagen del plano leyendo directo el
// <canvas id="canvas-plano">, que solo queda dimensionado/pintado cuando se entra al editor
// completo (iniciarCanvas()) -- en Vista rápida ese canvas nunca se tocó y queda en su tamaño por
// defecto (300x150, en blanco). generarReporteDesdeVistaRapida() tiene que dimensionarlo y
// pintarlo a mano antes de llamar al generador de PDF, o el reporte sale con una imagen diminuta/
// vacía en vez del plano real.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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

  await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });

    function imgFalsa(){ const c=document.createElement("canvas"); c.width=800;c.height=600; const cx=c.getContext("2d"); cx.fillStyle="#eee"; cx.fillRect(0,0,800,600); return c.toDataURL("image/png"); }
    const plano = { id:"pl1", nombre:"Plano 1", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([plano]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${plano.id}`, imgFalsa(), true);
    await window.storage.set(`plano_avance_textos_VARELA_${plano.id}`, JSON.stringify([
      { x: 150, y: 150, tipo: "numero", valor: "1x1", unidad: "m", cantidad: 1, categoria: "Ventana", codigo: "V1", estado: "pendiente" },
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1");
    await new Promise(r=>setTimeout(r, 300));
    // A propósito NO se llama a entrarAEditarPlano() -- el botón debe funcionar estando TODAVÍA
    // en la Vista rápida, sin haber pasado nunca por el editor completo (que es justo lo que
    // dimensiona el canvas en el flujo normal).
  });

  // ---- 1) El botón existe en Vista rápida, al lado de "Compartir avance" ----
  const r1 = await page.evaluate(() => {
    const btnReporte = document.getElementById("vr-btn-reporte");
    const btnCompartir = document.getElementById("vr-btn-compartir");
    return {
      existe: !!btnReporte,
      visible: btnReporte && btnReporte.offsetParent !== null,
      estaCercaDeCompartir: btnReporte && btnCompartir && btnReporte.previousElementSibling === btnCompartir,
      canvasEnBlancoAntes: document.getElementById("canvas-plano").width === 300 && document.getElementById("canvas-plano").height === 150,
    };
  });
  console.log("1) Botón de reporte en Vista rápida:", JSON.stringify(r1));

  // ---- 2) Tocarlo abre la vista previa del PDF con la imagen REAL del plano (no en blanco/chica) ----
  await page.evaluate(() => generarReporteDesdeVistaRapida());
  const r2 = await page.evaluate(() => {
    const modalAbierto = document.getElementById("pdf-modal").style.display === "flex";
    const canvas = document.getElementById("canvas-plano");
    // El reporte también mete el logo de la empresa como <img> PNG en el encabezado -- la imagen
    // DEL PLANO en sí se genera siempre como JPEG (imagenCanvasParaReporte usa toDataURL("image/jpeg",...)),
    // así que filtrar por eso evita confundirla con el logo.
    const img = [...document.querySelectorAll("#pdf-preview-content img")].find(i => i.src.startsWith("data:image/jpeg"));
    return {
      modalAbierto,
      canvasDimensionadoAlPlanoReal: canvas.width === 800 && canvas.height === 600,
      hayImagenEnElPreview: !!img,
      anchoImagenPreview: img ? img.naturalWidth : 0,
    };
  });
  console.log("2) Vista previa del reporte:", JSON.stringify(r2));
  await page.evaluate(() => cerrarModalPDF());

  console.log("Resultado:", JSON.stringify({ r1, r2 }, null, 2));

  const fallas = [];
  if (!r1.existe) fallas.push("1) BUG: no existe el botón \"Reporte PDF\" en la Vista rápida");
  if (!r1.visible) fallas.push("1) BUG: el botón \"Reporte PDF\" existe pero no está visible en la Vista rápida");
  if (!r1.estaCercaDeCompartir) fallas.push("1) BUG: el botón de reporte no quedó al lado de \"Compartir avance\"");
  if (!r1.canvasEnBlancoAntes) fallas.push("1) BUG EN EL TEST: el canvas ya estaba dimensionado antes de tocar el botón -- no se está probando el caso real");

  if (!r2.modalAbierto) fallas.push("2) BUG: tocar \"Reporte PDF\" desde Vista rápida no abrió la vista previa del PDF");
  if (!r2.canvasDimensionadoAlPlanoReal) fallas.push("2) BUG: el canvas no se dimensionó al tamaño real del plano antes de generar el reporte -- saldría con la imagen chica/en blanco");
  if (!r2.hayImagenEnElPreview) fallas.push("2) BUG: la vista previa del reporte no tiene ninguna imagen del plano");
  if (r2.anchoImagenPreview < 500) fallas.push(`2) BUG: la imagen del plano en el reporte es demasiado chica (ancho=${r2.anchoImagenPreview}) -- probablemente salió del canvas sin dimensionar`);

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL REPORTE DESDE VISTA RÁPIDA OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
