// Continuación de la recuperación de datos (ver test-recuperar-pedidos-incidente.js,
// test-recuperar-contratistas-incidente.js y test-completar-certificados-historial.js): mismo
// botón real en la app, sin consola, ahora para Caja Chica, Observaciones, Herramientas, Clima,
// Minutas y Remitos.
// - Caja Chica / Observaciones / Herramientas / Clima: el dato en sí se había perdido (el índice
//   quedó vacío o pisado por datos de prueba) -- se reconstruye entero desde un respaldo guardado.
// - Minutas / Remitos: el dato real sigue entero guardado en la base -- lo que se perdió fue su
//   lugar en el índice (pisado por datos de prueba del incidente de CI). Solo hay que re-listarlos.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => d.accept());

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

  // ==================== CAJA CHICA ====================
  await page.evaluate(() => { irA("caja"); cambiarVistaCaja("lista"); });
  await page.waitForTimeout(100);
  const rCaja1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-recuperar-rendiciones-incidente").style.display !== "none",
    cantidad: document.getElementById("pg-recuperar-rendiciones-cant").textContent,
  }));
  const rCaja2 = await page.evaluate(async () => {
    await recuperarRendicionesIncidente();
    return {
      totalEnIndice: rendicionesIndex.length,
      totalEsperado: RENDICIONES_RECUPERAR_INCIDENTE.length,
      numeros: rendicionesIndex.map((r) => r.numero).sort((a, b) => a - b),
      sumaTotalGastos: Math.round(rendicionesIndex.reduce((s, r) => s + (r.totalGastos || 0), 0)),
    };
  });
  const rCaja3 = await page.evaluate(async () => {
    const antes = rendicionesIndex.length;
    await recuperarRendicionesIncidente();
    return { antes, despues: rendicionesIndex.length };
  });

  // ==================== OBSERVACIONES ====================
  // irA("observaciones") muestra por defecto la sub-pestaña "Recordatorios" (ver
  // pendientesSubvistaActual) -- hay que pedir explícitamente la de Observaciones.
  await page.evaluate(() => { irA("observaciones"); cambiarVistaPendientes("observaciones"); });
  await page.waitForTimeout(100);
  const rObs1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-recuperar-observaciones-incidente").style.display !== "none",
    cantidad: document.getElementById("pg-recuperar-observaciones-cant").textContent,
  }));
  const rObs2 = await page.evaluate(async () => {
    await recuperarObservacionesIncidente();
    // No todas las observaciones viejas tenían foto (solo las que de verdad se fotografiaron) --
    // se chequea que la que SÍ tenía foto en el respaldo la siga teniendo, no que todas tengan.
    const conFlexible = observaciones.find((o) => o.titulo === "Cambio de flexible inodoro");
    return { total: observaciones.length, totalEsperado: OBSERVACIONES_RECUPERAR_INCIDENTE.length, conservoFoto: !!(conFlexible && conFlexible.foto) };
  });
  const rObs3 = await page.evaluate(async () => {
    const antes = observaciones.length;
    await recuperarObservacionesIncidente();
    return { antes, despues: observaciones.length };
  });

  // ==================== HERRAMIENTAS ====================
  await page.evaluate(() => { irA("herramientas"); });
  await page.waitForTimeout(100);
  const rHerr1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-recuperar-herramientas-incidente").style.display !== "none",
    cantidad: document.getElementById("pg-recuperar-herramientas-cant").textContent,
  }));
  const rHerr2 = await page.evaluate(async () => {
    await recuperarHerramientasIncidente();
    return { total: herramientas.length, totalEsperado: HERRAMIENTAS_RECUPERAR_INCIDENTE.length };
  });
  const rHerr3 = await page.evaluate(async () => {
    const antes = herramientas.length;
    await recuperarHerramientasIncidente();
    return { antes, despues: herramientas.length };
  });

  // ==================== CLIMA ====================
  await page.evaluate(() => { irA("clima"); });
  await page.waitForTimeout(100);
  const rClima1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-recuperar-clima-incidente").style.display !== "none",
    cantidad: document.getElementById("pg-recuperar-clima-cant").textContent,
  }));
  const rClima2 = await page.evaluate(async () => {
    await recuperarClimaIncidente();
    return { total: climaRegistros.length, totalEsperado: CLIMA_RECUPERAR_INCIDENTE.length };
  });
  const rClima3 = await page.evaluate(async () => {
    const antes = climaRegistros.length;
    await recuperarClimaIncidente();
    return { antes, despues: climaRegistros.length };
  });

  // ==================== REMITOS (huérfano: el doc ya existe en la base) ====================
  await page.evaluate(async () => {
    await window.storage.set("remito_wmsq6a850euxlu", { id: "wmsq6a850euxlu", numero: 1, obra: "VARELA", fecha: "2026-08-12" }, true);
    remitosIndex = []; // el índice está pisado por datos de prueba -- ninguno de los reales aparece
    await guardarRemitosIndex();
    irA("remitos");
  });
  await page.waitForTimeout(100);
  const rRem1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-recuperar-remitos-incidente").style.display !== "none",
    cantidad: document.getElementById("pg-recuperar-remitos-cant").textContent,
  }));
  const rRem2 = await page.evaluate(async () => {
    await recuperarRemitosIncidente();
    return { total: remitosIndex.length, numero: remitosIndex[0] && remitosIndex[0].numero };
  });
  const rRem3 = await page.evaluate(async () => {
    const antes = remitosIndex.length;
    await recuperarRemitosIncidente();
    return { antes, despues: remitosIndex.length };
  });
  // Caso: el doc real YA NO existe en la base (se perdió de verdad) -- no debe inventar nada ni romper.
  const rRemNoExiste = await page.evaluate(async () => {
    remitosIndex = [];
    await guardarRemitosIndex();
    await window.storage.delete("remito_wmsq6a850euxlu", true);
    let alertMsg = "";
    const originalAlert = window.alert;
    window.alert = (m) => { alertMsg = m; };
    await recuperarRemitosIncidente();
    window.alert = originalAlert;
    return { totalFinal: remitosIndex.length, alertMsg };
  });

  // ==================== MINUTAS (huérfanas: los docs ya existen en la base) ====================
  await page.evaluate(async () => {
    await window.storage.set("minuta_wmsrnbdtwxk6ze", { id: "wmsrnbdtwxk6ze", numero: 2, obra: "VARELA", fecha: "2026-08-13", contenido: "real" }, true);
    await window.storage.set("minuta_wmun0u0s5vb8pn", { id: "wmun0u0s5vb8pn", numero: 3, obra: "Virrey", fecha: "2026-09-29", contenido: "real tambien" }, true);
    minutasIndex = [];
    await guardarMinutasIndex();
    irA("minutas");
  });
  await page.waitForTimeout(100);
  const rMin1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-recuperar-minutas-incidente").style.display !== "none",
    cantidad: document.getElementById("pg-recuperar-minutas-cant").textContent,
  }));
  const rMin2 = await page.evaluate(async () => {
    await recuperarMinutasIncidente();
    return { total: minutasIndex.length, numeros: minutasIndex.map((m) => m.numero).sort() };
  });
  const rMin3 = await page.evaluate(async () => {
    const antes = minutasIndex.length;
    await recuperarMinutasIncidente();
    return { antes, despues: minutasIndex.length };
  });

  // ==================== Sin ser Administrador, ninguno de los 6 hace nada ====================
  const comoNoAdmin = await page.evaluate(async () => {
    rendicionesIndex = []; observaciones = []; herramientas = []; climaRegistros = []; remitosIndex = []; minutasIndex = [];
    ingresarComo({ username: "capataz1", role: "capataz", permisos: { asistencia: true } });
    await recuperarRendicionesIncidente();
    await recuperarObservacionesIncidente();
    await recuperarHerramientasIncidente();
    await recuperarClimaIncidente();
    await recuperarRemitosIncidente();
    await recuperarMinutasIncidente();
    return {
      nadaCreado: rendicionesIndex.length === 0 && observaciones.length === 0 && herramientas.length === 0 && climaRegistros.length === 0 && remitosIndex.length === 0 && minutasIndex.length === 0,
    };
  });

  const resultado = { rCaja1, rCaja2, rCaja3, rObs1, rObs2, rObs3, rHerr1, rHerr2, rHerr3, rClima1, rClima2, rClima3, rRem1, rRem2, rRem3, rRemNoExiste, rMin1, rMin2, rMin3, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];

  if (!rCaja1.bannerVisible) fallas.push("BUG: banner de rendiciones no aparece con pendientes");
  if (rCaja1.cantidad !== "8") fallas.push(`BUG: banner de rendiciones debería mostrar 8, mostró '${rCaja1.cantidad}'`);
  if (rCaja2.totalEnIndice !== rCaja2.totalEsperado) fallas.push(`BUG: deberían quedar ${rCaja2.totalEsperado} rendiciones, hay ${rCaja2.totalEnIndice}`);
  if (!rCaja2.numeros.includes(3) || !rCaja2.numeros.includes(13)) fallas.push("BUG: faltan rendiciones reales esperadas (N°3 o N°13) en el índice");
  if (rCaja2.sumaTotalGastos < 2000000) fallas.push(`BUG: la suma de totalGastos de las rendiciones recuperadas parece demasiado baja: ${rCaja2.sumaTotalGastos}`);
  if (rCaja3.despues !== rCaja3.antes) fallas.push(`BUG: recuperar rendiciones una segunda vez duplicó (${rCaja3.antes} -> ${rCaja3.despues})`);

  if (!rObs1.bannerVisible) fallas.push("BUG: banner de observaciones no aparece con pendientes");
  if (rObs1.cantidad !== "12") fallas.push(`BUG: banner de observaciones debería mostrar 12, mostró '${rObs1.cantidad}'`);
  if (rObs2.total !== rObs2.totalEsperado) fallas.push(`BUG: deberían quedar ${rObs2.totalEsperado} observaciones, hay ${rObs2.total}`);
  if (!rObs2.conservoFoto) fallas.push("BUG: la observación 'Cambio de flexible inodoro' debería conservar su foto y no la tiene");
  if (rObs3.despues !== rObs3.antes) fallas.push(`BUG: recuperar observaciones una segunda vez duplicó (${rObs3.antes} -> ${rObs3.despues})`);

  if (!rHerr1.bannerVisible) fallas.push("BUG: banner de herramientas no aparece con pendientes");
  if (rHerr1.cantidad !== "19") fallas.push(`BUG: banner de herramientas debería mostrar 19, mostró '${rHerr1.cantidad}'`);
  if (rHerr2.total !== rHerr2.totalEsperado) fallas.push(`BUG: deberían quedar ${rHerr2.totalEsperado} herramientas, hay ${rHerr2.total}`);
  if (rHerr3.despues !== rHerr3.antes) fallas.push(`BUG: recuperar herramientas una segunda vez duplicó (${rHerr3.antes} -> ${rHerr3.despues})`);

  if (!rClima1.bannerVisible) fallas.push("BUG: banner de clima no aparece con pendientes");
  if (rClima1.cantidad !== "26") fallas.push(`BUG: banner de clima debería mostrar 26, mostró '${rClima1.cantidad}'`);
  if (rClima2.total !== rClima2.totalEsperado) fallas.push(`BUG: deberían quedar ${rClima2.totalEsperado} registros de clima, hay ${rClima2.total}`);
  if (rClima3.despues !== rClima3.antes) fallas.push(`BUG: recuperar clima una segunda vez duplicó (${rClima3.antes} -> ${rClima3.despues})`);

  if (!rRem1.bannerVisible) fallas.push("BUG: banner de remitos no aparece con el remito huérfano pendiente");
  if (rRem1.cantidad !== "1") fallas.push(`BUG: banner de remitos debería mostrar 1, mostró '${rRem1.cantidad}'`);
  if (rRem2.total !== 1 || rRem2.numero !== 1) fallas.push(`BUG: el remito N°1 no se volvió a listar: ${JSON.stringify(rRem2)}`);
  if (rRem3.despues !== rRem3.antes) fallas.push(`BUG: recuperar remitos una segunda vez duplicó (${rRem3.antes} -> ${rRem3.despues})`);
  if (rRemNoExiste.totalFinal !== 0) fallas.push("BUG: si el remito ya no existe en la base, no debería inventarse igual en el índice");
  if (!/no se encontr/i.test(rRemNoExiste.alertMsg)) fallas.push("BUG: no avisó claramente que el remito ya no se pudo encontrar en la base");

  if (!rMin1.bannerVisible) fallas.push("BUG: banner de minutas no aparece con las 2 minutas huérfanas pendientes");
  if (rMin1.cantidad !== "2") fallas.push(`BUG: banner de minutas debería mostrar 2, mostró '${rMin1.cantidad}'`);
  if (rMin2.total !== 2 || JSON.stringify(rMin2.numeros) !== JSON.stringify([2, 3])) fallas.push(`BUG: las minutas N°2 y N°3 no se volvieron a listar bien: ${JSON.stringify(rMin2)}`);
  if (rMin3.despues !== rMin3.antes) fallas.push(`BUG: recuperar minutas una segunda vez duplicó (${rMin3.antes} -> ${rMin3.despues})`);

  if (!comoNoAdmin.nadaCreado) fallas.push("BUG DE SEGURIDAD: un Capataz (no admin) pudo ejecutar alguna de las recuperaciones");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE RECUPERACIÓN (CAJA/OBSERVACIONES/HERRAMIENTAS/CLIMA/MINUTAS/REMITOS) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
