// Ronda 4 de auditoría -- PDF de contratistas: el pie "Hoja X de Y" estaba hardcodeado a "de 2" sin
// importar cuántas hojas tuviera el PDF real (1 si es "solo resumen", 3 si lleva plano adjunto).
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

    const c = {
      id: "cUno", nombre: "Contratista Uno", obra: "ObraTest",
      montoContrato: 1000000, anticipoMonto: 0, m2Total: 0,
      items: [{ id: "it1", nombre: "Item único", pctIncidencia: 100 }],
      certificados: [{ numero: 1, nombre: "CERTIFICADO 1", fecha: "2026-01-01", avances: { it1: 0.5 } }],
    };
    contratistasCache = { cUno: c };

    // ---- 1) "Solo resumen" (1 hoja) ----
    let htmlModal = null;
    window.mostrarModalPDF = (html) => { htmlModal = html; };
    descargarPDFResumenContratista("cUno");
    const r1_diceHoja1de1 = /Hoja 1 de 1/.test(htmlModal);
    const r1_noDiceDe2 = !/Hoja 1 de 2/.test(htmlModal);

    // ---- 2) Certificado SIN plano adjunto (2 hojas: resumen + certificado) ----
    htmlModal = null;
    await verCertificadoPDF("cUno", 0);
    const r2_resumenDiceDe2 = /Hoja 1 de 2/.test(htmlModal);
    const r2_certDiceDe2 = /Hoja 2 de 2/.test(htmlModal);

    // ---- 3) Certificado CON plano adjunto (3 hojas) ----
    c.certificados[0].planoImagenSnapshot = "data:image/png;base64,xxx";
    window.medirDimensionesImagen = async () => ({ width: 100, height: 50 });
    htmlModal = null;
    await verCertificadoPDF("cUno", 0);
    const r3_resumenDiceDe3 = /Hoja 1 de 3/.test(htmlModal);
    const r3_certDiceDe3 = /Hoja 2 de 3/.test(htmlModal);
    const r3_planoDiceDe3 = /Hoja 3 de 3/.test(htmlModal);
    const r3_noDiceDe2 = !/de 2/.test(htmlModal);

    return { r1_diceHoja1de1, r1_noDiceDe2, r2_resumenDiceDe2, r2_certDiceDe2, r3_resumenDiceDe3, r3_certDiceDe3, r3_planoDiceDe3, r3_noDiceDe2 };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_diceHoja1de1) fallas.push("BUG REPRODUCIDO: 'Solo resumen' (1 hoja) debería decir 'Hoja 1 de 1'");
  if (!resultado.r1_noDiceDe2) fallas.push("BUG REPRODUCIDO: 'Solo resumen' no debería decir 'Hoja 1 de 2'");
  if (!resultado.r2_resumenDiceDe2) fallas.push("El resumen dentro de un PDF de 2 hojas debería decir 'Hoja 1 de 2'");
  if (!resultado.r2_certDiceDe2) fallas.push("El certificado dentro de un PDF de 2 hojas debería decir 'Hoja 2 de 2'");
  if (!resultado.r3_resumenDiceDe3) fallas.push("BUG REPRODUCIDO: con plano adjunto (3 hojas), el resumen debería decir 'Hoja 1 de 3'");
  if (!resultado.r3_certDiceDe3) fallas.push("BUG REPRODUCIDO: con plano adjunto (3 hojas), el certificado debería decir 'Hoja 2 de 3'");
  if (!resultado.r3_planoDiceDe3) fallas.push("BUG REPRODUCIDO: la hoja del plano debería decir 'Hoja 3 de 3'");
  if (!resultado.r3_noDiceDe2) fallas.push("Con 3 hojas reales, ninguna hoja debería decir 'de 2'");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE 'HOJA X DE Y' (RONDA 4) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
