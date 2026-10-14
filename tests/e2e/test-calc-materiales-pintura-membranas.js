// Calculadora de Materiales PR4 -- formularios de Pintura, Membrana liquida y Membrana en
// rollos: cada uno calcula en vivo (incluyendo la conversion a envases comerciales) y agregar
// al computo guarda el item con los materiales esperados.
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
    irA("calcmateriales");
  });

  // ---- Pintura ----
  await page.evaluate(() => abrirCalcPintura());
  await page.fill("#calc-pintura-ancho", "10");
  await page.fill("#calc-pintura-largo", "3");
  const pinturaTxt = await page.evaluate(() => document.getElementById("calc-pintura-resultado").textContent);
  if (!/^.*6.*litros/s.test(pinturaTxt.replace(/\s+/g, " "))) throw new Error("Pintura no calculó 6 litros (10x3, 2 manos, rend 10): " + pinturaTxt);
  await page.evaluate(() => calcPinturaAgregarAComputo());
  const itemPintura = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemPintura.rubro !== "Pintura" || !itemPintura.resultado["Litros"]) throw new Error("Item de Pintura mal formado: " + JSON.stringify(itemPintura));

  // ---- Membrana líquida ----
  await page.evaluate(() => abrirCalcMembranaLiquida());
  await page.fill("#calc-membliq-ancho", "10");
  await page.fill("#calc-membliq-largo", "3");
  const membLiqTxt = await page.evaluate(() => document.getElementById("calc-membliq-resultado").textContent);
  if (!/^.*81.*kg/s.test(membLiqTxt.replace(/\s+/g, " "))) throw new Error("Membrana líquida no calculó 81 kg: " + membLiqTxt);
  if (!/Imprimación/.test(membLiqTxt)) throw new Error("Membrana líquida debería mostrar imprimación por defecto: " + membLiqTxt);
  await page.evaluate(() => calcMembLiqAgregarAComputo());
  const itemMembLiq = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemMembLiq.rubro !== "Membrana líquida" || !itemMembLiq.resultado["Imprimación asfáltica"]) throw new Error("Item de Membrana líquida mal formado: " + JSON.stringify(itemMembLiq));

  // ---- Membrana en rollos ----
  await page.evaluate(() => abrirCalcMembranaRollos());
  await page.fill("#calc-membrollos-ancho", "5");
  await page.fill("#calc-membrollos-largo", "12");
  const membRollosTxt = await page.evaluate(() => document.getElementById("calc-membrollos-resultado").textContent);
  if (!/^.*12.*rollos/s.test(membRollosTxt.replace(/\s+/g, " "))) throw new Error("Membrana en rollos no calculó 12 rollos: " + membRollosTxt);
  await page.evaluate(() => calcMembRollosAgregarAComputo());
  const itemMembRollos = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemMembRollos.rubro !== "Membrana en rollos" || !itemMembRollos.resultado["Rollos"]) throw new Error("Item de Membrana en rollos mal formado: " + JSON.stringify(itemMembRollos));

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-pintura-membranas");
})().catch((e) => { console.error(e); process.exit(1); });
