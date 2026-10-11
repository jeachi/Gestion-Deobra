// Ronda 5 de auditoría -- Pedidos de Materiales: 4 arreglos.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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

  const resultado = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];

    // ---- 1) actualizarEntrega clampa a >=0 (no acepta negativos) ----
    const pedido = { id: "p1", numero: 1, obra: "ObraTest", rubro: "Materiales", estado: "Parcial",
      items: [{ desc: "Cemento", cant: "100", un: "bolsas", entregado: 50, imagen: null, cerrado: false }] };
    pedidosCache = { p1: pedido };
    pedidoAbiertoId = "p1";
    actualizarEntrega(0, "-10");
    const r1_noQuedaNegativo = pedido.items[0].entregado === 0;
    actualizarEntrega(0, "30");
    const r1_aceptaPositivo = pedido.items[0].entregado === 30;

    // ---- 2) quitarFilaItem pide confirmación si el ítem ya tiene entregas/cerrado ----
    npItems = [
      { desc: "Cemento", cant: "100", un: "bolsas", entregado: 80, cerrado: false, imagen: null },
      { desc: "Arena", cant: "50", un: "m3", entregado: 0, cerrado: false, imagen: null },
    ];
    let confirmLlamado = false;
    const confirmOriginal = window.confirm;
    window.confirm = (msg) => { confirmLlamado = true; return false; }; // el usuario cancela
    quitarFilaItem(0);
    const r2_pidioConfirmacion = confirmLlamado;
    const r2_noBorroSiCancela = npItems.length === 2;
    confirmLlamado = false;
    window.confirm = () => true; // ahora confirma
    quitarFilaItem(0);
    const r2_borraSiConfirma = npItems.length === 1 && npItems[0].desc === "Arena";
    // Un ítem SIN entregas ni cierre no debería pedir confirmación.
    confirmLlamado = false;
    quitarFilaItem(0);
    const r2_sinConfirmacionSiNoHayRiesgo = !confirmLlamado;
    window.confirm = confirmOriginal;

    // ---- 3) El reporte individual de pendientes filtra ítems cerrados (igual que calcularFaltantes) ----
    const pedidoConCerrado = {
      id: "p2", numero: 2, obra: "ObraTest", rubro: "Materiales", fecha: "2026-01-01",
      items: [
        { desc: "Cemento", cant: "100", un: "bolsas", entregado: 60, cerrado: true },
        { desc: "Arena", cant: "50", un: "m3", entregado: 20, cerrado: false },
      ],
    };
    const htmlPendientes = construirHtmlPendientes(pedidoConCerrado);
    const r3_noListaCerrado = !htmlPendientes.includes("Cemento");
    const r3_listaElAbierto = htmlPendientes.includes("Arena");
    // calcularFaltantes (reporte general) debe seguir dando el mismo resultado (ya filtraba antes).
    const faltantesGeneral = calcularFaltantes(pedidoConCerrado);
    const r3_coincideConReporteGeneral = faltantesGeneral.length === 1 && faltantesGeneral[0].desc === "Arena";

    // ---- 4) aplicarLineaRemito avisa si no hay equivalencia para la unidad del remito ----
    equivalenciasMateriales = [];
    const pedidoRemito = { id: "p3", numero: 3, obra: "ObraTest", items: [{ desc: "Cemento", cant: "100", un: "Bolsa", entregado: 0 }] };
    const avisoSinEquivalencia = aplicarLineaRemito(pedidoRemito, { desc: "Cemento", un: "Bolsa", idx: 0 }, { unidadRemito: "Pallet" }, 3);
    const r4_avisaSinEquivalencia = typeof avisoSinEquivalencia === "string" && avisoSinEquivalencia.includes("Equivalencia");
    const r4_igualSuma = pedidoRemito.items[0].entregado === 3; // sigue sumando la cantidad cruda, solo avisa
    // Con equivalencia cargada, no debería avisar y debería convertir bien.
    equivalenciasMateriales = [{ material: "Cemento", unidadGrande: "Pallet", cantChica: 40, unidadChica: "Bolsa" }];
    pedidoRemito.items[0].entregado = 0;
    const avisoConEquivalencia = aplicarLineaRemito(pedidoRemito, { desc: "Cemento", un: "Bolsa", idx: 0 }, { unidadRemito: "Pallet" }, 2);
    const r4_sinAvisoConEquivalencia = avisoConEquivalencia === null;
    const r4_convierteBien = pedidoRemito.items[0].entregado === 80; // 2 pallets * 40 bolsas

    return { r1_noQuedaNegativo, r1_aceptaPositivo, r2_pidioConfirmacion, r2_noBorroSiCancela, r2_borraSiConfirma, r2_sinConfirmacionSiNoHayRiesgo, r3_noListaCerrado, r3_listaElAbierto, r3_coincideConReporteGeneral, r4_avisaSinEquivalencia, r4_igualSuma, r4_sinAvisoConEquivalencia, r4_convierteBien };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_noQuedaNegativo) fallas.push("BUG REPRODUCIDO: actualizarEntrega debería clampar un valor negativo a 0");
  if (!resultado.r1_aceptaPositivo) fallas.push("actualizarEntrega debería seguir aceptando valores positivos normales");
  if (!resultado.r2_pidioConfirmacion) fallas.push("BUG REPRODUCIDO: quitarFilaItem debería pedir confirmación si el ítem ya tiene entregas registradas");
  if (!resultado.r2_noBorroSiCancela) fallas.push("Si se cancela la confirmación, el ítem no debería borrarse");
  if (!resultado.r2_borraSiConfirma) fallas.push("Si se confirma, el ítem sí debería borrarse");
  if (!resultado.r2_sinConfirmacionSiNoHayRiesgo) fallas.push("Un ítem sin entregas ni cierre no debería pedir confirmación para borrarse");
  if (!resultado.r3_noListaCerrado) fallas.push("BUG REPRODUCIDO: el reporte individual de pendientes no debería listar un ítem cerrado");
  if (!resultado.r3_listaElAbierto) fallas.push("El reporte individual debería seguir listando los ítems pendientes normales");
  if (!resultado.r3_coincideConReporteGeneral) fallas.push("El reporte individual debería coincidir con calcularFaltantes (reporte general)");
  if (!resultado.r4_avisaSinEquivalencia) fallas.push("BUG REPRODUCIDO: debería avisar si no hay Equivalencia cargada para la unidad del remito");
  if (!resultado.r4_igualSuma) fallas.push("Aunque avise, debería seguir sumando la cantidad cruda (comportamiento previo)");
  if (!resultado.r4_sinAvisoConEquivalencia) fallas.push("Con una Equivalencia cargada no debería avisar nada");
  if (!resultado.r4_convierteBien) fallas.push("Con una Equivalencia cargada debería convertir bien la cantidad");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PEDIDOS (RONDA 5) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
