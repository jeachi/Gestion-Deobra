// Pedido del usuario (auditoría): "Nómina duplica horas de trabajador prestado entre las 2 obras".
// Causa real: reg.days es UN SOLO objeto por trabajador y mes, compartido entre la obra de base y
// cualquier día de préstamo puntual (marcado aparte en reg.diasObra). totalHorasRango() sumaba
// TODOS los días sin mirar diasObra -- un trabajador con 10 días en Obra A y 5 prestado a Obra B
// aparecía con "Total hs" = 15 en LAS DOS obras (no solo las horas de cada una), duplicando el
// jornal si cada obra paga según esa columna. El arreglo agrega reg+obraFiltro como parámetros
// opcionales: sin ellos (como antes) suma todo; con ellos, solo cuenta los días cuya obra efectiva
// (diasObra[d] si existe, si no reg.obra) coincide con la obra filtrada.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  const r = await page.evaluate(() => {
    // Trabajador "prestado": 10 días de 8hs en Obra A (días 1-10), 5 días de 8hs prestado a Obra B
    // (días 11-15, marcados en diasObra como ya hace marcarDiaComoPrestamoSiCorresponde en la app real).
    const reg = { obra: "Obra A", days: {}, diasObra: {} };
    for (let d = 1; d <= 10; d++) reg.days[d] = "8";
    for (let d = 11; d <= 15; d++) { reg.days[d] = "8"; reg.diasObra[d] = "Obra B"; }

    const totalSinFiltro = totalHorasRango(reg.days, 1, 15); // compatibilidad: firma vieja, sin reg/obraFiltro
    const totalObraA = totalHorasRango(reg.days, 1, 15, reg, "Obra A");
    const totalObraB = totalHorasRango(reg.days, 1, 15, reg, "Obra B");
    const totalTodasLasObras = totalHorasRango(reg.days, 1, 15, reg, ""); // "" = filtro vacío, no debe filtrar

    // Caso real de la auditoría: ANTES del fix, totalObraA y totalObraB daban los dos 120 (15*8) --
    // el mismo total completo en las dos obras. Ahora cada una debe ver SOLO sus propios días.
    return { totalSinFiltro, totalObraA, totalObraB, totalTodasLasObras };
  });

  // ---- Un trabajador SIN ningún día de préstamo (diasObra vacío) sigue sumando todo normal ----
  const r2 = await page.evaluate(() => {
    const reg = { obra: "Obra A", days: { 1: "9", 2: "8", 3: "F" }, diasObra: {} };
    return {
      totalObraA: totalHorasRango(reg.days, 1, 3, reg, "Obra A"),
      totalObraB: totalHorasRango(reg.days, 1, 3, reg, "Obra B"), // no tiene nada en Obra B -> 0
    };
  });

  console.log("Resultado:", JSON.stringify({ r, r2 }, null, 2));

  const fallas = [];
  if (r.totalSinFiltro !== 120) fallas.push(`BUG: sin reg/obraFiltro (compatibilidad con la firma vieja) debería sumar las 15 días x 8hs = 120, dio ${r.totalSinFiltro}`);
  if (r.totalObraA !== 80) fallas.push(`BUG REAL: Obra A debería ver solo sus 10 días (80hs), dio ${r.totalObraA}`);
  if (r.totalObraB !== 40) fallas.push(`BUG REAL: Obra B debería ver solo los 5 días prestados (40hs), dio ${r.totalObraB}`);
  if (r.totalObraA === r.totalObraB && r.totalObraA === 120) fallas.push("BUG REPRODUCIDO: las dos obras ven el mismo total completo (duplicado) -- el fix no tomó efecto");
  if (r.totalTodasLasObras !== 120) fallas.push(`BUG: con filtro vacío ("Todas las obras") debería sumar todo igual que sin filtro (120), dio ${r.totalTodasLasObras}`);
  if (r2.totalObraA !== 17) fallas.push(`BUG: trabajador sin préstamo, sumando días normales (9+8) debería dar 17 para su obra, dio ${r2.totalObraA}`);
  if (r2.totalObraB !== 0) fallas.push(`BUG: trabajador sin ningún día marcado para Obra B debería dar 0 ahí, dio ${r2.totalObraB}`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE NÓMINA SIN DUPLICAR HORAS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
