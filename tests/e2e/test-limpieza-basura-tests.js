// Recuperación de emergencia (ver conversación con el usuario sobre la pérdida de datos en
// producción): además de recuperar los datos reales (Pedidos, Contratistas, etc.), el usuario
// pidió limpiar los documentos de prueba que quedaron dando vueltas en Firestore -- con la
// condición explícita de "no tocar lo que ya corregimos". Esta función escanea TODAS las claves
// de Firestore (window.storage.list), se queda con las que tienen pinta de documento de detalle
// (pedido_<id>, cert_contratista_<id>, rendicion_<id>) y borra solo las que YA NO están en el
// índice vigente de esa pantalla -- cualquier cosa real, cargada a mano o recuperada, sigue en el
// índice, así que nunca se toca.
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
    const fakeDb = {
      collection() {
        return {
          doc: (id) => fakeDocRef(id),
          // A diferencia de los demás tests (que no necesitan listar), ACÁ sí hace falta que
          // collection().get() devuelva de verdad los documentos guardados -- es lo que usa
          // window.storage.list() para traer todas las claves.
          async get() { return { docs: Object.keys(fakeDocs).map((id) => ({ id, data: () => fakeDocs[id] })) }; },
        };
      },
    };
    window.firebase = { initializeApp() {}, firestore() { return fakeDb; }, auth() { return { signInAnonymously: () => Promise.resolve() }; } };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });

    // ---- Estado real, ya corregido: un pedido, un contratista y una rendición VIGENTES ----
    pedidosIndex = [{ id: "real-ped", numero: 1, fecha: "2026-01-01", obra: "VARELA", rubro: "X", estado: "Pendiente", ingresoFecha: "", tipo: "material", estadoContratacion: null }];
    await guardarPedidosIndex();
    await window.storage.set("pedido_real-ped", JSON.stringify({ id: "real-ped", numero: 1, items: [] }), true);

    // La app ya siembra sola, al arrancar, 2 contratistas reales (Milciades Electricistas / Moito
    // Plomería, ver CONTRATISTAS_INICIALES) -- se agrega el de este test AL LADO de esos, no en
    // lugar de ellos, para no convertir sus documentos de detalle (ya reales y vigentes) en
    // falsos huérfanos.
    contratistasIndex.push({ id: "real-cert", nombre: "Real SA", obra: "VARELA", montoContrato: 1, anticipoMonto: 0, saldoPendiente: 1, pctConAnticipo: 0, pctSinAnticipo: 0, ultimoCertNumero: 1 });
    await guardarContratistasIndex();
    await window.storage.set("cert_contratista_real-cert", JSON.stringify({ id: "real-cert", items: [], certificados: [] }), true);

    rendicionesIndex = [{ id: "real-rend", numero: 1, obra: "VARELA" }];
    await guardarRendicionesIndex();
    await window.storage.set("rendicion_real-rend", JSON.stringify({ id: "real-rend", numero: 1, gastos: [] }), true);
    await window.storage.set("rendicion_correlativo", "2", true);

    // ---- Basura de tests: documentos de detalle que NO están en ningún índice ----
    await window.storage.set("pedido_wtest1", JSON.stringify({ id: "wtest1", obra: "ObraTest" }), true);
    await window.storage.set("cert_contratista_wtest2", JSON.stringify({ id: "wtest2", obra: "ObraTest" }), true);
    await window.storage.set("rendicion_wtest3", JSON.stringify({ id: "wtest3", obra: "ObraTest" }), true);
    await window.storage.set("rendicion_wtest4", JSON.stringify({ id: "wtest4", obra: "ObraTest" }), true);

    irA("trabajadores");
    cambiarVistaConfig("actividad");
  });
  await page.waitForTimeout(150);

  // ---- 1) Escanear encuentra exactamente los 4 huérfanos, uno por tipo (y uno extra de Caja Chica) ----
  const r1 = await page.evaluate(async () => {
    await escanearBasuraDeTests();
    return {
      resultadoTexto: document.getElementById("limpieza-tests-resultado").textContent,
      botonVisible: document.getElementById("btn-limpieza-tests-eliminar").style.display !== "none",
      botonTexto: document.getElementById("btn-limpieza-tests-eliminar").textContent,
      encontrado: basuraDeTestsEncontrada,
    };
  });

  // ---- 2) Confirmar elimina SOLO los huérfanos; lo real (incluido el correlativo) queda intacto ----
  const r2 = await page.evaluate(async () => {
    await eliminarBasuraDeTests();
    const clavesFinales = (await window.storage.list(undefined, true)).keys.sort();
    return {
      resultadoTexto: document.getElementById("limpieza-tests-resultado").textContent,
      botonVisible: document.getElementById("btn-limpieza-tests-eliminar").style.display !== "none",
      clavesFinales,
      pedidosIndexIntacto: pedidosIndex.length === 1 && pedidosIndex[0].id === "real-ped",
      contratistasIndexIntacto: contratistasIndex.some((c) => c.id === "real-cert") && contratistasIndex.some((c) => c.nombre === "Milciades Electricistas") && contratistasIndex.some((c) => c.nombre === "Moito Plomería"),
      rendicionesIndexIntacto: rendicionesIndex.length === 1 && rendicionesIndex[0].id === "real-rend",
    };
  });

  // ---- 3) Escanear otra vez ya no encuentra nada ----
  const r3 = await page.evaluate(async () => {
    await escanearBasuraDeTests();
    return { resultadoTexto: document.getElementById("limpieza-tests-resultado").textContent, botonVisible: document.getElementById("btn-limpieza-tests-eliminar").style.display !== "none" };
  });

  // ---- 4) Sin ser Administrador, ni escanear ni eliminar hacen nada ----
  const comoNoAdmin = await page.evaluate(async () => {
    await window.storage.set("pedido_wtest5", JSON.stringify({ id: "wtest5", obra: "ObraTest" }), true);
    const estadoPrevio = basuraDeTestsEncontrada;
    ingresarComo({ username: "capataz1", role: "capataz", permisos: {} });
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/Administrador/.test(msg)) huboToast = true; original(msg); };
    await escanearBasuraDeTests();
    await eliminarBasuraDeTests();
    showToast = original;
    const sigueExistiendo = (await window.storage.list("pedido_wtest5", true)).keys.length === 1;
    return { huboToast, sigueExistiendo, noCambioElEstadoDelEscaneo: basuraDeTestsEncontrada === estadoPrevio };
  });

  const resultado = { r1, r2, r3, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1.botonVisible) fallas.push("BUG: con huérfanos encontrados, el botón de eliminar no aparece");
  if (!/4/.test(r1.botonTexto)) fallas.push(`BUG: el botón debería mostrar la cantidad (4), dio: "${r1.botonTexto}"`);
  if (!r1.encontrado || !r1.encontrado["Pedidos"] || !r1.encontrado["Pedidos"].includes("pedido_wtest1")) fallas.push("BUG: no detectó el pedido huérfano de prueba");
  if (!r1.encontrado || !r1.encontrado["Contratistas"] || !r1.encontrado["Contratistas"].includes("cert_contratista_wtest2")) fallas.push("BUG: no detectó el contratista huérfano de prueba");
  if (!r1.encontrado || !r1.encontrado["Caja Chica"] || !r1.encontrado["Caja Chica"].includes("rendicion_wtest3") || !r1.encontrado["Caja Chica"].includes("rendicion_wtest4")) fallas.push("BUG: no detectó las 2 rendiciones huérfanas de prueba");
  if (r1.encontrado && r1.encontrado["Caja Chica"] && r1.encontrado["Caja Chica"].includes("rendicion_correlativo")) fallas.push("BUG CRÍTICO: el escaneo marcó 'rendicion_correlativo' (el contador, no un documento de detalle) como basura -- lo borraría");

  if (!/Eliminados 4/.test(r2.resultadoTexto)) fallas.push(`BUG: debería reportar 4 eliminados, dio: "${r2.resultadoTexto}"`);
  if (r2.botonVisible) fallas.push("BUG: después de eliminar, el botón debería volver a ocultarse");
  if (["pedido_wtest1", "cert_contratista_wtest2", "rendicion_wtest3", "rendicion_wtest4"].some((k) => r2.clavesFinales.includes(k))) fallas.push(`BUG CRÍTICO: quedó basura de test sin borrar: ${JSON.stringify(r2.clavesFinales)}`);
  if (!r2.clavesFinales.includes("pedido_real-ped")) fallas.push("BUG CRÍTICO: se borró el pedido REAL -- no debería tocarse nada que esté en el índice");
  if (!r2.clavesFinales.includes("cert_contratista_real-cert")) fallas.push("BUG CRÍTICO: se borró el contratista REAL");
  if (!r2.clavesFinales.includes("rendicion_real-rend")) fallas.push("BUG CRÍTICO: se borró la rendición REAL");
  if (!r2.clavesFinales.includes("rendicion_correlativo")) fallas.push("BUG CRÍTICO: se borró 'rendicion_correlativo' (el contador de Caja Chica) -- rompería la numeración de la próxima rendición");
  if (!r2.pedidosIndexIntacto || !r2.contratistasIndexIntacto || !r2.rendicionesIndexIntacto) fallas.push("BUG: la limpieza modificó alguno de los índices en memoria -- no debería tocarlos, solo los documentos huérfanos");

  if (!/No se encontró/.test(r3.resultadoTexto)) fallas.push(`BUG: tras limpiar, un segundo escaneo no debería encontrar nada más, dio: "${r3.resultadoTexto}"`);
  if (r3.botonVisible) fallas.push("BUG: sin huérfanos, el botón de eliminar no debería mostrarse");

  if (!comoNoAdmin.huboToast) fallas.push("BUG: un Capataz (no admin) puede escanear sin aviso");
  if (!comoNoAdmin.sigueExistiendo) fallas.push("BUG DE SEGURIDAD: un Capataz (no admin) pudo hacer algo con la limpieza de basura de tests");
  if (!comoNoAdmin.noCambioElEstadoDelEscaneo) fallas.push("BUG: un Capataz (no admin) no debería poder disparar un escaneo (modificó basuraDeTestsEncontrada)");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE LIMPIEZA DE BASURA DE TESTS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
