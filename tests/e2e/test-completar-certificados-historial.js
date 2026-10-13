// Siguiente paso de la recuperación de datos (ver test-recuperar-contratistas-incidente.js): ese
// botón reconstruye Cristaldo Pintura y Moito Cielorraso con SOLO el último certificado real
// (el historial anterior quedaba como una nota de texto, porque el PDF resumen no traía desglose
// por ítem). Después el usuario consiguió los PDF individuales de Milciades y Moito Plomería
// (certificados que la app ya trae sembrados -- ver CONTRATISTAS_INICIALES -- pero desactualizados
// varios certificados), con desglose real por ítem. Este botón completa el historial
// certificado por certificado de LOS 4, sin tocar los totales (que ya estaban bien) ni el
// certificado más reciente de cada uno.
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

  // ---- Prepara el estado: Milciades/Plomería ya sembrados solos por la app, + Cristaldo/Cielorraso
  // reconstruidos con el botón anterior (certificado más reciente + nota de texto) ----
  await page.evaluate(async () => {
    await recuperarContratistasIncidente();
  });
  await page.waitForTimeout(100);

  const detalleDe = async (nombre) => {
    return page.evaluate(async (nombre) => {
      const entrada = contratistasIndex.find((c) => c.nombre === nombre);
      if (!entrada) return null;
      const det = await cargarContratistaDetalle(entrada.id);
      const resumen = calcularCertificadosDetallados(det);
      return {
        entrada: { totalPagado: Math.round(entrada.totalPagado), saldoPendiente: Math.round(entrada.saldoPendiente), ultimoCertNumero: entrada.ultimoCertNumero },
        certificados: det.certificados.map((c) => c.numero),
        totalPagadoRecalculado: Math.round(resumen.totalPagado),
      };
    }, nombre);
  };

  // ---- 1) Banner muestra la cantidad correcta ANTES de completar ----
  const r1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-completar-certificados-historial").style.display !== "none",
    cantidad: document.getElementById("pg-completar-certificados-cant").textContent,
  }));

  const antesCielorraso = await detalleDe("Moito Cielorraso");
  const antesCristaldo = await detalleDe("Cristaldo Pintura");
  const antesMilciades = await detalleDe("Milciades Electricistas");
  const antesPlomeria = await detalleDe("Moito Plomería");

  // ---- 2) Tocar el botón agrega el historial sin tocar los totales ----
  await page.evaluate(async () => { await completarCertificadosHistorial(); });
  await page.waitForTimeout(100);

  const despuesCielorraso = await detalleDe("Moito Cielorraso");
  const despuesCristaldo = await detalleDe("Cristaldo Pintura");
  const despuesMilciades = await detalleDe("Milciades Electricistas");
  const despuesPlomeria = await detalleDe("Moito Plomería");

  // ---- 3) Es idempotente ----
  const r3 = await page.evaluate(async () => {
    const antes = (await cargarContratistaDetalle(contratistasIndex.find((c) => c.nombre === "Moito Cielorraso").id)).certificados.length;
    await completarCertificadosHistorial();
    const despues = (await cargarContratistaDetalle(contratistasIndex.find((c) => c.nombre === "Moito Cielorraso").id)).certificados.length;
    return { antes, despues };
  });

  // ---- 4) Banner desaparece una vez completado todo ----
  const r4 = await page.evaluate(async () => {
    await actualizarBannerCompletarCertificados();
    return {
      bannerOculto: document.getElementById("pg-completar-certificados-historial").style.display === "none",
      cantidad: document.getElementById("pg-completar-certificados-cant").textContent,
    };
  });

  // ---- 5) Sin ser Administrador, rechaza y no modifica nada ----
  const comoNoAdmin = await page.evaluate(async () => {
    const detAntes = await cargarContratistaDetalle(contratistasIndex.find((c) => c.nombre === "Moito Cielorraso").id);
    const certsAntes = detAntes.certificados.length;
    ingresarComo({ username: "capataz1", role: "capataz", permisos: { certificados: true } });
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/Administrador/.test(msg)) huboToast = true; original(msg); };
    await completarCertificadosHistorial();
    showToast = original;
    const detDespues = await cargarContratistaDetalle(contratistasIndex.find((c) => c.nombre === "Moito Cielorraso").id);
    return { huboToast, noModificoNada: detDespues.certificados.length === certsAntes };
  });

  const resultado = { r1, antesCielorraso, antesCristaldo, antesMilciades, antesPlomeria, despuesCielorraso, despuesCristaldo, despuesMilciades, despuesPlomeria, r3, r4, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1.bannerVisible) fallas.push("BUG: con certificados históricos pendientes, el banner no aparece");
  // 6 (Cielorraso) + 3 (Cristaldo) + 6 (Milciades 5-10) + 6 (Plomería 6-11) = 21
  if (r1.cantidad !== "21") fallas.push(`BUG: el banner debería mostrar 21 certificados pendientes, mostró '${r1.cantidad}'`);

  if (despuesCielorraso.certificados.length !== 7) fallas.push(`BUG: Moito Cielorraso debería terminar con 7 certificados (1-7), tiene ${despuesCielorraso.certificados.length}`);
  if (JSON.stringify(despuesCielorraso.certificados) !== JSON.stringify([7, 1, 2, 3, 4, 5, 6].sort((a, b) => a - b))) fallas.push(`BUG: certificados de Cielorraso mal numerados: ${JSON.stringify(despuesCielorraso.certificados)}`);
  if (despuesCielorraso.entrada.totalPagado !== antesCielorraso.entrada.totalPagado) fallas.push(`BUG: completar el historial cambió el total pagado de Cielorraso (antes ${antesCielorraso.entrada.totalPagado}, después ${despuesCielorraso.entrada.totalPagado}) -- no debería tocarlo`);
  if (despuesCielorraso.entrada.ultimoCertNumero !== 7) fallas.push("BUG: el último certificado de Cielorraso dejó de ser el 7");

  if (despuesCristaldo.certificados.length !== 4) fallas.push(`BUG: Cristaldo Pintura debería terminar con 4 certificados (1-4), tiene ${despuesCristaldo.certificados.length}`);
  if (despuesCristaldo.entrada.totalPagado !== antesCristaldo.entrada.totalPagado) fallas.push("BUG: completar el historial cambió el total pagado de Cristaldo -- no debería tocarlo");

  if (despuesMilciades.certificados.length !== 10) fallas.push(`BUG: Milciades Electricistas debería terminar con 10 certificados (1-10), tiene ${despuesMilciades.certificados.length}`);
  if (despuesMilciades.entrada.totalPagado !== 19110000) fallas.push(`BUG: Milciades debería quedar en $19.110.000 pagados (verificado contra el PDF del certificado 10), dio ${despuesMilciades.entrada.totalPagado}`);
  if (despuesMilciades.entrada.ultimoCertNumero !== 4) fallas.push("BUG: el último certificado de Milciades (el más reciente, el 4 que ya estaba bien cargado) cambió -- no debería tocarse, los nuevos son todos anteriores");

  if (despuesPlomeria.certificados.length !== 11) fallas.push(`BUG: Moito Plomería debería terminar con 11 certificados (1-11), tiene ${despuesPlomeria.certificados.length}`);
  if (despuesPlomeria.entrada.totalPagado !== 9569450) fallas.push(`BUG: Plomería debería quedar en $9.569.450 pagados (verificado contra el PDF del certificado 11), dio ${despuesPlomeria.entrada.totalPagado}`);

  if (r3.despues !== r3.antes) fallas.push(`BUG: completar el historial una segunda vez duplicó certificados (${r3.antes} -> ${r3.despues}) -- debería ser idempotente`);

  if (!r4.bannerOculto) fallas.push("BUG: con todo el historial ya completado, el banner sigue apareciendo");
  if (r4.cantidad !== "0") fallas.push(`BUG: el banner debería mostrar 0 pendientes, mostró '${r4.cantidad}'`);

  if (!comoNoAdmin.huboToast) fallas.push("BUG: un Capataz (no admin) puede correr esta recuperación sin aviso");
  if (!comoNoAdmin.noModificoNada) fallas.push("BUG DE SEGURIDAD: un Capataz (no admin) pudo modificar certificados con esta función");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE COMPLETAR HISTORIAL DE CERTIFICADOS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
