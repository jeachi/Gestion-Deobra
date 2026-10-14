// Calculadora de Materiales PR5 (final) -- formularios de Contrapiso/Hormigon, Piso ceramico,
// Revoque y Aislacion termica: cada uno calcula en vivo y agregar al computo guarda el item con
// los materiales esperados. Con este PR quedan los 13 rubros del spec disponibles.
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

  // ---- Contrapiso / Hormigón ----
  await page.evaluate(() => abrirCalcContrapiso());
  await page.fill("#calc-contrapiso-ancho", "5");
  await page.fill("#calc-contrapiso-largo", "4");
  const contrapisoTxt = await page.evaluate(() => document.getElementById("calc-contrapiso-resultado").textContent);
  if (!/^.*1\.6.*m³/s.test(contrapisoTxt.replace(/\s+/g, " "))) throw new Error("Contrapiso no calculó 1.6 m³: " + contrapisoTxt);
  await page.evaluate(() => calcContrapisoAgregarAComputo());
  const itemContrapiso = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemContrapiso.rubro !== "Contrapiso / Hormigón" || !itemContrapiso.resultado["Cemento"]) throw new Error("Item de Contrapiso mal formado: " + JSON.stringify(itemContrapiso));

  // ---- Piso cerámico ----
  await page.evaluate(() => abrirCalcPiso());
  await page.fill("#calc-piso-ancho", "5");
  await page.fill("#calc-piso-largo", "4");
  const pisoTxt = await page.evaluate(() => document.getElementById("calc-piso-resultado").textContent);
  if (!/^.*16.*cajas/s.test(pisoTxt.replace(/\s+/g, " "))) throw new Error("Piso cerámico no calculó 16 cajas: " + pisoTxt);
  await page.evaluate(() => calcPisoAgregarAComputo());
  const itemPiso = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemPiso.rubro !== "Piso cerámico" || !itemPiso.resultado["Pastina"]) throw new Error("Item de Piso cerámico mal formado: " + JSON.stringify(itemPiso));

  // ---- Revoque ----
  await page.evaluate(() => abrirCalcRevoque());
  await page.fill("#calc-revoque-ancho", "5");
  await page.fill("#calc-revoque-alto", "2.5");
  const revoqueGruesoTxt = await page.evaluate(() => document.getElementById("calc-revoque-resultado").textContent);
  await page.evaluate(() => calcRevoqueElegirTipo("fino"));
  const revoqueFinoTxt = await page.evaluate(() => document.getElementById("calc-revoque-resultado").textContent);
  if (revoqueGruesoTxt === revoqueFinoTxt) throw new Error("Revoque fino debería dar un resultado distinto al grueso");
  await page.evaluate(() => calcRevoqueAgregarAComputo());
  const itemRevoque = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemRevoque.rubro !== "Revoque" || itemRevoque.modo !== "Fino" || !itemRevoque.resultado["Cal"]) throw new Error("Item de Revoque mal formado: " + JSON.stringify(itemRevoque));

  // ---- Aislación térmica ----
  await page.evaluate(() => abrirCalcAislacion());
  await page.fill("#calc-aislacion-ancho", "5");
  await page.fill("#calc-aislacion-largo", "4");
  const aislacionTxt = await page.evaluate(() => document.getElementById("calc-aislacion-resultado").textContent);
  if (!/^.*2.*rollos/s.test(aislacionTxt.replace(/\s+/g, " "))) throw new Error("Aislación térmica no calculó 2 rollos: " + aislacionTxt);
  await page.evaluate(() => calcAislacionAgregarAComputo());
  const itemAislacion = await page.evaluate(() => calcMaterialesItems[calcMaterialesItems.length - 1]);
  if (itemAislacion.rubro !== "Aislación térmica" || !itemAislacion.resultado["Rollos / placas"]) throw new Error("Item de Aislación térmica mal formado: " + JSON.stringify(itemAislacion));

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calc-materiales-contrapiso-piso-revoque-aislacion");
})().catch((e) => { console.error(e); process.exit(1); });
