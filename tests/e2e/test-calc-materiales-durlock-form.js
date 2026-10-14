// Calculadora de Materiales -- formulario de Pared de Durlock: arranca en 2 caras, calcula en
// vivo, y agregar al computo guarda el item con los materiales completos.
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
    abrirCalcDurlock();
  });

  await page.fill("#calc-durlock-largo", "4");
  await page.fill("#calc-durlock-alto", "2.5");
  const resultado2Caras = await page.evaluate(() => document.getElementById("calc-durlock-resultado").textContent);
  // Desperdicio por defecto 5%: ceil(20/2.88*1.05) = ceil(7.29) = 8.
  if (!/^.*8.*placas/s.test(resultado2Caras.replace(/\s+/g, " "))) throw new Error("No calculó 8 placas con 2 caras (desperdicio 5% por defecto): " + resultado2Caras);

  await page.evaluate(() => calcDurlockElegirCaras(1));
  const resultado1Cara = await page.evaluate(() => document.getElementById("calc-durlock-resultado").textContent);
  if (!/4/.test(resultado1Cara)) throw new Error("No recalculó a 4 placas con 1 cara: " + resultado1Cara);

  await page.evaluate(() => calcDurlockAgregarAComputo());
  const item = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (item.rubro !== "Pared de Durlock" || item.obra !== "VARELA" || !item.resultado["Placas"]) {
    throw new Error("El item agregado no tiene la forma esperada: " + JSON.stringify(item));
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-durlock-form");
})().catch((e) => { console.error(e); process.exit(1); });
