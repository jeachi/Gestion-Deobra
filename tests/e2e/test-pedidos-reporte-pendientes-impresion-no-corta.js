// Bug reportado por el usuario: "el informe de pendientes de pedidos al enviar e imprimir se
// cortan las cantidades que están al lado derecho en una hoja A4 en vertical". Causa real:
// imprimirPDF() mide el ancho/alto de la hoja mirando #areaImpresion (el <div> oculto, con
// display:none hasta que arranca @media print) -- un elemento sin layout siempre da scrollWidth 0,
// así que la función nunca lograba fijar el tamaño real de la hoja y caía siempre al tamaño A4 de
// respaldo (210mm). En reportes angostos eso pasaba inadvertido, pero el de Pendientes es más
// ancho que eso (950px de tabla + relleno), así que las columnas de la derecha (FALTA/UN/fecha)
// quedaban directamente fuera del papel al imprimir o guardar como PDF. El arreglo: medir desde
// #pdf-preview-content (la vista previa, que SÍ está visible en ese momento) en vez de
// #areaImpresion.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => d.accept());

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

    const pedido1 = {
      id: "p1", numero: 1, obra: "VARELA", estado: "Pendiente", tipo: "materiales",
      ingreso: { fecha: hoyISO() },
      items: [
        { desc: "Caño de hierro galvanizado roscado de 3/4 pulgada SCH40 para instalación sanitaria completa del sector de baños de planta baja", un: "m", cant: 120, entregado: 10 },
        { desc: "Cemento Portland", un: "bolsa", cant: 200, entregado: 50 },
      ],
    };
    await window.storage.set("pedidos_index_VARELA", JSON.stringify([{ id: "p1", numero: 1, obra: "VARELA", estado: "Pendiente", tipo: "materiales" }]), true);
    await window.storage.set("pedido_p1", JSON.stringify(pedido1), true);
    pedidosIndex = [{ id: "p1", numero: 1, obra: "VARELA", estado: "Pendiente", tipo: "materiales" }];
    await irA("pedidos");
    await new Promise(r => setTimeout(r, 200));
    await generarReportePendientesGeneral();
    await new Promise(r => setTimeout(r, 300));
  });

  // ---- 1) La tabla en la vista previa no se desborda de su propia hoja (950px, con margen) ----
  const medidas = await page.evaluate(() => {
    const pagina = document.querySelector("#pdf-preview-content .print-page.rgp-page");
    const tabla = pagina ? pagina.querySelector("table.rgp-tabla") : null;
    return {
      paginaScrollWidth: pagina ? pagina.scrollWidth : null,
      tablaScrollWidth: tabla ? tabla.scrollWidth : null,
    };
  });
  if (!medidas.paginaScrollWidth) throw new Error("No se pudo medir la hoja del reporte de pendientes.");
  if (medidas.tablaScrollWidth > medidas.paginaScrollWidth) {
    throw new Error("La tabla es más ancha que su propia hoja -- algo se desbordaría: " + JSON.stringify(medidas));
  }

  // ---- 2) imprimirPDF() mide el tamaño REAL del contenido (no el A4 de respaldo) y lo fija en el
  //         CSS de impresión -- antes, al medir sobre #areaImpresion (oculto), siempre caía al
  //         tamaño de respaldo de 210mm, más angosto que la hoja real, y todo lo que sobraba a la
  //         derecha quedaba fuera del papel. ----
  await page.evaluate(() => { window.print = () => {}; }); // no hay impresora real en el test
  const resultado = await page.evaluate(async () => {
    await imprimirPDF();
    const estilo = document.getElementById("estilo-orientacion-impresion");
    return estilo ? estilo.textContent : "";
  });
  if (!resultado.includes("width:1000px") && !/width:\d{3,}px !important/.test(resultado)) {
    throw new Error("BUG: imprimirPDF() no fijó un ancho de hoja acorde al contenido real (parece haber caído al A4 de respaldo): " + resultado);
  }
  if (resultado.includes("size:210.0mm 297.0mm") || resultado.includes("size:210mm 297mm")) {
    throw new Error("BUG: se usó el tamaño A4 de respaldo (210x297mm) en vez de medir la hoja real -- las columnas de la derecha quedarían cortadas: " + resultado);
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-pedidos-reporte-pendientes-impresion-no-corta");
})().catch((e) => { console.error(e); process.exit(1); });
