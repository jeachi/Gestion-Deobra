// Calculadora de Materiales PR3 -- formularios de Techo, Malla electrosoldada y Losa de
// viguetas: cada uno calcula en vivo y agregar al computo guarda el item con los materiales
// esperados.
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

  // ---- Techo ----
  await page.evaluate(() => abrirCalcTecho());
  await page.fill("#calc-techo-ancho", "5");
  await page.fill("#calc-techo-largoagua", "6");
  await page.fill("#calc-techo-largochapa", "6");
  const techoTxt = await page.evaluate(() => document.getElementById("calc-techo-resultado").textContent);
  // Desperdicio 5% por defecto: ceil(7*1*1.05) = ceil(7.35) = 8.
  if (!/^.*8.*chapas/s.test(techoTxt.replace(/\s+/g, " "))) throw new Error("Techo no calculó 8 chapas (desperdicio 5% por defecto): " + techoTxt);
  await page.evaluate(() => calcTechoAgregarAComputo());
  const itemTecho = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemTecho.rubro !== "Techo" || !itemTecho.resultado["Chapas"]) throw new Error("Item de Techo mal formado: " + JSON.stringify(itemTecho));

  // ---- Malla electrosoldada ----
  await page.evaluate(() => abrirCalcMalla());
  await page.fill("#calc-malla-ancho", "10");
  await page.fill("#calc-malla-largo", "5");
  const mallaTxt = await page.evaluate(() => document.getElementById("calc-malla-resultado").textContent);
  if (!/^.*6.*paneles/s.test(mallaTxt.replace(/\s+/g, " "))) throw new Error("Malla no calculó 6 paneles: " + mallaTxt);
  await page.evaluate(() => calcMallaAgregarAComputo());
  const itemMalla = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemMalla.rubro !== "Malla electrosoldada" || !itemMalla.resultado["Paneles"]) throw new Error("Item de Malla mal formado: " + JSON.stringify(itemMalla));

  // ---- Losa de viguetas y ladrillos ----
  await page.evaluate(() => abrirCalcLosa());
  await page.fill("#calc-losa-ancho", "4");
  await page.fill("#calc-losa-largo", "5");
  const losaTxtH16 = await page.evaluate(() => document.getElementById("calc-losa-resultado").textContent);
  if (!/^.*9.*viguetas/s.test(losaTxtH16.replace(/\s+/g, " "))) throw new Error("Losa (h=16 por defecto) no calculó 9 viguetas: " + losaTxtH16);
  await page.evaluate(() => calcLosaElegirModo("telgopor"));
  await page.evaluate(() => calcLosaElegirAltura("12"));
  const losaTxtH12 = await page.evaluate(() => document.getElementById("calc-losa-resultado").textContent);
  if (!/^.*11.*viguetas/s.test(losaTxtH12.replace(/\s+/g, " "))) throw new Error("Losa h=12 no recalculó a 11 viguetas: " + losaTxtH12);
  await page.evaluate(() => calcLosaAgregarAComputo());
  const itemLosa = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemLosa.rubro !== "Losa de viguetas y ladrillos" || !/telgopor/i.test(itemLosa.modo)) throw new Error("Item de Losa mal formado: " + JSON.stringify(itemLosa));

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-techo-malla-losa");
})().catch((e) => { console.error(e); process.exit(1); });
