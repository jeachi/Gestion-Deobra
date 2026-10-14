// Calculadora de Materiales -- formulario de Cielorraso: los 3 sistemas (junta tomada, modular
// 60x60, suspendido 60x120) calculan en vivo y agregar al computo guarda el item correcto.
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
    abrirCalcCielorraso();
  });

  await page.fill("#calc-cielo-ancho", "4");
  await page.fill("#calc-cielo-largo", "5");
  const juntaTxt = await page.evaluate(() => document.getElementById("calc-cielo-resultado").textContent);
  if (!/Tornillos TN/.test(juntaTxt)) throw new Error("Junta tomada debería mostrar el terminado (Tornillos TN/cinta/masilla): " + juntaTxt);

  await page.evaluate(() => calcCieloElegirModo("modular"));
  const modularTxt = await page.evaluate(() => document.getElementById("calc-cielo-resultado").textContent);
  if (/Tornillos TN/.test(modularTxt)) throw new Error("Modular 60x60 no debería mostrar terminado: " + modularTxt);
  if (!/paneles 60x60/.test(modularTxt)) throw new Error("Modular no muestra 'paneles 60x60': " + modularTxt);

  await page.evaluate(() => calcCieloElegirModo("suspendido"));
  const suspendidoTxt = await page.evaluate(() => document.getElementById("calc-cielo-resultado").textContent);
  if (!/paneles 60x120/.test(suspendidoTxt)) throw new Error("Suspendido no muestra 'paneles 60x120': " + suspendidoTxt);

  await page.evaluate(() => calcCieloAgregarAComputo());
  const item = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (item.rubro !== "Cielorraso" || item.modo !== "Suspendido 60x120" || item.obra !== "VARELA") {
    throw new Error("El item agregado no tiene la forma esperada: " + JSON.stringify(item));
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-cielorraso-form");
})().catch((e) => { console.error(e); process.exit(1); });
