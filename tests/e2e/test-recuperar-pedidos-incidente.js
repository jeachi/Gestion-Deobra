// Recuperación de emergencia (ver conversación con el usuario sobre la pérdida de datos en
// producción): un bug en los tests de CI borró todos los Pedidos de materiales. El usuario
// reconstruyó 27 pedidos reales a partir de PDFs que tenía guardados, pero cargarlos uno por uno
// con el importador de Excel (que no conserva el N° original -- hay que importar, guardar, volver
// a abrir, editar, cambiar el número y guardar de nuevo) le resultaba demasiado trabajoso para 27
// pedidos. Esta función los crea todos de una sola vez, CON sus números originales.
// Puntos críticos a probar: (1) solo Administrador, (2) es idempotente -- si un pedido con ese N°
// ya existe no lo toca ni lo duplica, (3) conserva el N° exacto (no el correlativo automático),
// (4) crea tanto los pedidos con materiales como los de "contratación de trabajo" sin materiales,
// (5) empuja el correlativo para que el próximo pedido NUEVO no choque con uno recuperado.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => d.accept()); // confirm() de "¿Confirmás?"

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
    irA("pedidos");
    cambiarVistaPedidos("lista");
  });
  await page.waitForTimeout(150);

  // ---- 1) El banner aparece (con la cantidad correcta) cuando hay pedidos para recuperar ----
  const r1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-recuperar-pedidos-incidente").style.display !== "none",
    cantidad: document.getElementById("pg-recuperar-pedidos-cant").textContent,
    totalEsperado: PEDIDOS_RECUPERAR_INCIDENTE.length,
  }));

  // ---- 2) Tocar el botón crea todos los pedidos, con sus N° originales exactos ----
  const correlativoAntes = await page.evaluate(() => correlativoSiguiente);
  const r2 = await page.evaluate(async () => {
    await recuperarPedidosIncidente();
    return {
      totalEnIndice: pedidosIndex.length,
      numeros: pedidosIndex.map(p => p.numero).sort((a, b) => a - b),
      pedido0122: pedidosIndex.find(p => p.numero === 122),
      pedido0054: pedidosIndex.find(p => p.numero === 54),
      pedido0023: pedidosIndex.find(p => p.numero === 23),
    };
  });
  const detalle0122 = await page.evaluate(async () => {
    const p = pedidosIndex.find(x => x.numero === 122);
    const det = await cargarPedidoDetalle(p.id);
    return { rubro: det.rubro, resp: det.respRecepcion, cantidadItems: det.items.filter(i => i.desc && i.desc.trim() !== "").length };
  });
  const correlativoDespues = await page.evaluate(() => correlativoSiguiente);

  // ---- 3) Es idempotente: tocarlo de nuevo no duplica nada ----
  const r3 = await page.evaluate(async () => {
    const antes = pedidosIndex.length;
    await recuperarPedidosIncidente();
    return { antes, despues: pedidosIndex.length };
  });

  // ---- 4) Un pedido cargado a mano con un N° que coincide con uno de los recuperados se
  // respeta tal cual (no se pisa) -- probamos borrando todo y re-sembrando con uno ya "manual" ----
  const r4 = await page.evaluate(async () => {
    pedidosIndex = [{ id: "manual-1", numero: 89, fecha: "2026-01-01", obra: "VARELA", rubro: "OTRO RUBRO A MANO", estado: "Pendiente", ingresoFecha: "", tipo: "material", estadoContratacion: null }];
    await guardarPedidosIndex();
    await guardarPedidoDetalle({ id: "manual-1", numero: 89, rubro: "OTRO RUBRO A MANO", items: [{ desc: "cargado a mano", cant: "1", un: "UND", imagen: null, entregado: 0, cerrado: false }] });
    await recuperarPedidosIncidente();
    const p89 = pedidosIndex.find(p => p.numero === 89);
    const det89 = await cargarPedidoDetalle("manual-1");
    return {
      siguioSiendoElManual: p89 && p89.id === "manual-1" && p89.rubro === "OTRO RUBRO A MANO",
      itemManualIntacto: det89 && det89.items[0].desc === "cargado a mano",
      totalFinal: pedidosIndex.length,
    };
  });

  // ---- 5) Sin ser Administrador, la función rechaza y no crea nada ----
  const comoNoAdmin = await page.evaluate(async () => {
    pedidosIndex = [];
    await guardarPedidosIndex();
    ingresarComo({ username: "capataz1", role: "capataz", permisos: {} });
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/Administrador/.test(msg)) huboToast = true; original(msg); };
    await recuperarPedidosIncidente();
    showToast = original;
    return { huboToast, noCreoNada: pedidosIndex.length === 0 };
  });

  const resultado = { r1, r2: { ...r2, numerosCount: r2.numeros.length }, detalle0122, correlativoAntes, correlativoDespues, r3, r4, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1.bannerVisible) fallas.push("BUG: con pedidos pendientes de recuperar, el banner no aparece");
  if (String(r1.cantidad) !== String(r1.totalEsperado)) fallas.push(`BUG: el banner no muestra la cantidad correcta, dio '${r1.cantidad}' (esperado ${r1.totalEsperado})`);

  if (r2.totalEnIndice !== r1.totalEsperado) fallas.push(`BUG: deberían quedar ${r1.totalEsperado} pedidos en el índice, hay ${r2.totalEnIndice}`);
  if (!r2.pedido0122 || r2.pedido0122.numero !== 122) fallas.push("BUG: el pedido N° 0122 no quedó con su número original");
  if (!r2.pedido0054 || r2.pedido0054.tipo !== "contratacion") fallas.push("BUG: el pedido N° 0054 debería quedar tipo 'contratacion'");
  if (!r2.pedido0023 || r2.pedido0023.tipo !== "contratacion" || r2.pedido0023.estadoContratacion !== "en_ejecucion") fallas.push("BUG: el pedido N° 0023 (solo contratación, sin materiales) no quedó bien");
  if (detalle0122.rubro !== "ELECTRICIDAD") fallas.push(`BUG: rubro del pedido 0122 incorrecto: ${detalle0122.rubro}`);
  if (detalle0122.resp !== "JESUS CHIMINO") fallas.push(`BUG: responsable del pedido 0122 incorrecto: ${detalle0122.resp}`);
  if (detalle0122.cantidadItems !== 18) fallas.push(`BUG: el pedido 0122 debería tener 18 materiales, tiene ${detalle0122.cantidadItems}`);
  if (correlativoDespues <= 124) fallas.push(`BUG: el correlativo para pedidos NUEVOS debería quedar por encima de 124 (el más alto recuperado), quedó en ${correlativoDespues} -- el próximo pedido nuevo chocaría con uno recuperado`);

  if (r3.despues !== r3.antes) fallas.push(`BUG: tocar "Recuperar pedidos" una segunda vez duplicó pedidos (${r3.antes} -> ${r3.despues}) -- debería ser idempotente`);

  if (!r4.siguioSiendoElManual) fallas.push("BUG CRÍTICO: un pedido N° 0089 ya cargado a mano fue pisado por el de recuperación -- debería respetarse el que ya existe");
  if (!r4.itemManualIntacto) fallas.push("BUG CRÍTICO: el contenido de un pedido manual existente se perdió al correr la recuperación");
  if (r4.totalFinal !== r1.totalEsperado) fallas.push(`BUG: con un pedido manual ya cargado, el total final debería seguir siendo ${r1.totalEsperado}, dio ${r4.totalFinal}`);

  if (!comoNoAdmin.huboToast) fallas.push("BUG: un Capataz (no admin) puede correr la recuperación sin aviso");
  if (!comoNoAdmin.noCreoNada) fallas.push("BUG DE SEGURIDAD: un Capataz (no admin) pudo crear pedidos con la función de recuperación");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE RECUPERACIÓN MASIVA DE PEDIDOS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
