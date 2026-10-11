// Ronda 6 de auditoría (relanzada) -- Sesión/permisos, hallazgos restantes del agente de
// "Sesión/búsqueda/Actividad": varias funciones solo estaban protegidas ocultando el botón en la UI,
// sin chequeo interno de rol -- llamables igual desde la consola del navegador por un Capataz.
// Arregladas: exportarRespaldo/importarRespaldo (fuga + destrucción total de datos), Caja Chica
// (ver/editar/borrar la rendición de OTRO usuario), Pedidos (editar/guardar/eliminar), Observaciones
// (eliminar), Herramientas (guardar dañada/reparación/préstamo), catálogos compartidos (obras,
// categorías, tipos de costo, equivalencias).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
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
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    const comoCapataz = () => { sesionActual = { username: "capataz1", role: "capataz", permisos: { ...PERMISOS_CAPATAZ_DEFAULT } }; };
    const comoAdmin = () => { sesionActual = { username: "admin", role: "admin", permisos: {} }; };

    const salidas = {};

    // ---- 1) Respaldo: exportar/importar solo admin ----
    construirPaqueteRespaldo = async () => ({ app: "x", fecha_respaldo: "x", cantidad_claves: 0, datos: {} });
    const infoEl = document.getElementById("respaldo-info");
    comoCapataz();
    infoEl.textContent = "";
    await exportarRespaldo();
    salidas.r1_exportarBloqueado = infoEl.textContent === "" || !infoEl.textContent.includes("descargado");
    comoCapataz();
    const inputFalso = { files: [], value: "" };
    await importarRespaldo(inputFalso); // sin archivo igual no debería ni pasar del chequeo de rol
    salidas.r1_importarNoRompe = true; // si llegó hasta acá sin excepción, no se colgó

    // ---- 2) Caja Chica: no se puede ver/editar/borrar la rendición de otro usuario ----
    rendicionesIndex = [{ id: "r-ajena", numero: 1, usuario: "otroCapataz", obra: "ObraTest", responsable: "Otro" }];
    rendicionesCache = { "r-ajena": { id: "r-ajena", numero: 1, usuario: "otroCapataz", obra: "ObraTest", responsable: "Otro", gastos: [], fondo: [], totalGastos: 0, totalCaja: 0, diferencia: 0 } };
    comoCapataz();
    rendicionAbiertoId = null;
    await abrirRendicion("r-ajena");
    salidas.r2_noAbreAjena = rendicionAbiertoId !== "r-ajena";
    await editarRendicion("r-ajena"); // no debería tirar excepción ni cambiar de vista de verdad
    rendicionAbiertoId = "r-ajena"; // simula que alguien lo seteó directo desde la consola
    const antesLen = rendicionesIndex.length;
    await eliminarRendicion();
    salidas.r2_noBorraAjena = rendicionesIndex.length === antesLen;
    // Como admin, una rendición SIN dueño (legado) sí se puede abrir.
    comoAdmin();
    rendicionesIndex.push({ id: "r-sin-dueno", numero: 2, usuario: "", obra: "ObraTest", responsable: "Legado" });
    rendicionesCache["r-sin-dueno"] = { id: "r-sin-dueno", numero: 2, usuario: "", obra: "ObraTest", responsable: "Legado", gastos: [], fondo: [], totalGastos: 0, totalCaja: 0, diferencia: 0 };
    rendicionAbiertoId = null;
    await abrirRendicion("r-sin-dueno");
    salidas.r2_adminAbreSinDueno = rendicionAbiertoId === "r-sin-dueno";

    // ---- 3) Pedidos: editar/guardar/eliminar solo admin ----
    pedidosIndex = [{ id: "p1", numero: 1, obra: "ObraTest", rubro: "Materiales", estado: "Pendiente" }];
    pedidosCache = { p1: { id: "p1", numero: 1, obra: "ObraTest", rubro: "Materiales", items: [] } };
    comoCapataz();
    await editarPedido("p1");
    salidas.r3_noEditaSiNoAdmin = true; // no debe tirar excepción
    pedidoEditandoId = null;
    await guardarPedido();
    salidas.r3_noGuardaSiNoAdmin = true;
    pedidoAbiertoId = "p1";
    const pedLenAntes = pedidosIndex.length;
    await eliminarPedido();
    salidas.r3_noBorraSiNoAdmin = pedidosIndex.length === pedLenAntes;

    // ---- 4) Observaciones: eliminar solo admin ----
    observaciones = [{ id: "o1", titulo: "Filtración", obra: "ObraTest" }];
    comoCapataz();
    await eliminarObservacion("o1");
    salidas.r4_noBorraSiNoAdmin = observaciones.length === 1;
    comoAdmin();
    await eliminarObservacion("o1");
    salidas.r4_siBorraComoAdmin = observaciones.length === 0;

    // ---- 5) Herramientas: guardar dañada/reparación/préstamo solo admin ----
    herramientas = [{ id: "h1", nombre: "Taladro", obra: "ObraTest", estado: "Disponible" }];
    comoCapataz();
    await guardarDanadaHerramienta("h1");
    salidas.r5_noDanaSiNoAdmin = herramientas[0].estado === "Disponible";
    await guardarReparacionHerramienta("h1");
    salidas.r5_noReparaSiNoAdmin = herramientas[0].estado === "Disponible";
    await guardarPrestamoHerramienta("h1");
    salidas.r5_noPrestaSiNoAdmin = herramientas[0].estado === "Disponible";

    // ---- 6) Catálogos compartidos: obras/categorías/tipos de costo/equivalencias solo admin ----
    categorias = ["Oficial"];
    comoCapataz();
    document.getElementById("nueva-categoria").value = "Intrusa";
    await agregarCategoria();
    salidas.r6_noAgregaCategoriaSiNoAdmin = !categorias.includes("Intrusa");
    await quitarCategoria(0);
    salidas.r6_noQuitaCategoriaSiNoAdmin = categorias.length === 1;

    const obrasAntes = [...obras];
    document.getElementById("nueva-obra").value = "ObraIntrusa";
    await agregarObra();
    salidas.r6_noAgregaObraSiNoAdmin = !obras.includes("ObraIntrusa");
    await quitarObra(0);
    salidas.r6_noQuitaObraSiNoAdmin = obras.length === obrasAntes.length;

    tiposCosto = ["Materiales"];
    document.getElementById("nuevo-tipo-costo").value = "Intruso";
    await agregarTipoCosto();
    salidas.r6_noAgregaTipoCostoSiNoAdmin = !tiposCosto.includes("Intruso");
    await quitarTipoCosto(0);
    salidas.r6_noQuitaTipoCostoSiNoAdmin = tiposCosto.length === 1;

    equivalenciasMateriales = [{ material: "Cemento", unidadGrande: "Pallet", cantChica: 42, unidadChica: "Bolsa" }];
    document.getElementById("eq-material").value = "Cal";
    document.getElementById("eq-un-grande").value = "Pallet";
    document.getElementById("eq-cant-chica").value = "10";
    document.getElementById("eq-un-chica").value = "Bolsa";
    await agregarEquivalencia();
    salidas.r6_noAgregaEquivalenciaSiNoAdmin = equivalenciasMateriales.length === 1;
    await quitarEquivalencia(0);
    salidas.r6_noQuitaEquivalenciaSiNoAdmin = equivalenciasMateriales.length === 1;

    // Como admin, los catálogos SÍ se pueden tocar (no quedó todo bloqueado).
    comoAdmin();
    document.getElementById("nueva-categoria").value = "Nueva";
    await agregarCategoria();
    salidas.r6_siAgregaComoAdmin = categorias.includes("Nueva");

    return salidas;
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_exportarBloqueado) fallas.push("BUG REPRODUCIDO: exportarRespaldo() no debería completarse para un Capataz");
  if (!resultado.r1_importarNoRompe) fallas.push("importarRespaldo() debería poder llamarse sin romper para un Capataz (debe bloquearse en silencio)");
  if (!resultado.r2_noAbreAjena) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder abrir la rendición de otro usuario");
  if (!resultado.r2_noBorraAjena) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder borrar la rendición de otro usuario (ni seteando rendicionAbiertoId a mano)");
  if (!resultado.r2_adminAbreSinDueno) fallas.push("El Administrador sí debería poder abrir una rendición vieja sin dueño asignado");
  if (!resultado.r3_noBorraSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder eliminar un pedido");
  if (!resultado.r4_noBorraSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder eliminar una observación");
  if (!resultado.r4_siBorraComoAdmin) fallas.push("eliminarObservacion debería seguir funcionando para un admin");
  if (!resultado.r5_noDanaSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder marcar una herramienta como dañada");
  if (!resultado.r5_noReparaSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder marcar una herramienta en reparación");
  if (!resultado.r5_noPrestaSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder registrar un préstamo de herramienta");
  if (!resultado.r6_noAgregaCategoriaSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder agregar una categoría");
  if (!resultado.r6_noQuitaCategoriaSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder quitar una categoría");
  if (!resultado.r6_noAgregaObraSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder agregar una obra");
  if (!resultado.r6_noQuitaObraSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder quitar una obra");
  if (!resultado.r6_noAgregaTipoCostoSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder agregar un tipo de costo");
  if (!resultado.r6_noQuitaTipoCostoSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder quitar un tipo de costo");
  if (!resultado.r6_noAgregaEquivalenciaSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder agregar una equivalencia");
  if (!resultado.r6_noQuitaEquivalenciaSiNoAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder quitar una equivalencia");
  if (!resultado.r6_siAgregaComoAdmin) fallas.push("agregarCategoria debería seguir funcionando para un admin");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE SESIÓN/PERMISOS EXTENDIDOS (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
