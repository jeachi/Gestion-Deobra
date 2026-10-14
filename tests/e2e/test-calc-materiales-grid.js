// Calculadora de Materiales -- pantalla de grilla: confirma que el tab nuevo navega a la
// vista y que la grilla muestra los 13 rubros, todos habilitados (el último, PR5, completa
// los 13 planeados en el spec) y cada uno con una función de "abrir" real definida.
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

  const estado = await page.evaluate(() => ({
    todosDisponibles: RUBROS_CALC.every((r) => r.disponible === true),
    todosConAbrirValido: RUBROS_CALC.every((r) => typeof window[r.abrir] === "function"),
    ningunaDeshabilitadaVisualmente: [...document.querySelectorAll("#calc-grid .dash-card")].every((c) => c.style.opacity === "" || c.style.opacity === "1"),
  }));
  if (!estado.todosDisponibles) throw new Error("Con el PR5 ya deberían estar los 13 rubros disponibles: " + JSON.stringify(RUBROS_CALC.filter((r) => !r.disponible)));
  if (!estado.todosConAbrirValido) throw new Error("Algún rubro disponible no tiene una función 'abrir' real definida");
  if (!estado.ningunaDeshabilitadaVisualmente) throw new Error("Alguna tarjeta todavía se ve deshabilitada (opacidad reducida)");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-grid");
})().catch((e) => { console.error(e); process.exit(1); });
