// Pedido del usuario: "En la rendición quisiera que se pueda ordenar también los gastos con un
// botón por la fechas antiguos a recienté o viceversa." La tabla de gastos de la rendición no
// tenía ninguna forma de reordenarse -- quedaban siempre en el orden en que se habían cargado.
// Ahora hay un botón "↑/↓ Fecha" que alterna antiguo→reciente y reciente→antiguo cada vez que se
// toca, igual que ordenar por una columna en una planilla.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    irA("caja");
    cambiarVistaCaja("nueva");
  });

  // ---- 1) Al abrir el formulario, el botón arranca en "antiguo→reciente" ----
  const labelInicial = await page.evaluate(() => document.getElementById("btn-ordenar-gastos").textContent);
  if (!labelInicial.includes("antiguo")) throw new Error("El botón debería arrancar en orden antiguo→reciente: " + labelInicial);

  // ---- 2) Cargamos gastos fuera de orden, incluida una fila sin fecha todavía ----
  await page.evaluate(() => {
    rcGastos = [
      { fecha: "2024-03-10", ticket: "", tipoCosto: "", observaciones: "B", centroCosto: "", monto: 100 },
      { fecha: "2024-01-05", ticket: "", tipoCosto: "", observaciones: "A", centroCosto: "", monto: 50 },
      { fecha: "", ticket: "", tipoCosto: "", observaciones: "SIN_FECHA", centroCosto: "", monto: 10 },
      { fecha: "2024-02-15", ticket: "", tipoCosto: "", observaciones: "C", centroCosto: "", monto: 75 },
    ];
    renderTablaGastos();
  });

  // ---- 3) Primer toque: ordena antiguo→reciente (A, C, B), la sin fecha al final ----
  const trasPrimerToque = await page.evaluate(() => {
    ordenarGastosPorFecha();
    return {
      orden: rcGastos.map(g => g.observaciones),
      label: document.getElementById("btn-ordenar-gastos").textContent,
      ordenEnTabla: [...document.querySelectorAll("#tbody-gastos-caja tr")].map(tr => tr.cells[3].querySelector("input").value),
    };
  });
  if (JSON.stringify(trasPrimerToque.orden) !== JSON.stringify(["A", "C", "B", "SIN_FECHA"])) {
    throw new Error("Orden antiguo→reciente incorrecto: " + JSON.stringify(trasPrimerToque.orden));
  }
  if (!trasPrimerToque.label.includes("reciente→antiguo")) {
    throw new Error("El label debería reflejar 'reciente→antiguo' después de alternar: " + trasPrimerToque.label);
  }
  if (JSON.stringify(trasPrimerToque.ordenEnTabla) !== JSON.stringify(["A", "C", "B", "SIN_FECHA"])) {
    throw new Error("La tabla en pantalla no refleja el nuevo orden: " + JSON.stringify(trasPrimerToque.ordenEnTabla));
  }

  // ---- 4) Segundo toque: alterna a reciente→antiguo (B, C, A), la sin fecha sigue al final ----
  const trasSegundoToque = await page.evaluate(() => {
    ordenarGastosPorFecha();
    return { orden: rcGastos.map(g => g.observaciones), label: document.getElementById("btn-ordenar-gastos").textContent };
  });
  if (JSON.stringify(trasSegundoToque.orden) !== JSON.stringify(["B", "C", "A", "SIN_FECHA"])) {
    throw new Error("Orden reciente→antiguo incorrecto: " + JSON.stringify(trasSegundoToque.orden));
  }
  if (!trasSegundoToque.label.includes("antiguo→reciente")) throw new Error("El label debería volver a 'antiguo→reciente': " + trasSegundoToque.label);

  // ---- 5) Al abrir una rendición nueva de cero, el orden vuelve a arrancar en antiguo→reciente ----
  const trasReabrir = await page.evaluate(() => {
    cambiarVistaCaja("nueva");
    return document.getElementById("btn-ordenar-gastos").textContent;
  });
  if (!trasReabrir.includes("antiguo→reciente")) throw new Error("Al reabrir el formulario debería resetear a antiguo→reciente: " + trasReabrir);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-cajachica-ordenar-gastos");
})().catch((e) => { console.error(e); process.exit(1); });
