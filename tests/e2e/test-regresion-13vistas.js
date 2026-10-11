const { chromium } = require("playwright");

const VISTAS = [
  "asistencia", "caja", "certificados", "clima", "dashboard", "herramientas",
  "minutas", "observaciones", "pedidos", "planoavance", "presupuesto",
  "remitos", "trabajadores",
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.addInitScript(() => {
    const fakeDocs = {};
    function fakeDocRef(id) {
      return {
        async get() { const d = fakeDocs[id]; return { exists: !!d, data: () => d }; },
        async set(v) { fakeDocs[id] = v; },
        async delete() { delete fakeDocs[id]; },
      };
    }
    const fakeDb = {
      collection() {
        return {
          doc: (id) => fakeDocRef(id),
          async get() { return { docs: Object.keys(fakeDocs).map((id) => ({ id, data: () => fakeDocs[id] })) }; },
        };
      },
    };
    window.firebase = {
      initializeApp() {},
      firestore() { return fakeDb; },
      auth() { return { signInAnonymously: () => Promise.resolve() }; },
    };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const el = document.getElementById("pantalla-arranque");
    return el && el.style.display === "none";
  }, { timeout: 20000 });
  console.log("App booted.");

  for (const vista of VISTAS) {
    const before = pageErrors.length;
    await page.evaluate((v) => { try { irA(v); } catch (e) { console.error("irA(" + v + ") lanzó:", e.message); } }, vista);
    await page.waitForTimeout(150);
    const nuevos = pageErrors.slice(before);
    console.log(`irA("${vista}")`, nuevos.length ? `ERRORES: ${JSON.stringify(nuevos)}` : "OK");
  }

  if (pageErrors.length) {
    console.error("HUBO ERRORES:", JSON.stringify(pageErrors, null, 2));
    process.exit(1);
  }
  console.log("SWEEP DE 13 VISTAS OK, SIN ERRORES");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
