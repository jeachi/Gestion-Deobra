// Calculadora de Materiales -- pantalla de grilla: confirma que el tab nuevo navega a la
// vista, que la grilla muestra los 13 rubros, y que tocar uno deshabilitado avisa
// "Próximamente" sin intentar llamar a ninguna función de formulario (todavía no existe en
// este punto del PR -- se agrega en el task siguiente).
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

  const tabExiste = await page.evaluate(() => !!document.querySelector('.tab-btn[data-view="calcmateriales"]'));
  if (!tabExiste) throw new Error("No está el tab de Calculadora de Materiales");

  await page.evaluate(() => irA("calcmateriales"));
  const tarjetas = await page.evaluate(() => document.querySelectorAll("#calc-grid .dash-card").length);
  if (tarjetas !== 13) throw new Error("Se esperaban 13 tarjetas, hubo " + tarjetas);

  const toastTrasTocarDeshabilitada = await page.evaluate(() => {
    const noDisponible = [...document.querySelectorAll("#calc-grid .dash-card")].find((c) => c.style.opacity && c.style.opacity !== "1");
    noDisponible.click();
    return document.getElementById("toast").textContent;
  });
  if (!/Próximamente/.test(toastTrasTocarDeshabilitada)) throw new Error("No avisó 'Próximamente' al tocar una tarjeta deshabilitada: " + toastTrasTocarDeshabilitada);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-grid");
})().catch((e) => { console.error(e); process.exit(1); });
