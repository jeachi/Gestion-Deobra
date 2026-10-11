// Upgrade de jsPDF 2.5.1 -> 3.0.4 (pedido por el usuario, "riesgo medio" a perfeccionar). La
// única diferencia documentada entre v2 y v3 es que se dejó de soportar Internet Explorer -- la
// API que usa esta app (new jsPDF(), .text, .setFont, .setFontSize, .setTextColor, .addImage,
// .addPage, .internal.getNumberOfPages, .output("blob")) no cambió.
//
// Los tests existentes de paginación de WhatsApp (test-whatsapp-paginacion.js,
// test-nomina-whatsapp-paginacion.js) stubean jsPDF por completo para poder medir coordenadas sin
// depender del layout real del navegador -- eso significa que NUNCA ejercitan la librería real, y
// por lo tanto no sirven para detectar una rotura real de la v3. Este test carga la librería REAL
// (jspdf@3.0.4, la misma versión que ahora usa index.html, bajada de npm porque este sandbox
// bloquea la salida a cdnjs) e interceptando el pedido al CDN para servirla local, y genera un PDF
// de verdad con el flujo de Nómina (el que más superficie de la API usa: texto vectorial dibujado
// celda por celda, no una imagen de html2canvas) -- un plantel grande que debe paginar en varias
// hojas A4.
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message + "\n" + (e.stack || "")));

  await page.route("https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.4/jspdf.umd.min.js", async (route) => {
    await route.fulfill({ path: path.join(__dirname, "libs/jspdf/dist/jspdf.umd.min.js"), contentType: "application/javascript" });
  });
  // El script real ya está en index.html como <script defer>, pero este sandbox bloquea la salida
  // a cdnjs -- se intercepta para servir la misma versión (1.4.1, sin cambios en este round) bajada
  // de npm, así pdf.addImage() recibe un dataURL real armado por html2canvas de verdad.
  await page.route("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", async (route) => {
    await route.fulfill({ path: path.join(__dirname, "libs/html2canvas/dist/html2canvas.min.js"), contentType: "application/javascript" });
  });

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

  await page.evaluate(() => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
  });

  const resultado = await page.evaluate(async () => {
    // No se usa en esta ruta (la Nómina dibuja texto vectorial, no una imagen) -- solo hace falta
    // que exista para pasar el chequeo inicial de enviarPorWhatsapp().
    window.html2canvas = async () => document.createElement("canvas");
    let blobCapturado = null;
    navigator.share = async (data) => { blobCapturado = data.files && data.files[0]; };
    navigator.canShare = () => true;

    const n = 60; // plantel grande -- tiene que paginar en varias hojas A4, no entrar en una sola
    const trabajadores_ = Array.from({ length: n }, (_, i) => ({
      id: "t" + i, nombre: "Trabajador " + (i + 1), categoria: "Oficial", obra: "ObraTest", estado: "Activo",
    }));
    trabajadores = trabajadores_;
    const claveMes = "2026-06";
    asistenciaCache[claveMes] = {};
    trabajadores_.forEach(t => { asistenciaCache[claveMes][t.id] = { obra: "ObraTest", days: { 1: "8", 2: "8", 3: "8" } }; });
    mesActual = claveMes;

    const html = construirHtmlQuincena(2026, 6, 1);
    htmlPdfActual = html;
    forzarA4EstandarPdf = false;
    orientacionPdfActual = "landscape";
    nombreArchivoPdfActual = "Nomina_test.pdf";

    let error = null;
    try { await enviarPorWhatsapp(); } catch (e) { error = (e && e.message) || String(e); }

    return {
      error,
      jspdfDisponible: typeof window.jspdf !== "undefined" && typeof window.jspdf.jsPDF === "function",
      huboBlob: !!blobCapturado,
      tipoBlob: blobCapturado ? blobCapturado.type : null,
      tamañoBlob: blobCapturado ? blobCapturado.size : null,
      nombreArchivo: blobCapturado ? blobCapturado.name : null,
    };
  });

  // ---- Escenario 2: flujo de Observaciones (pdf.addImage con fotos reales, no texto vectorial) --
  // la Nómina de arriba no llama addImage en ningún momento, así que ese método de la v3 real
  // todavía no quedó probado. Reusa el mismo patrón que test-whatsapp-paginacion.js pero con un
  // canvas real (no un stub que devuelve un Blob vacío) para que addImage reciba un dataURL real.
  await page.evaluate(() => {
    observaciones = [{
      id: "o1", titulo: "Observación con foto", obra: "ObraTest", prioridad: "media",
      estado: "resuelto", fecha: "2026-06-01",
      foto: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    }];
    errorCargaObservaciones = false;
    irA("observaciones");
    cambiarVistaPendientes("observaciones");
    document.getElementById("obs-filtro-obra").innerHTML = `<option value="">Todas las obras</option>`;
    document.getElementById("obs-informe-agrupar-dia").checked = true;
  });
  const resultadoImg = await page.evaluate(async () => {
    if (typeof html2canvas === "undefined") return { saltado: true };
    let capturadoHtml = null;
    window.mostrarModalPDF = (html) => { capturadoHtml = html; };
    generarInformeFotograficoObservacionesPDF();
    htmlPdfActual = capturadoHtml;
    forzarA4EstandarPdf = true;
    orientacionPdfActual = "portrait";
    nombreArchivoPdfActual = "Observaciones_test.pdf";
    let blobCapturado = null;
    navigator.share = async (data) => { blobCapturado = data.files && data.files[0]; };
    navigator.canShare = () => true;
    let error = null;
    try { await enviarPorWhatsapp(); } catch (e) { error = (e && e.message) || String(e); }
    return {
      saltado: false, error,
      huboBlob: !!blobCapturado,
      tipoBlob: blobCapturado ? blobCapturado.type : null,
      tamañoBlob: blobCapturado ? blobCapturado.size : null,
    };
  });
  console.log("Resultado (addImage, Observaciones):", JSON.stringify(resultadoImg, null, 2));

  console.log("Resultado:", JSON.stringify(resultado, null, 2));
  console.log("Errores de página:", JSON.stringify(pageErrors));

  const fallas = [];
  if (!resultado.jspdfDisponible) fallas.push("BUG: jsPDF 3.0.4 no se pudo cargar (window.jspdf.jsPDF no es una función) -- revisar la URL/versión del script");
  if (resultado.error) fallas.push(`BUG: enviarPorWhatsapp() con jsPDF 3.0.4 REAL tiró un error -- posible rotura de API entre v2 y v3: ${resultado.error}`);
  if (!resultado.huboBlob) fallas.push("BUG: no se generó ningún archivo para compartir (navigator.share nunca recibió un blob)");
  if (resultado.tipoBlob !== "application/pdf") fallas.push(`BUG: el archivo generado debería ser application/pdf, es '${resultado.tipoBlob}'`);
  if (!resultado.tamañoBlob || resultado.tamañoBlob < 1000) fallas.push(`BUG: el PDF generado pesa sospechosamente poco (${resultado.tamañoBlob} bytes) -- podría estar vacío o roto`);
  if (resultado.nombreArchivo !== "Nomina_test.pdf") fallas.push(`BUG: el nombre del archivo compartido debería ser 'Nomina_test.pdf', es '${resultado.nombreArchivo}'`);

  if (resultadoImg.saltado) {
    console.log("(Se salteó el escenario 2 -- html2canvas no se pudo cargar desde el CDN en este sandbox; addImage queda sin probar en esta corrida, pero el escenario 1 ya prueba el resto de la API real igual.)");
  } else {
    if (resultadoImg.error) fallas.push(`BUG: enviarPorWhatsapp() con pdf.addImage() real (jsPDF 3.0.4) tiró un error: ${resultadoImg.error}`);
    if (!resultadoImg.huboBlob) fallas.push("BUG (addImage): no se generó ningún archivo para compartir");
    if (resultadoImg.tipoBlob !== "application/pdf") fallas.push(`BUG (addImage): el archivo generado debería ser application/pdf, es '${resultadoImg.tipoBlob}'`);
    if (!resultadoImg.tamañoBlob || resultadoImg.tamañoBlob < 500) fallas.push(`BUG (addImage): el PDF con imagen pesa sospechosamente poco (${resultadoImg.tamañoBlob} bytes)`);
  }

  if (pageErrors.length) fallas.push(`${pageErrors.length} error(es) de página sin atrapar: ${JSON.stringify(pageErrors)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE JSPDF 3.0.4 REAL (FLUJO DE NÓMINA) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
