// Bug real encontrado en auditoría: "Enviar por WhatsApp" de la Nómina (Asistencia) dibujaba TODO
// el plantel escalado para entrar en una sola hoja A4 apaisada -- con un plantel de 15-20+
// trabajadores, el "factor" de escala (que dependía también del ALTO, es decir de cuántas filas
// había) se volvía tan chico que el texto quedaba directamente ilegible. Imprimir/Guardar como PDF
// (que usa la paginación nativa del navegador) funcionaba bien.
// El fix pagina la grilla por FILAS en tantas hojas A4 reales como hagan falta, con el encabezado
// repetido en cada una, y el factor de escala sale SOLO del ancho (fijo, no depende de cuántos
// trabajadores haya).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message + "\n" + (e.stack || "")));

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

  // Arma un stub de jsPDF que registra cada llamada de texto/rect junto con la hoja (página) en la
  // que ocurrió, para poder verificar: (a) cuántas hojas salieron, (b) que el encabezado se repite
  // en cada una, (c) que ningún trazo se sale del alto útil de una A4 apaisada, y (d) que el
  // tamaño de fuente de las celdas de la grilla no cambia según la cantidad de trabajadores.
  async function correrEnvioWhatsapp(cantidadTrabajadores) {
    return await page.evaluate(async (n) => {
      window.html2canvas = async () => document.createElement("canvas"); // no se usa en esta ruta, solo hace falta que exista
      navigator.share = async () => {};
      navigator.canShare = () => true;

      const trabajadores_ = Array.from({ length: n }, (_, i) => ({
        id: "t" + i, nombre: "Trabajador " + (i + 1), categoria: "Oficial", obra: "ObraTest", estado: "Activo",
      }));
      trabajadores = trabajadores_;
      const anio = 2026, mes = 6;
      const claveMes = "2026-06";
      asistenciaCache[claveMes] = {};
      trabajadores_.forEach(t => { asistenciaCache[claveMes][t.id] = { obra: "ObraTest", days: { 1: "8", 2: "8", 3: "8" } }; });
      mesActual = claveMes;

      const html = construirHtmlQuincena(anio, mes, 1);
      htmlPdfActual = html;
      forzarA4EstandarPdf = false;
      orientacionPdfActual = "landscape";
      nombreArchivoPdfActual = "Nomina_test.pdf";

      const paginasCreadas = [];
      let paginaActual = null;
      const fontSizesGrilla = [];
      window.jspdf = {
        jsPDF: function (opts) {
          paginaActual = { textos: [], rects: [], opts };
          paginasCreadas.push(paginaActual);
          this.addPage = () => { paginaActual = { textos: [], rects: [] }; paginasCreadas.push(paginaActual); };
          this.setFillColor = () => {};
          this.setDrawColor = () => {};
          this.setLineWidth = () => {};
          this.setFont = () => {};
          let fontSizeActual = null;
          this.setFontSize = (s) => { fontSizeActual = s; };
          this.setTextColor = () => {};
          this.splitTextToSize = (t) => [t];
          this.text = (t, x, y) => { paginaActual.textos.push({ t, x, y, fontSize: fontSizeActual }); if (fontSizeActual && Math.abs(fontSizeActual - 6.5) < 3) fontSizesGrilla.push(fontSizeActual); };
          this.rect = (x, y, w, h) => { paginaActual.rects.push({ x, y, w, h }); };
          this.addImage = () => {};
          this.output = () => new Blob();
          this.internal = { getNumberOfPages: () => paginasCreadas.length };
        },
      };

      let error = null;
      try { await enviarPorWhatsapp(); } catch (e) { error = e.message; }

      return {
        error,
        cantidadHojas: paginasCreadas.length,
        textosPorHoja: paginasCreadas.map(p => p.textos.length),
        algunTextoFueraDeHoja: paginasCreadas.some(p => p.textos.some(t => t.y > 595.28 || t.y < 0)),
        textosFueraDeHoja: paginasCreadas.flatMap((p, idx) => p.textos.filter(t => t.y > 595.28 || t.y < 0).map(t => ({ hoja: idx, ...t }))),
        // El encabezado ("Nombre" es literal en cada th) debería repetirse en cada hoja.
        hojasConEncabezado: paginasCreadas.filter(p => p.textos.some(t => t.t === "Nombre")).length,
        // El tamaño de letra de las celdas de la grilla (6.5*factor, factor solo depende del ancho).
        tamañosDeFuenteGrilla: [...new Set(fontSizesGrilla.map(f => Math.round(f * 100) / 100))],
      };
    }, cantidadTrabajadores);
  }

  const resultadoChico = await correrEnvioWhatsapp(3);
  console.log("Plantel chico (3 trabajadores):", JSON.stringify(resultadoChico, null, 2));

  // Un plantel bien grande, muy por encima de lo que entra en una sola hoja A4 apaisada legible
  // (con el ancho de columnas de esta quincena, ~39 filas ya llenan una hoja entera).
  const resultadoGrande = await correrEnvioWhatsapp(60);
  console.log("Plantel grande (60 trabajadores):", JSON.stringify(resultadoGrande, null, 2));

  const fallas = [];
  if (resultadoChico.error) fallas.push("Con plantel chico, enviarPorWhatsapp() tiró un error: " + resultadoChico.error);
  if (resultadoGrande.error) fallas.push("Con plantel grande, enviarPorWhatsapp() tiró un error: " + resultadoGrande.error);

  if (resultadoChico.cantidadHojas !== 1) fallas.push(`Con 3 trabajadores debería entrar en 1 sola hoja, dio ${resultadoChico.cantidadHojas}`);
  if (resultadoGrande.cantidadHojas <= 1) fallas.push(`BUG REPRODUCIDO: con 60 trabajadores, toda la nómina se metió en ${resultadoGrande.cantidadHojas} hoja -- sigue siendo la "hoja única aplastada"`);
  if (resultadoGrande.algunTextoFueraDeHoja) fallas.push("Algún texto quedó dibujado fuera del alto útil de su hoja A4");
  if (resultadoGrande.hojasConEncabezado !== resultadoGrande.cantidadHojas) fallas.push(`El encabezado de columnas debería repetirse en las ${resultadoGrande.cantidadHojas} hojas, solo apareció en ${resultadoGrande.hojasConEncabezado}`);

  const mismosTamaños = JSON.stringify(resultadoChico.tamañosDeFuenteGrilla.sort()) === JSON.stringify(resultadoGrande.tamañosDeFuenteGrilla.sort());
  if (!mismosTamaños) {
    fallas.push(`BUG REPRODUCIDO: el tamaño de letra de la grilla no debería depender de cuántos trabajadores hay (el factor de escala sale solo del ancho) -- chico=${JSON.stringify(resultadoChico.tamañosDeFuenteGrilla)}, grande=${JSON.stringify(resultadoGrande.tamañosDeFuenteGrilla)}`);
  }

  if (pageErrors.length) fallas.push(`${pageErrors.length} error(es) de página sin atrapar: ${JSON.stringify(pageErrors)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PAGINACIÓN DE NÓMINA POR WHATSAPP OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
