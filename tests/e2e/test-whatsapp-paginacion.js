// El PDF real que el usuario compartió por WhatsApp seguía saliendo en UNA sola hoja con todo
// achicado, a pesar del arreglo anterior (que solo resolvía el "Permission denied" al armar el
// ancho del iframe, pero enviarPorWhatsapp() seguía capturando TODO el informe como una sola
// imagen y metiéndola en una sola hoja de PDF, sin importar la paginación real en A4).
// Este test verifica el arreglo de fondo: para reportes con usarA4Real, enviarPorWhatsapp() debe
// capturar cada bloque de primer nivel por separado y repartirlos en tantas hojas A4 como haga
// falta -- nunca cortando un bloque a la mitad entre una hoja y la siguiente.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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
    // 30 observaciones en 10 días distintos -- bastante como para que, si todo se metiera en una
    // sola hoja A4, cada bloque terminaría aplastado a una fracción de su tamaño real.
    observaciones = [];
    for (let d = 1; d <= 10; d++) {
      for (let i = 0; i < 3; i++) {
        observaciones.push({
          id: `o${d}_${i}`, titulo: `Observación ${d}-${i}`, obra: "ObraTest", prioridad: "media",
          estado: "resuelto", fecha: `2026-06-${String(d).padStart(2, "0")}`,
          foto: "data:image/png;base64,ANTES", fotoDespues: "data:image/png;base64,DESPUES",
        });
      }
    }
    errorCargaObservaciones = false;
    irA("observaciones");
    cambiarVistaPendientes("observaciones");
    document.getElementById("obs-filtro-obra").innerHTML = `<option value="">Todas las obras</option>`;
    document.getElementById("obs-informe-agrupar-dia").checked = true;
  });

  const resultado = await page.evaluate(() => {
    return new Promise((resolve) => {
      let capturadoHtml = null;
      window.mostrarModalPDF = (html) => { capturadoHtml = html; };
      generarInformeFotograficoObservacionesPDF();
      htmlPdfActual = capturadoHtml;
      forzarA4EstandarPdf = true;
      orientacionPdfActual = "portrait";

      // Stub de html2canvas: devuelve un canvas "falso" cuyo tamaño depende de cuántas <tr> tiene
      // el bloque capturado -- así se puede distinguir un bloque de observación (con foto+texto,
      // más alto) de un bloque de encabezado/título de día (más chico), sin depender del layout
      // real del navegador (que igual no puede cargar el logo/fuentes externas en este sandbox).
      window.html2canvas = async (el) => {
        const esObservacion = !!el.querySelector("td[width='96']");
        const canvas = document.createElement("canvas");
        canvas.width = 1400; // 700px de ancho real x escala 2
        // Alturas medidas de verdad en el navegador (ver medir-alturas-reales.js) con el diseño
        // compacto: ~84px una fila de observación, ~20px un título de día.
        canvas.height = (esObservacion ? 84 : 20) * 2;
        return canvas;
      };

      const paginasCreadas = [];
      let paginaActual = null;
      window.jspdf = {
        jsPDF: function (opts) {
          paginaActual = { imagenes: [], opts };
          paginasCreadas.push(paginaActual);
          this.addPage = () => { paginaActual = { imagenes: [] }; paginasCreadas.push(paginaActual); };
          this.addImage = (_data, _fmt, x, y, w, h) => { paginaActual.imagenes.push({ x, y, w, h }); };
          this.output = () => new Blob();
          this.internal = { getNumberOfPages: () => paginasCreadas.length };
        },
      };
      navigator.share = async () => {};
      navigator.canShare = () => true;

      enviarPorWhatsapp().catch((e) => { resolve({ error: e.message }); }).then(() => {
        resolve({
          cantidadHojas: paginasCreadas.length,
          imagenesPorHoja: paginasCreadas.map(p => p.imagenes.length),
          // Ninguna hoja debería tener una imagen que se salga del alto útil de una A4 (aprox
          // 831pt de alto útil en portrait con 5mm de margen) -- eso indicaría que se intentó
          // meter un bloque más alto que la hoja entera, señal de que algo se está sumando mal.
          algunaImagenFueraDeHoja: paginasCreadas.some(p => p.imagenes.some(im => im.y + im.h > 841.89)),
        });
      });
    });
  });

  console.log("Resultado:", JSON.stringify(resultado, null, 2));
  console.log("Errores de página:", JSON.stringify(pageErrors));

  const fallas = [];
  if (resultado.error) fallas.push("enviarPorWhatsapp() tiró un error: " + resultado.error);
  else {
    // Con el diseño compacto, 30 observaciones (~63pt cada una) + 10 títulos de día (~15pt) suman
    // ~2040pt -- en una hoja A4 de ~813pt de alto útil, entran en 3 hojas (ver
    // medir-alturas-reales.js para la medición real en el navegador). Si el arreglo de paginación
    // no estuviera, cantidadHojas sería 1 (todo achicado en una sola hoja gigante).
    if (resultado.cantidadHojas <= 1) fallas.push(`BUG REPRODUCIDO: todo el informe se metió en ${resultado.cantidadHojas} hoja -- sigue siendo la "hoja única gigante" que reportó el usuario`);
    if (resultado.cantidadHojas > 4) fallas.push(`El diseño compacto debería entrar en pocas hojas (~3), pero dio ${resultado.cantidadHojas} -- revisar si el diseño se agrandó de nuevo`);
    if (resultado.algunaImagenFueraDeHoja) fallas.push("Alguna imagen quedó posicionada fuera del alto útil de su hoja A4");
    // Ninguna hoja debería quedar vacía (0 imágenes) en el medio del recorrido.
    const hojaVaciaEnElMedio = resultado.imagenesPorHoja.slice(0, -1).some(n => n === 0);
    if (hojaVaciaEnElMedio) fallas.push(`Alguna hoja quedó vacía en el medio: ${JSON.stringify(resultado.imagenesPorHoja)}`);
  }
  if (pageErrors.length) fallas.push(`${pageErrors.length} error(es) de página sin atrapar`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PAGINACIÓN REAL EN 'ENVIAR POR WHATSAPP' OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
