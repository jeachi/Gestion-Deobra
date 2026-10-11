// Pedido del usuario: mejoras visuales en toda la app (botones/chips ordenados). Son cambios de
// CSS/markup, no de lógica -- este test confirma que los botones siguen haciendo lo mismo de
// siempre después del reacomodo visual (no se perdió ningún onclick/id al reestructurar el HTML),
// más el nuevo aviso de "hay más pestañas para el costado" (marcarSubtabsConDesborde).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
    obraPredeterminada = "VARELA";
    obras = ["VARELA", "LANUS"];
    obrasFinalizadas = [];
    categorias = ["Oficial"];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    errorCargaTrabajadores = false;
    trabajadores = [];
    // ingresarComo() es lo que de verdad muestra #app-principal (display:"") -- sin pasar por acá,
    // aunque se pise sesionActual a mano, #app-principal sigue en display:none heredado del login,
    // y todo lo de adentro (incluidas las pestañas) mide ancho/alto CERO por más que su propio
    // "display" individual diga "block".
    ingresarComo({ username: "admin", role: "admin", permisos: {} });

    // ---- 1) Catálogo de obras: ★ / Finalizar / ✕ siguen funcionando con el nuevo markup en fila ----
    irA("trabajadores");
    cambiarVistaConfig("obras");
    renderCatalogos();
    const filaLanus = [...document.querySelectorAll("#lista-obras .catalogo-chip-obra")].find(d=>d.textContent.includes("LANUS"));
    const r1_tieneLaEstrella = !!filaLanus.querySelector(".btn-star");
    const r1_tieneFinalizar = !!filaLanus.querySelector(".btn-finalizar");
    const r1_tieneQuitar = !!filaLanus.querySelector(".btn-quitar-obra");
    filaLanus.querySelector(".btn-star").click();
    const r1_marcoPredeterminada = obraPredeterminada === "LANUS";
    filaLanus.querySelector(".btn-finalizar").click();
    const r1_finalizo = obrasFinalizadas.includes("LANUS");

    // ---- 2) Herramientas: la grilla nueva de botones sigue llamando a las mismas funciones ----
    herramientas = [{ id:"h1", nombre:"Taladro", obra:"VARELA", cantidad:1, estado:"bien", observaciones:[], reparacion:null, prestamo:null, timestamp:new Date().toISOString(), origenRemitoId:null }];
    irA("herramientas");
    const tarjeta = document.querySelector(".herr-item");
    const r2_tieneGrillaDeAcciones = !!tarjeta.querySelector(".herr-acciones-grid");
    const r2_eliminarFueraDeLaGrilla = !tarjeta.querySelector(".herr-acciones-grid .herr-btn-eliminar") && !!tarjeta.querySelector(".herr-btn-eliminar");
    // Eliminar usa confirmarDoble() (doble toque, no el confirm() nativo del navegador): el primer
    // toque solo cambia el texto a "¿Seguro?" -- recién el SEGUNDO toque ejecuta eliminarHerramienta.
    const cantidadAntes = herramientas.length;
    const btnEliminar = tarjeta.querySelector(".herr-btn-eliminar");
    btnEliminar.click();
    const r2_primerToqueNoBorraTodavia = herramientas.length === cantidadAntes && btnEliminar.dataset.confirmando==="1";
    btnEliminar.click();
    const r2_eliminarSigueFuncionando = herramientas.length === cantidadAntes - 1;

    // ---- 3) Flechita de "hay más pestañas": aparece en Configuración (5 pestañas, no entran) y
    // NO aparece en una tira de 2 que sí entra bien (quincena-toggle de la Grilla de Asistencia) ----
    irA("trabajadores");
    await new Promise(r=>setTimeout(r, 100));
    const subtabsConfig = document.getElementById("subtabs-config");
    const r3_apareceFlechaDondeNoEntra = subtabsConfig.classList.contains("desborda") && !!subtabsConfig.querySelector(".desborda-flecha");

    irA("asistencia");
    cambiarVista("grilla");
    await new Promise(r=>setTimeout(r, 100));
    await new Promise(r=>requestAnimationFrame(r));
    const toggleQuincena = document.querySelector(".quincena-toggle:not(#subtabs-asistencia):not(#subtabs-config)");
    const r3_noApareceFlechaDondeSiEntra = toggleQuincena ? !toggleQuincena.classList.contains("desborda") : true;

    // ---- 4) El espacio reservado abajo de cada pantalla (para que el botón flotante no tape la
    // última tarjeta) está presente ----
    const paddingBottom = getComputedStyle(document.getElementById("view-herramientas")).paddingBottom;
    const r4_tieneEspacioReservadoAbajo = parseInt(paddingBottom, 10) >= 100;

    return {
      r1_tieneLaEstrella, r1_tieneFinalizar, r1_tieneQuitar, r1_marcoPredeterminada, r1_finalizo,
      r2_tieneGrillaDeAcciones, r2_eliminarFueraDeLaGrilla, r2_eliminarSigueFuncionando,
      r3_apareceFlechaDondeNoEntra, r3_noApareceFlechaDondeSiEntra,
      r4_tieneEspacioReservadoAbajo,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_tieneLaEstrella) fallas.push("La fila de obra debería tener el botón de estrella");
  if (!resultado.r1_tieneFinalizar) fallas.push("La fila de obra debería tener el botón de Finalizar");
  if (!resultado.r1_tieneQuitar) fallas.push("La fila de obra debería tener el botón de quitar");
  if (!resultado.r1_marcoPredeterminada) fallas.push("REGRESIÓN: tocar la estrella ya no marca la obra predeterminada");
  if (!resultado.r1_finalizo) fallas.push("REGRESIÓN: tocar Finalizar ya no finaliza la obra");
  if (!resultado.r2_tieneGrillaDeAcciones) fallas.push("La tarjeta de herramienta debería tener la grilla de acciones ordenada");
  if (!resultado.r2_eliminarFueraDeLaGrilla) fallas.push("Eliminar debería quedar FUERA de la grilla de 2 columnas, separado");
  if (!resultado.r2_eliminarSigueFuncionando) fallas.push("REGRESIÓN: el botón Eliminar de Herramientas ya no pide confirmación");
  if (!resultado.r3_apareceFlechaDondeNoEntra) fallas.push("Debería aparecer la flecha de 'hay más' en Configuración (5 pestañas no entran en 390px)");
  if (!resultado.r3_noApareceFlechaDondeSiEntra) fallas.push("No debería aparecer la flecha en una tira de pestañas que sí entra completa");
  if (!resultado.r4_tieneEspacioReservadoAbajo) fallas.push("Debería haber espacio reservado abajo para que el botón flotante no tape la última tarjeta");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE LAS MEJORAS VISUALES OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
