// Ronda 2 de auditoría -- Pedidos: 4 arreglos.
// 1) eliminarPedido() no reciclaba el correlativo del último pedido borrado (mismo bug ya
//    arreglado en Caja Chica/Remitos/Minutas).
// 2) renderSelectsPedido() no protegía un rubro huérfano (ya borrado del catálogo) al editar un
//    pedido viejo -- el <select> quedaba en blanco.
// 3) El <select> de Unidad de un ítem cuya unidad ya se borró del catálogo (Configuración) quedaba
//    en blanco al reabrir el pedido, en vez de conservar el dato real como excepción (mismo
//    criterio ya usado para Obra/Rubro).
// 4) ejecutarGuardarFlotante() no bloqueaba un doble-toque -- podía duplicar el correlativo.
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
    obraPredeterminada = "ObraA";
    obras = ["ObraA"];
    obrasFinalizadas = [];
    rubros = ["Albañilería", "Electricidad"];
    unidades = ["kg", "m2"];

    // ---- 1) Reciclado de correlativo al borrar el último pedido ----
    pedidosIndex = [{ id: "p1", numero: 40, obra: "ObraA", rubro: "Albañilería", estado: "Pendiente" }];
    pedidosCache = {};
    correlativoSiguiente = 41;
    pedidoAbiertoId = "p1";
    await eliminarPedido();
    const r1_reciclado = correlativoSiguiente === 40;

    // ---- 2) Rubro huérfano al editar un pedido viejo ----
    const pedidoViejo = { id: "pv1", numero: 30, obra: "ObraA", rubro: "Plomería (ya no existe)", items: [{ desc: "Caño", cant: "5", un: "m", imagen: null }], ingreso: {}, adjuntos: [] };
    pedidosIndex = [pedidoViejo];
    npItems = [];
    npAdjuntos = [];
    prepararFormularioNuevoPedido(pedidoViejo);
    const r2_rubroVisible = document.getElementById("np-rubro").value === "Plomería (ya no existe)";

    // ---- 3) Select de Unidad conserva una unidad ya borrada del catálogo ----
    npItems = [{ desc: "Cemento", cant: "10", un: "kg", imagen: null }, { desc: "Ladrillo", cant: "3", un: "unidad-vieja-borrada", imagen: null }];
    renderTablaItemsPedido();
    const selects = [...document.querySelectorAll("#tbody-items-pedido select")];
    const r3_unidadesOk = selects.length >= 2 && selects[0].value === "kg" && selects[1].value === "unidad-vieja-borrada";

    // ---- 4) Doble-toque en el botón flotante de guardar ----
    let llamadas = 0;
    let resolverPrimera;
    const accionLenta = () => new Promise(resolve => { llamadas++; resolverPrimera = resolve; });
    mostrarBotonFlotanteGuardar("Guardar", accionLenta, "📦");
    const btn = document.getElementById("fab-guardar-flotante");
    const p1_promise = ejecutarGuardarFlotante(); // no await todavía
    await new Promise(r => setTimeout(r, 10));
    const r4_deshabilitadoMientrasGuarda = btn.disabled === true;
    ejecutarGuardarFlotante(); // "segundo toque" mientras la primera sigue en curso
    await new Promise(r => setTimeout(r, 10));
    const r4_soloUnaLlamada = llamadas === 1;
    resolverPrimera();
    await p1_promise;
    const r4_rehabilitadoAlTerminar = btn.disabled === false;

    return { r1_reciclado, r2_rubroVisible, r3_unidadesOk, r4_deshabilitadoMientrasGuarda, r4_soloUnaLlamada, r4_rehabilitadoAlTerminar };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_reciclado) fallas.push("BUG REPRODUCIDO: eliminarPedido() debería reciclar el correlativo del último pedido borrado");
  if (!resultado.r2_rubroVisible) fallas.push("BUG REPRODUCIDO: el rubro huérfano de un pedido viejo debería seguir visible en el <select> al editarlo");
  if (!resultado.r3_unidadesOk) fallas.push("BUG REPRODUCIDO: el <select> de Unidad debería reflejar it.un al renderizar la tabla de ítems");
  if (!resultado.r4_deshabilitadoMientrasGuarda) fallas.push("BUG REPRODUCIDO: el botón flotante debería deshabilitarse mientras la acción de guardar está en curso");
  if (!resultado.r4_soloUnaLlamada) fallas.push("BUG REPRODUCIDO: un segundo toque mientras el primero está en curso no debería disparar la acción de nuevo");
  if (!resultado.r4_rehabilitadoAlTerminar) fallas.push("El botón debería rehabilitarse una vez que termina de guardar");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PEDIDOS (RONDA 2) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
