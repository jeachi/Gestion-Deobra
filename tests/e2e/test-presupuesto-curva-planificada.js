// Pedido del usuario: los % cargados A FUTURO (meses por delante del "mes actual") son los que
// quiere usar como planificación, para poder ver si la obra va atrasada. No es un plan de trabajo
// aparte que se carga una vez -- es literalmente el valor que ya estaba cargando de más, congelado
// la PRIMERA vez que se guarda para un mes que todavía no llegó (fijarAcumuladoMesPresupuesto /
// confirmarNuevoMesPresupuesto). Correcciones posteriores de ESE mismo mes, una vez que ya es (o
// fue) el actual, actualizan el real pero no el plan -- así se puede comparar uno contra el otro.
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.route("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js", async (route) => {
    await route.fulfill({ path: path.join(__dirname, "libs/chartjs/dist/chart.umd.min.js"), contentType: "application/javascript" });
  });

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  // ---- 1) Cargar un mes FUTURO (por delante del mes actual) congela ese valor como plan ----
  const r1 = await page.evaluate(() => {
    obraPredeterminada = "ObraCurva";
    presupuestoItems = [
      { rubro: 1, rubroNombre: "R1", nombre: "Item A", unidad: "m2", cantidad: 10, precioConCoef: 1000, pctIncidencia: 100 },
    ];
    presupuestoMesActual = 1; // "mes actual" fijo a mano en el Mes 1
    const it = presupuestoItems[0];
    // Mes 1 (actual): avance real del 20%.
    fijarAcumuladoMesPresupuesto(it, 1, 0.20, mesActualPresupuesto());
    // Meses 2, 3 y 4 (todavía no llegaron): esto es la planificación -- "para el mes 4 espero 80%".
    fijarAcumuladoMesPresupuesto(it, 2, 0.40, mesActualPresupuesto());
    fijarAcumuladoMesPresupuesto(it, 3, 0.60, mesActualPresupuesto());
    fijarAcumuladoMesPresupuesto(it, 4, 0.80, mesActualPresupuesto());
    return it.historialMeses.map(m => ({ n: m.n, acumulado: m.acumulado, planificado: m.planificado }));
  });

  // ---- 2) Pasan los meses: el Mes 2 real termina siendo 30% (no 40% como se planificó) -- al
  // corregirlo (ya con "mes actual" en 2), el plan de ESE mes NO debe tocarse ----
  const r2 = await page.evaluate(() => {
    presupuestoMesActual = 2;
    const it = presupuestoItems[0];
    fijarAcumuladoMesPresupuesto(it, 2, 0.30, mesActualPresupuesto()); // la obra avanzó menos de lo planificado
    return it.historialMeses.map(m => ({ n: m.n, acumulado: m.acumulado, planificado: m.planificado }));
  });

  // ---- 3) La curva: "Real" solo hasta el mes actual, "Planificado" arrastrado desde que se
  // empezó a planificar, y el indicador de atrasado/adelantado ----
  const r3 = await page.evaluate(() => {
    const { puntos, maxMes, primerMesConPlan } = calcularPuntosCurvaPresupuesto();
    return { puntos, maxMes, primerMesConPlan, mesActual: mesActualPresupuesto() };
  });

  // ---- 4) "+ Certificación -- Mes N" (confirmarNuevoMesPresupuesto) también congela el plan
  // cuando el mes que se agrega queda por delante del mes actual ----
  const r4 = await page.evaluate(async () => {
    presupuestoMesActual = 2; // seguimos "en" el mes 2 -- el 5 que se agrega ahora es planificación
    document.querySelectorAll(".pg-input-mes").forEach(el => el.remove()); // limpieza por si quedó algo de otra pantalla
    const input = document.createElement("input");
    input.className = "pg-input-mes";
    input.dataset.idx = "0";
    input.value = "20"; // 20% de avance EN ese mes (no acumulado)
    document.body.appendChild(input);
    await confirmarNuevoMesPresupuesto(5);
    input.remove();
    const entrada5 = presupuestoItems[0].historialMeses.find(m => m.n === 5);
    return entrada5;
  });

  // ---- 4b) Bug encontrado al revisar esto a ojo: con "mes actual" en AUTOMÁTICO (null -- el
  // último mes cargado), guardar el MISMO mes nuevo para VARIOS ítems seguidos (como hace
  // confirmarNuevoMesPresupuesto en un solo guardado) no debía dejar a los ítems de después del
  // primero sin plan -- la propia entrada recién empujada de cada ítem no puede contar como "ya
  // cargada" para decidir si el PRÓXIMO ítem del mismo guardado está planificando o no.
  const r4b = await page.evaluate(async () => {
    presupuestoMesActual = null; // automático
    presupuestoItems = [
      { rubro: 1, rubroNombre: "R1", nombre: "Item X", unidad: "m2", cantidad: 10, precioConCoef: 1000, pctIncidencia: 50 },
      { rubro: 1, rubroNombre: "R1", nombre: "Item Y", unidad: "m2", cantidad: 10, precioConCoef: 1000, pctIncidencia: 50 },
    ];
    document.querySelectorAll(".pg-input-mes").forEach(el => el.remove());
    const inX = document.createElement("input");
    inX.className = "pg-input-mes"; inX.dataset.idx = "0"; inX.value = "15";
    const inY = document.createElement("input");
    inY.className = "pg-input-mes"; inY.dataset.idx = "1"; inY.value = "10";
    document.body.appendChild(inX); document.body.appendChild(inY);
    await confirmarNuevoMesPresupuesto(1); // primer mes de la obra -- ambos son "planificación" (no hay mes actual todavía)
    inX.remove(); inY.remove();
    return {
      x: presupuestoItems[0].historialMeses.find(m => m.n === 1),
      y: presupuestoItems[1].historialMeses.find(m => m.n === 1),
    };
  });

  // ---- 5) Abrir la curva de verdad con Chart.js disponible ----
  const r5 = await page.evaluate(() => {
    abrirCurvaPresupuesto("pct");
    const grafico = document.getElementById("curva-presupuesto-grafico");
    const huboCanvas = !!document.getElementById("curva-presupuesto-canvas");
    const instanciaCreada = !!chartCurvaPresupuesto;
    cerrarPromptGenerico();
    return { huboCanvas, instanciaCreada, chartDisponible: typeof Chart !== "undefined" };
  });

  // ---- 6) Camino de respaldo: sin Chart.js disponible, debe seguir dibujando el SVG de siempre ----
  const r6 = await page.evaluate(() => {
    const chartOriginal = window.Chart;
    delete window.Chart;
    let error = null;
    try { abrirCurvaPresupuesto("pct"); } catch (e) { error = String(e); }
    const grafico = document.getElementById("curva-presupuesto-grafico");
    const huboSvg = !!(grafico && grafico.querySelector("svg"));
    cerrarPromptGenerico();
    window.Chart = chartOriginal;
    return { error, huboSvg };
  });

  const resultado = { r1, r2, r3, r4, r4b, r5, r6 };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];

  // ---- Chequeos de (1) ----
  const m1 = r1.find(m => m.n === 1), m2v1 = r1.find(m => m.n === 2), m4v1 = r1.find(m => m.n === 4);
  if (m1.planificado !== undefined) fallas.push(`BUG: el Mes 1 (actual, real) no debería tener plan, tiene ${m1.planificado}`);
  if (Math.abs(m2v1.planificado - 0.40) > 0.001) fallas.push(`BUG: el Mes 2 (futuro al cargarlo) debería congelar plan=40%, tiene ${m2v1.planificado}`);
  if (Math.abs(m4v1.planificado - 0.80) > 0.001) fallas.push(`BUG: el Mes 4 (futuro al cargarlo) debería congelar plan=80%, tiene ${m4v1.planificado}`);

  // ---- Chequeos de (2): el real cambió, el plan NO ----
  const m2v2 = r2.find(m => m.n === 2);
  if (Math.abs(m2v2.acumulado - 0.30) > 0.001) fallas.push(`BUG: el real del Mes 2 debería quedar en 30% tras la corrección, quedó ${m2v2.acumulado}`);
  if (Math.abs(m2v2.planificado - 0.40) > 0.001) fallas.push(`BUG REAL: corregir el Mes 2 una vez que ya es el actual tocó el plan (debería seguir en 40%), quedó ${m2v2.planificado}`);

  // ---- Chequeos de (3): la curva ----
  if (r3.primerMesConPlan !== 2) fallas.push(`BUG: primerMesConPlan debería ser 2 (el primer mes con un plan congelado), dio ${r3.primerMesConPlan}`);
  const p1 = r3.puntos.find(p => p.n === 1), p2 = r3.puntos.find(p => p.n === 2);
  if (Math.abs(p1.pct - 20) > 0.01) fallas.push(`BUG: el % real del Mes 1 debería ser 20%, dio ${p1.pct}`);
  if (Math.abs(p2.pct - 30) > 0.01) fallas.push(`BUG: el % real del Mes 2 debería ser 30% (lo corregido), dio ${p2.pct}`);
  if (Math.abs(p2.pctPlan - 40) > 0.01) fallas.push(`BUG: el % planificado del Mes 2 debería seguir en 40%, dio ${p2.pctPlan}`);

  // ---- Chequeos de (4): confirmarNuevoMesPresupuesto también congela el plan ----
  if (!r4) fallas.push("BUG: confirmarNuevoMesPresupuesto no creó la entrada del Mes 5");
  else if (r4.planificado === undefined) fallas.push("BUG: agregar un mes por delante del actual vía '+ Certificación' no congeló el plan");

  // ---- Chequeos de (4b): el bug real -- varios ítems del MISMO mes nuevo, en modo automático ----
  if (!r4b.x || r4b.x.planificado === undefined) fallas.push("BUG: el primer ítem del guardado no congeló plan");
  if (!r4b.y || r4b.y.planificado === undefined) fallas.push("BUG REAL: el SEGUNDO ítem del mismo guardado no congeló plan -- el mes actual automático se corrió con el guardado del primer ítem");

  // ---- Chequeos de (5) y (6): la curva abre sin romper, con Chart.js y con el SVG de respaldo ----
  if (!r5.chartDisponible) fallas.push("BUG: Chart.js no se pudo cargar (revisar el route de este test)");
  if (!r5.huboCanvas) fallas.push("BUG: con Chart.js disponible, la curva no armó el canvas");
  if (!r5.instanciaCreada) fallas.push("BUG: con Chart.js disponible, no quedó una instancia de chartCurvaPresupuesto");
  if (r6.error) fallas.push(`BUG: sin Chart.js disponible, abrir la curva tira un error en vez de caer al SVG: ${r6.error}`);
  if (!r6.huboSvg) fallas.push("BUG: sin Chart.js disponible, la curva no cayó al SVG de respaldo");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE LA CURVA PLANIFICADA OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
