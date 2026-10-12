// Recuperación de emergencia (ver conversación con el usuario sobre la pérdida de datos en
// producción): el mismo bug de CI que borró Pedidos también se llevó los Contratistas. Se
// reconstruyeron 2 (Cristaldo Pintura y Moito Cielorraso) a partir de un PDF resumen que el
// usuario tenía guardado -- ese PDF trae el total en pesos de CADA certificado, pero el
// desglose por ítem solo lo trae del ÚLTIMO certificado de cada uno (el usuario confirmó que no
// tiene los PDFs individuales de los certificados anteriores). Se carga entonces solo el ESTADO
// ACTUAL: el último certificado real, con su desglose real por ítem -- verificado a mano contra
// los números exactos del PDF (montoItem, % acumulado, saldo pendiente).
// OJO al leer este test: la app YA siembra sola, al arrancar sin datos, otros 2 contratistas
// reales distintos (Milciades Electricistas y Moito Plomería, ver CONTRATISTAS_INICIALES) -- el
// usuario confirmó que esos SÍ son reales (desactualizados, no son parte de este incidente), así
// que conviven con los que recupera este botón sin pisarse. El índice después de recuperar tiene
// 4 en total, no 2 -- el test lo tiene en cuenta explícitamente.
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
    irA("certificados");
    cambiarVistaCert("lista");
  });
  await page.waitForTimeout(150);

  // ---- 1) El banner aparece con la cantidad correcta ----
  const r1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-recuperar-contratistas-incidente").style.display !== "none",
    cantidad: document.getElementById("pg-recuperar-contratistas-cant").textContent,
  }));

  // ---- 2) Tocar el botón crea los 2 contratistas, con los montos EXACTOS verificados contra el PDF ----
  const r2 = await page.evaluate(async () => {
    await recuperarContratistasIncidente();
    const cristaldo = contratistasIndex.find(c => c.nombre === "Cristaldo Pintura");
    const moito = contratistasIndex.find(c => c.nombre === "Moito Cielorraso");
    const detCristaldo = cristaldo ? await cargarContratistaDetalle(cristaldo.id) : null;
    const detMoito = moito ? await cargarContratistaDetalle(moito.id) : null;
    const resCristaldo = detCristaldo ? calcularCertificadosDetallados(detCristaldo) : null;
    const resMoito = detMoito ? calcularCertificadosDetallados(detMoito) : null;
    return {
      totalEnIndice: contratistasIndex.length,
      // Los 2 que ya siembra sola la app (no son parte de este incidente, ver nota arriba) tienen
      // que seguir estando -- si no, este botón les estaría pisando algo que no le corresponde.
      siguenEstandoLosSembradosSolos: contratistasIndex.some(c => c.nombre === "Milciades Electricistas") && contratistasIndex.some(c => c.nombre === "Moito Plomería"),
      cristaldo: cristaldo ? { montoContrato: cristaldo.montoContrato, anticipoMonto: cristaldo.anticipoMonto, saldoPendiente: Math.round(cristaldo.saldoPendiente), ultimoCertNumero: cristaldo.ultimoCertNumero } : null,
      moito: moito ? { montoContrato: moito.montoContrato, anticipoMonto: moito.anticipoMonto, saldoPendiente: Math.round(moito.saldoPendiente), ultimoCertNumero: moito.ultimoCertNumero } : null,
      itemsCristaldo: detCristaldo ? detCristaldo.items.map(it => ({ nombre: it.nombre, pctIncidencia: it.pctIncidencia })) : null,
      totalAcumuladoCristaldo: resCristaldo ? Math.round(resCristaldo.totalCertificado) : null,
      totalAcumuladoMoito: resMoito ? Math.round(resMoito.totalCertificado) : null,
      tieneAnotacionHistorial: detCristaldo ? /Certificado 1/.test(detCristaldo.certificados[0].anotacion) : false,
    };
  });

  // ---- 3) Es idempotente ----
  const r3 = await page.evaluate(async () => {
    const antes = contratistasIndex.length;
    await recuperarContratistasIncidente();
    return { antes, despues: contratistasIndex.length };
  });

  // ---- 4) Un contratista ya cargado a mano con el mismo nombre+obra se respeta, no se duplica ----
  const r4 = await page.evaluate(async () => {
    contratistasIndex = [{ id: "manual-1", nombre: "Cristaldo Pintura", obra: "VARELA", montoContrato: 999, anticipoMonto: 0, saldoPendiente: 999, pctConAnticipo: 0, pctSinAnticipo: 0, ultimoCertNumero: 0 }];
    await guardarContratistasIndex();
    await recuperarContratistasIncidente();
    const c = contratistasIndex.find(x => x.nombre === "Cristaldo Pintura");
    return { siguioSiendoElManual: c && c.id === "manual-1" && c.montoContrato === 999, totalFinal: contratistasIndex.length };
  });

  // ---- 5) Sin ser Administrador, rechaza y no crea nada ----
  const comoNoAdmin = await page.evaluate(async () => {
    contratistasIndex = [];
    await guardarContratistasIndex();
    ingresarComo({ username: "capataz1", role: "capataz", permisos: { certificados: true } });
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/Administrador/.test(msg)) huboToast = true; original(msg); };
    await recuperarContratistasIncidente();
    showToast = original;
    return { huboToast, noCreoNada: contratistasIndex.length === 0 };
  });

  const resultado = { r1, r2, r3, r4, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1.bannerVisible) fallas.push("BUG: con contratistas pendientes de recuperar, el banner no aparece");
  if (r1.cantidad !== "2") fallas.push(`BUG: el banner no muestra 2, dio '${r1.cantidad}'`);

  if (r2.totalEnIndice !== 4) fallas.push(`BUG: deberían quedar 4 contratistas (2 sembrados solos por la app + 2 recuperados), hay ${r2.totalEnIndice}`);
  if (!r2.siguenEstandoLosSembradosSolos) fallas.push("BUG: el botón de recuperación pisó o borró los 2 contratistas que la app ya siembra sola (Milciades Electricistas / Moito Plomería) -- no debería tocarlos");
  if (!r2.cristaldo || r2.cristaldo.montoContrato !== 35000000) fallas.push(`BUG: monto de Cristaldo Pintura incorrecto: ${JSON.stringify(r2.cristaldo)}`);
  if (!r2.cristaldo || r2.cristaldo.anticipoMonto !== 4000000) fallas.push("BUG: anticipo de Cristaldo Pintura incorrecto");
  if (!r2.cristaldo || r2.cristaldo.saldoPendiente !== 21731000) fallas.push(`BUG: saldo pendiente de Cristaldo Pintura debería ser $21.731.000, dio ${r2.cristaldo && r2.cristaldo.saldoPendiente}`);
  if (!r2.cristaldo || r2.cristaldo.ultimoCertNumero !== 4) fallas.push("BUG: el N° de último certificado de Cristaldo Pintura debería mostrar 4 (el real), no la cantidad de certificados guardados");
  if (!r2.moito || r2.moito.montoContrato !== 23154000) fallas.push(`BUG: monto de Moito Cielorraso incorrecto: ${JSON.stringify(r2.moito)}`);
  if (!r2.moito || r2.moito.saldoPendiente !== 2037552) fallas.push(`BUG: saldo pendiente de Moito Cielorraso debería ser $2.037.552, dio ${r2.moito && r2.moito.saldoPendiente}`);
  if (!r2.moito || r2.moito.ultimoCertNumero !== 7) fallas.push("BUG: el N° de último certificado de Moito Cielorraso debería mostrar 7");
  if (r2.totalAcumuladoCristaldo !== 9269000) fallas.push(`BUG: el total certificado (sin anticipo) de Cristaldo debería ser $9.269.000, dio ${r2.totalAcumuladoCristaldo}`);
  if (r2.totalAcumuladoMoito !== 21116448) fallas.push(`BUG: el total certificado de Moito debería ser $21.116.448, dio ${r2.totalAcumuladoMoito}`);
  if (!r2.itemsCristaldo || r2.itemsCristaldo.length !== 3) fallas.push("BUG: Cristaldo Pintura debería tener 3 ítems (Enduido interior, Pintura interior, Pintura exterior)");
  if (!r2.tieneAnotacionHistorial) fallas.push("BUG: no quedó la nota con el historial de certificados anteriores (se perdería esa info)");

  if (r3.despues !== r3.antes) fallas.push(`BUG: tocar "Recuperar contratistas" una segunda vez duplicó contratistas (${r3.antes} -> ${r3.despues}) -- debería ser idempotente`);

  if (!r4.siguioSiendoElManual) fallas.push("BUG CRÍTICO: un contratista ya cargado a mano con el mismo nombre fue pisado por el de recuperación");
  if (r4.totalFinal !== 2) fallas.push(`BUG: con uno ya cargado a mano, el total final debería seguir siendo 2, dio ${r4.totalFinal}`);

  if (!comoNoAdmin.huboToast) fallas.push("BUG: un Capataz (no admin) puede correr la recuperación sin aviso");
  if (!comoNoAdmin.noCreoNada) fallas.push("BUG DE SEGURIDAD: un Capataz (no admin) pudo crear contratistas con la función de recuperación");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE RECUPERACIÓN DE CONTRATISTAS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
