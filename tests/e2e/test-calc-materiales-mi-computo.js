// Calculadora de Materiales -- pantalla "Mi cómputo": agrega un item real desde el
// formulario de Mampostería, confirma que aparece en Mi cómputo, lo borra desde ahí y
// confirma que vuelve al estado vacío.
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
    abrirCalcMamposteria();
  });
  await page.fill("#calc-mamp-largo", "8");
  await page.fill("#calc-mamp-alto", "2.5");
  await page.evaluate(() => calcMampAgregarAComputo());
  await page.waitForFunction(() => calcMaterialesItems.length === 1);

  await page.evaluate(() => abrirMiComputoCalc());
  const muestraMamposteria = await page.evaluate(() => document.getElementById("prompt-generico-cuerpo").textContent);
  if (!/Mampostería/.test(muestraMamposteria)) throw new Error("Mi cómputo no muestra el item agregado: " + muestraMamposteria);

  const idABorrar = await page.evaluate(() => calcMaterialesItems[0].id);
  await page.evaluate((id) => quitarItemComputoCalcUI(id), idABorrar);
  const vacio = await page.evaluate(() => document.getElementById("prompt-generico-cuerpo").textContent);
  if (!/todavía no agregaste/i.test(vacio)) throw new Error("No volvió al estado vacío tras borrar: " + vacio);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-mi-computo");
})().catch((e) => { console.error(e); process.exit(1); });
