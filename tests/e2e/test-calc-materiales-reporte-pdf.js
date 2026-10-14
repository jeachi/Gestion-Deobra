// Calculadora de Materiales -- reporte PDF: con "Mi cómputo" vacío no abre el modal (mismo
// guard que generarReporteHerramientasPDF); con un item real de Mampostería, el PDF generado
// incluye el rubro y la obra.
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

  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
  });

  const modalSigueOcultoSiVacio = await page.evaluate(() => {
    generarReporteCalcMaterialesPDF();
    return document.getElementById("pdf-modal").style.display;
  });
  if (modalSigueOcultoSiVacio === "flex") throw new Error("Abrió el PDF con Mi cómputo vacío");

  await page.evaluate(() => {
    irA("calcmateriales");
    abrirCalcMamposteria();
  });
  await page.fill("#calc-mamp-largo", "8");
  await page.fill("#calc-mamp-alto", "2.5");
  await page.evaluate(() => calcMampAgregarAComputo());
  await page.waitForFunction(() => calcMaterialesItems.length === 1);

  await page.evaluate(() => generarReporteCalcMaterialesPDF());
  const [visible, contenido] = await page.evaluate(() => [
    document.getElementById("pdf-modal").style.display,
    document.getElementById("pdf-preview-content").textContent,
  ]);
  if (visible !== "flex") throw new Error("El PDF no se mostró con un item en Mi cómputo");
  if (!/Mampostería/.test(contenido) || !/VARELA/.test(contenido)) throw new Error("El PDF no incluye rubro/obra: " + contenido);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-reporte-pdf");
})().catch((e) => { console.error(e); process.exit(1); });
