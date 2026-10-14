// Calculadora de Materiales -- storage de "Mi cómputo": un solo índice global
// ("calc_materiales_index"), cada ítem con su propio campo .obra. Mismo patrón que
// Recordatorios/Observaciones/Pedidos. Confirma que agregar guarda en window.storage y que
// quitar filtra solo el ítem pedido, sin tocar los demás.
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

  const tras2Agregados = await page.evaluate(async () => {
    await agregarItemComputoCalc({ id: "a1", rubro: "Mampostería", modo: "X", obra: "VARELA", parametros: {}, resultado: {}, fecha: "2026-10-14" });
    await agregarItemComputoCalc({ id: "a2", rubro: "Mampostería", modo: "Y", obra: "VARELA", parametros: {}, resultado: {}, fecha: "2026-10-14" });
    const r = await window.storage.get("calc_materiales_index", true);
    return { enMemoria: calcMaterialesItems.length, enStorage: JSON.parse(r.value).length };
  });
  if (tras2Agregados.enMemoria !== 2 || tras2Agregados.enStorage !== 2) {
    throw new Error("No se guardaron los 2 items: " + JSON.stringify(tras2Agregados));
  }

  const trasQuitarUno = await page.evaluate(async () => {
    await quitarItemComputoCalc("a1");
    return calcMaterialesItems.map((i) => i.id);
  });
  if (JSON.stringify(trasQuitarUno) !== JSON.stringify(["a2"])) {
    throw new Error("quitarItemComputoCalc no filtró bien: " + JSON.stringify(trasQuitarUno));
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-computo-storage");
})().catch((e) => { console.error(e); process.exit(1); });
