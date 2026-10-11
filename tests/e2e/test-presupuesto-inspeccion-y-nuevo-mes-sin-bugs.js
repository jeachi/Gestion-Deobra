// Pedido del usuario (auditoría), 2 hallazgos sobre la Curva de avance:
// 1) confirmarInspeccionPresupuesto no marcaba .planificado en meses futuros -- un acta de
//    Inspección que adelanta datos de un mes que todavía no llegó quedaba afuera de la curva
//    "Planificado" para siempre.
// 2) confirmarNuevoMesPresupuesto no verificaba si ya existía una entrada para el mes antes de
//    hacer push -- un doble-toque en "✓ Guardar Mes N" (lag de red) duplicaba la entrada,
//    rompiendo totales y la curva.
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  await page.route("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js", async (route) => {
    await route.fulfill({ path: path.join(__dirname, "libs/chartjs/dist/chart.umd.min.js"), contentType: "application/javascript" });
  });

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  // ---- 1) confirmarInspeccionPresupuesto marca .planificado para un mes futuro ----
  const r1 = await page.evaluate(() => {
    obraPredeterminada = "ObraInsp";
    presupuestoItems = [
      { rubro: 1, rubroNombre: "R1", nombre: "Item Inspeccionado", unidad: "m2", cantidad: 10, precioConCoef: 1000, pctIncidencia: 100,
        historialMeses: [{ n: 1, anterior: 0, enElMes: 0.2, acumulado: 0.2, monto: 200 }] },
    ];
    presupuestoMesActual = 1; // "mes actual" fijo en 1 -- el acta trae datos del Mes 3 (futuro)
    inspeccionArchivoNombre = "acta-test.pdf";
    inspeccionEmparejadosActuales = [{ itemIdx: 0 }];
    document.querySelectorAll("#insp-lista-revision").forEach(el => el.remove());
    const cont = document.createElement("div");
    cont.id = "insp-lista-revision";
    const fila = document.createElement("div");
    fila.className = "insp-fila";
    fila.dataset.idx = "0";
    fila.innerHTML = `
      <input class="insp-incluir" type="checkbox" checked>
      <input class="insp-anterior" value="20">
      <input class="insp-mes" value="40">
      <input class="insp-acumulado" value="60">`;
    cont.appendChild(fila);
    document.body.appendChild(cont);
    return confirmarInspeccionPresupuesto(3).then(() => {
      cont.remove();
      const entrada3 = presupuestoItems[0].historialMeses.find(m => m.n === 3);
      return { planificado: entrada3 ? entrada3.planificado : undefined, acumulado: entrada3 ? entrada3.acumulado : null };
    });
  });

  // ---- 2) confirmarInspeccionPresupuesto NO marca .planificado para el mes actual (no es planificación) ----
  const r2 = await page.evaluate(() => {
    document.querySelectorAll("#insp-lista-revision").forEach(el => el.remove());
    const cont = document.createElement("div");
    cont.id = "insp-lista-revision";
    const fila = document.createElement("div");
    fila.className = "insp-fila";
    fila.dataset.idx = "0";
    fila.innerHTML = `
      <input class="insp-incluir" type="checkbox" checked>
      <input class="insp-anterior" value="0">
      <input class="insp-mes" value="25">
      <input class="insp-acumulado" value="25">`;
    cont.appendChild(fila);
    document.body.appendChild(cont);
    return confirmarInspeccionPresupuesto(1).then(() => { // mes 1 === mes actual, nunca es planificación
      cont.remove();
      const entrada1 = presupuestoItems[0].historialMeses.find(m => m.n === 1);
      return { planificado: entrada1 ? entrada1.planificado : undefined };
    });
  });

  // ---- 3) confirmarNuevoMesPresupuesto: doble-toque NO duplica la entrada del mes ----
  const r3 = await page.evaluate(async () => {
    presupuestoItems = [
      { rubro: 1, rubroNombre: "R1", nombre: "Item Doble Toque", unidad: "m2", cantidad: 10, precioConCoef: 1000, pctIncidencia: 100,
        historialMeses: [{ n: 1, anterior: 0, enElMes: 0.3, acumulado: 0.3, monto: 300 }] },
    ];
    presupuestoMesActual = 1;
    document.querySelectorAll(".pg-input-mes").forEach(el => el.remove());
    const input = document.createElement("input");
    input.className = "pg-input-mes";
    input.dataset.idx = "0";
    input.value = "20"; // 20% EN el mes 2
    document.body.appendChild(input);
    // Simula el doble-toque: dos llamadas "casi simultáneas" (la primera sin esperar a que
    // termine antes de disparar la segunda), igual que un dedo rápido con lag de red.
    await Promise.all([confirmarNuevoMesPresupuesto(2), confirmarNuevoMesPresupuesto(2)]);
    input.remove();
    const entradasMes2 = presupuestoItems[0].historialMeses.filter(m => m.n === 2);
    return {
      cantidadEntradasMes2: entradasMes2.length,
      acumulado: entradasMes2[0] ? entradasMes2[0].acumulado : null,
      enElMes: entradasMes2[0] ? entradasMes2[0].enElMes : null,
    };
  });

  console.log("Resultado:", JSON.stringify({ r1, r2, r3 }, null, 2));

  const fallas = [];
  if (r1.planificado === undefined) fallas.push("BUG REAL: confirmarInspeccionPresupuesto no marcó .planificado para un mes futuro (Mes 3)");
  else if (Math.abs(r1.planificado - 0.6) > 0.001) fallas.push(`BUG: .planificado debería ser 60% (lo cargado), dio ${r1.planificado}`);
  if (Math.abs(r1.acumulado - 0.6) > 0.001) fallas.push(`BUG: el acumulado real del Mes 3 debería ser 60%, dio ${r1.acumulado}`);

  if (r2.planificado !== undefined) fallas.push(`BUG: confirmarInspeccionPresupuesto marcó .planificado en el mes actual (no debería, nunca es planificación), dio ${r2.planificado}`);

  if (r3.cantidadEntradasMes2 !== 1) fallas.push(`BUG REPRODUCIDO: doble-toque en confirmarNuevoMesPresupuesto dejó ${r3.cantidadEntradasMes2} entradas para el Mes 2 (debería ser 1)`);
  if (Math.abs(r3.acumulado - 0.5) > 0.001) fallas.push(`BUG: tras el doble-toque, el acumulado del Mes 2 debería ser 50% (30% anterior + 20% del mes), dio ${r3.acumulado}`);
  if (Math.abs(r3.enElMes - 0.2) > 0.001) fallas.push(`BUG: "enElMes" debería seguir siendo 20% (no duplicarse a 40%), dio ${r3.enElMes}`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE INSPECCIÓN Y NUEVO MES (SIN DUPLICAR) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
