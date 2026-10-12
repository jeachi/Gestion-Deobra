// Reporte real del usuario, en pleno incidente de pérdida de datos: "hay varios [contratistas]
// que no puedo eliminar y son de los test... dice no se pudo abrir contratista". Causa: el índice
// de contratistas (cert_contratistas_index) tenía registros cuyo documento de detalle
// (cert_contratista_<id>) nunca existió o se perdió -- abrirContratista() siempre fallaba para
// esos, y el botón "Eliminar contratista completo" vive DENTRO de la ficha de detalle, que nunca
// se podía abrir. Callejón sin salida: no había ninguna forma de sacarlos de la lista.
// Fix: cuando abrir falla porque el detalle confirmadamente no existe (no por un error de red
// transitorio), un Administrador puede sacarlo directo de la lista con una confirmación.
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

  await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    // Un contratista REAL (con su detalle guardado) y uno ROTO (en el índice, pero sin detalle --
    // el mismo patrón que dejó el bug de los tests de CI sobre el Firestore real).
    contratistasIndex = [
      { id: "real-1", nombre: "Contratista Real", obra: "VARELA", montoContrato: 1000, saldoPendiente: 500, pctConAnticipo: 0.5, pctSinAnticipo: 0.5, ultimoCertNumero: 1 },
      { id: "roto-1", nombre: "CONTRATISTA PRUEBA", obra: "ObraTest", montoContrato: 0, saldoPendiente: 0, pctConAnticipo: 0, pctSinAnticipo: 0, ultimoCertNumero: 0 },
    ];
    await guardarContratistasIndex();
    await window.storage.set("cert_contratista_real-1", JSON.stringify({ id: "real-1", nombre: "Contratista Real", obra: "VARELA", items: [], certificados: [] }), true);
    // A propósito, NO se guarda "cert_contratista_roto-1" -- así se reproduce el caso real.
    irA("certificados");
    cambiarVistaCert("lista");
  });
  await page.waitForTimeout(150);

  // ---- 1) Abrir el contratista real funciona normal (no se rompió el caso feliz) ----
  const r1 = await page.evaluate(async () => {
    await abrirContratista("real-1");
    return { vistaDetalle: document.getElementById("card-cert-detalle").style.display !== "none" };
  });
  await page.evaluate(() => { cambiarVistaCert("lista"); });

  // ---- 2) BUG REPRODUCIDO: abrir el contratista roto (sin detalle guardado) ya NO es un
  // callejón sin salida -- ofrece sacarlo de la lista, y lo saca ----
  const r2 = await page.evaluate(async () => {
    const habiaAntes = contratistasIndex.some(c => c.id === "roto-1");
    let mensaje = null;
    const original = showToast;
    showToast = (msg) => { mensaje = msg; original(msg); };
    await abrirContratista("roto-1");
    showToast = original;
    return {
      habiaAntes,
      sigueExistiendo: contratistasIndex.some(c => c.id === "roto-1"),
      elRealSigueIntacto: contratistasIndex.some(c => c.id === "real-1"),
      mensaje,
    };
  });

  // ---- 3) Sin ser Administrador, no se ofrece sacarlo (ni se saca) -- solo el mensaje genérico ----
  const comoNoAdmin = await page.evaluate(async () => {
    contratistasIndex.push({ id: "roto-2", nombre: "OTRO CONTRATISTA PRUEBA", obra: "ObraTest", montoContrato: 0, saldoPendiente: 0, pctConAnticipo: 0, pctSinAnticipo: 0, ultimoCertNumero: 0 });
    await guardarContratistasIndex();
    ingresarComo({ username: "capataz1", role: "capataz", permisos: { certificados: true } });
    await abrirContratista("roto-2");
    return { sigueExistiendo: contratistasIndex.some(c => c.id === "roto-2") };
  });

  const resultado = { r1, r2, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1.vistaDetalle) fallas.push("BUG: abrir un contratista con detalle guardado (caso normal) dejó de funcionar");

  if (!r2.habiaAntes) fallas.push("Error de armado del test: el contratista roto no estaba en el índice antes de probar");
  if (r2.sigueExistiendo) fallas.push("BUG REPRODUCIDO: un contratista sin detalle guardado (de los tests) sigue sin poder sacarse de la lista");
  if (!r2.elRealSigueIntacto) fallas.push("BUG: sacar el contratista roto de la lista afectó también al contratista real -- no debería tocar nada más");
  if (!r2.mensaje) fallas.push("BUG: no se avisó nada al sacar el contratista roto de la lista");

  if (!comoNoAdmin.sigueExistiendo) fallas.push("BUG: un Capataz (no admin) pudo sacar de la lista un contratista sin datos -- esa acción debería ser solo del Administrador");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CONTRATISTA SIN DETALLE OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
