// Calculadora de Materiales -- formulario de Mampostería: arranca en hormigón/20x20x40,
// calcula en vivo al tipear, y al cambiar de tipo conserva el largo/alto ya tipeados (solo
// tipo/formato/rendimiento se resetean).
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
  const piezasHormigon = await page.evaluate(() => document.getElementById("calc-mamp-resultado").textContent);
  // Desperdicio por defecto 5%: ceil(8*2.5*12.5*1.05) = ceil(262.5) = 263.
  if (!/263/.test(piezasHormigon)) throw new Error("No calculó 263 piezas con hormigón 20x20x40 (desperdicio 5% por defecto): " + piezasHormigon);

  await page.evaluate(() => calcMampElegirTipo("hueco"));
  const [usoTipico, largoSigue, altoSigue] = await page.evaluate(() => [
    document.getElementById("prompt-generico-cuerpo").textContent,
    document.getElementById("calc-mamp-largo").value,
    document.getElementById("calc-mamp-alto").value,
  ]);
  if (!/NO portantes/.test(usoTipico)) throw new Error("No cambió el texto de uso típico a hueco: " + usoTipico);
  if (largoSigue !== "8" || altoSigue !== "2.5") throw new Error(`largo/alto no sobrevivieron el cambio de tipo: largo=${largoSigue} alto=${altoSigue}`);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-mamposteria-form");
})().catch((e) => { console.error(e); process.exit(1); });
