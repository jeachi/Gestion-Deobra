// Bug reportado por el usuario: la Calculadora de Materiales (data-view="calcmateriales") existe
// y funciona, pero no aparece "ni en el menú lateral ni en el del dashboard". Causa real: se
// agregó como pestaña al carrusel viejo (#carrusel-tabs), que está SIEMPRE oculto
// (.carrusel-tabs-wrap{display:none} -- solo sirve de fuente de datos para la navegación nueva),
// pero nunca se sumó ni a GRUPOS_MENU (el menú agrupado "Más") ni a la grilla de tarjetas
// "Módulos" del Dashboard -- así que quedaba sin ninguna forma real de llegar a ella desde la UI.
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

  await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    await irA("dashboard");
  });

  // ---- 1) Hay una tarjeta de "Módulos" en el Dashboard que lleva a la calculadora ----
  const tarjeta = await page.evaluate(() => {
    const el = document.querySelector('#view-dashboard .dash-grid.bento .dash-card[data-modulo="calcmateriales"]');
    return el ? { titulo: el.querySelector(".dash-card-title")?.textContent } : null;
  });
  if (!tarjeta) throw new Error("BUG: no hay ninguna tarjeta de 'Módulos' en el Dashboard para la Calculadora de Materiales.");

  await page.click('#view-dashboard .dash-grid.bento .dash-card[data-modulo="calcmateriales"]');
  const vistaTrasTarjeta = await page.evaluate(() => vistaActualNexo);
  if (vistaTrasTarjeta !== "calcmateriales") throw new Error("BUG: tocar la tarjeta del Dashboard debería llevar a la calculadora, llevó a: " + vistaTrasTarjeta);

  // ---- 2) Aparece también en el menú agrupado ("Más") ----
  await page.evaluate(() => irA("dashboard"));
  await page.evaluate(() => abrirMenuAgrupado());
  const itemMenu = await page.evaluate(() => {
    const el = document.querySelector('#menu-agrupado-grupos .menu-item[data-view="calcmateriales"]');
    return el ? el.textContent.trim() : null;
  });
  if (!itemMenu) throw new Error("BUG: la Calculadora de Materiales debería aparecer en el menú agrupado ('Más').");
  if (!itemMenu.includes("Calculadora")) throw new Error("BUG: el texto del ítem del menú no parece ser el de la calculadora: " + itemMenu);

  await page.click('#menu-agrupado-grupos .menu-item[data-view="calcmateriales"]');
  const vistaTrasMenu = await page.evaluate(() => vistaActualNexo);
  if (vistaTrasMenu !== "calcmateriales") throw new Error("BUG: tocar el ítem del menú agrupado debería llevar a la calculadora, llevó a: " + vistaTrasMenu);

  // ---- 3) Se puede ocultar/mostrar desde "Módulos del Dashboard" como cualquier otro módulo ----
  const checkboxExiste = await page.evaluate(async () => {
    await irA("trabajadores");
    cambiarVistaConfig("personalizacion");
    renderDashModulosToggleList();
    const labels = [...document.querySelectorAll("#dash-modulos-toggle-list label")];
    return labels.some(l => l.textContent.includes("Calculadora"));
  });
  if (!checkboxExiste) throw new Error("BUG: 'Calculadora de Materiales' debería poder activarse/desactivarse desde Configuración → Personalización → Módulos del Dashboard.");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-calcmateriales-visible-en-menus");
})().catch((e) => { console.error(e); process.exit(1); });
