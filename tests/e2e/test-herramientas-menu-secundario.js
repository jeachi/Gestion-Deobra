// Pedido del usuario (auditoría, visual): la tarjeta de Herramientas podía llegar a mostrar hasta
// 7 botones apretados en una grilla de 2 columnas para el Administrador (Observación, hasta 3
// cambios de estado, Historial, Editar, Eliminar). Se agrupan los de consulta/administración
// (Historial/Editar/Eliminar) atrás de un botón "⋯ Más" -- Observación y los cambios de estado
// (el flujo de uso diario) se quedan siempre visibles, sin moverse de lugar. Cada tarjeta se
// abre/cierra de forma independiente, y un usuario sin ser Administrador no ve ningún cambio
// (sigue viendo solo Observación, sin "⋯" -- no hay nada que esconderle).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA", "LANUS"]; obrasFinalizadas = [];
    usuarios = [
      { username: "admin", role: "admin", password: "x".repeat(64) },
      { username: "capataz", role: "capataz", permisos: {} },
    ];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    herramientas = [
      { id: "h1", nombre: "Taladro Bosch", obra: "VARELA", cantidad: 1, estado: "bien", observaciones: [], reparacion: null, prestamo: null, timestamp: new Date().toISOString() },
      { id: "h2", nombre: "Amoladora", obra: "VARELA", cantidad: 1, estado: "bien", observaciones: [], reparacion: null, prestamo: null, timestamp: new Date().toISOString() },
    ];
    irA("herramientas");
    document.getElementById("herr-filtro-obra").value = "";
    renderInventarioHerramientas();
  });
  await page.waitForTimeout(150);

  // ---- 1) Arranca colapsado: Historial/Editar/Eliminar no están visibles, pero sí en el DOM ----
  const r1 = await page.evaluate(() => {
    const tarjeta = document.querySelectorAll(".herr-item")[0];
    const sec = tarjeta.querySelector(".herr-acciones-secundarias");
    return {
      existeSecundaria: !!sec,
      arrancaColapsada: sec && !sec.classList.contains("show"),
      estaOculta: sec && getComputedStyle(sec).display === "none",
      tieneHistorial: sec.innerHTML.includes("Historial"),
      tieneEditar: sec.innerHTML.includes("Editar"),
      tieneEliminar: sec.innerHTML.includes("Eliminar"),
      textoBotonMas: tarjeta.querySelector(".herr-btn-mas").textContent.trim(),
      // Lo que SÍ debe seguir siempre visible, sin moverse detrás de "Más":
      observacionVisible: !!tarjeta.querySelector(".herr-acciones-grid button[onclick*=\"abrirModalObservacion\"]"),
      danadaVisible: !!tarjeta.querySelector(".herr-acciones-grid button[onclick*=\"abrirModalDanada\"]"),
    };
  });

  // ---- 2) Tocar "⋯ Más" en la PRIMERA tarjeta la despliega, y cambia el texto a "▲ Menos" ----
  await page.click('.herr-item:nth-of-type(1) .herr-btn-mas');
  await page.waitForTimeout(80);
  const r2 = await page.evaluate(() => {
    const tarjetas = document.querySelectorAll(".herr-item");
    const sec1 = tarjetas[0].querySelector(".herr-acciones-secundarias");
    const sec2 = tarjetas[1].querySelector(".herr-acciones-secundarias");
    return {
      primeraDesplegada: sec1.classList.contains("show") && getComputedStyle(sec1).display !== "none",
      textoPrimeraCambio: tarjetas[0].querySelector(".herr-btn-mas").textContent.trim(),
      // La SEGUNDA tarjeta no se vio afectada -- cada una se abre/cierra por separado.
      segundaSigueColapsada: !sec2.classList.contains("show"),
      textoSegundaSigueMas: tarjetas[1].querySelector(".herr-btn-mas").textContent.trim(),
    };
  });

  // ---- 3) Tocar de nuevo "⋯ Más" (ahora "▲ Menos") la vuelve a colapsar ----
  await page.click('.herr-item:nth-of-type(1) .herr-btn-mas');
  await page.waitForTimeout(80);
  const r3 = await page.evaluate(() => {
    const sec1 = document.querySelectorAll(".herr-item")[0].querySelector(".herr-acciones-secundarias");
    return {
      volvioAColapsar: !sec1.classList.contains("show"),
      textoVolvioAMas: document.querySelectorAll(".herr-item")[0].querySelector(".herr-btn-mas").textContent.trim(),
    };
  });

  // ---- 4) Los botones dentro de "Más" siguen llamando a las mismas funciones de siempre ----
  await page.click('.herr-item:nth-of-type(1) .herr-btn-mas');
  await page.waitForTimeout(80);
  const r4_historial = await page.evaluate(() => {
    document.querySelector(".herr-item .herr-acciones-secundarias button[onclick*=\"abrirHistorialHerramienta\"]").click();
    return { overlayAbierto: document.getElementById("herr-modal-overlay").style.display === "flex" };
  });

  // ---- 5) Sin ser Administrador: no hay botón "⋯ Más" (solo Observación, nada que esconder) ----
  const comoNoAdmin = await page.evaluate(() => {
    ingresarComo({ username: "capataz", role: "capataz", permisos: {} });
    renderInventarioHerramientas();
    const tarjeta = document.querySelectorAll(".herr-item")[0];
    return {
      sinBotonMas: !tarjeta.querySelector(".herr-btn-mas"),
      sinSeccionSecundaria: !tarjeta.querySelector(".herr-acciones-secundarias"),
      sigueViendoObservacion: !!tarjeta.querySelector("button[onclick*=\"abrirModalObservacion\"]"),
    };
  });

  const resultado = { r1, r2, r3, r4_historial, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1.existeSecundaria) fallas.push("BUG: no existe el contenedor .herr-acciones-secundarias");
  if (!r1.arrancaColapsada) fallas.push("BUG: el menú secundario no arranca colapsado (sin la clase 'show')");
  if (!r1.estaOculta) fallas.push("BUG: el menú secundario arranca visible (display distinto de 'none')");
  if (!r1.tieneHistorial) fallas.push("BUG: Historial no está dentro del menú secundario");
  if (!r1.tieneEditar) fallas.push("BUG: Editar no está dentro del menú secundario");
  if (!r1.tieneEliminar) fallas.push("BUG: Eliminar no está dentro del menú secundario");
  if (r1.textoBotonMas !== "⋯ Más") fallas.push(`BUG: el botón para desplegar no dice "⋯ Más", dice '${r1.textoBotonMas}'`);
  if (!r1.observacionVisible) fallas.push("BUG: Observación debería seguir siempre visible (no atrás de Más)");
  if (!r1.danadaVisible) fallas.push("BUG: el cambio de estado (Marcar como dañada) debería seguir siempre visible (no atrás de Más)");

  if (!r2.primeraDesplegada) fallas.push("BUG: tocar '⋯ Más' no desplegó el menú secundario de esa tarjeta");
  if (r2.textoPrimeraCambio !== "▲ Menos") fallas.push(`BUG: tras desplegar, el botón debería decir "▲ Menos", dice '${r2.textoPrimeraCambio}'`);
  if (!r2.segundaSigueColapsada) fallas.push("BUG REPRODUCIDO: desplegar el menú de la primera tarjeta afectó a la segunda -- deberían ser independientes");
  if (r2.textoSegundaSigueMas !== "⋯ Más") fallas.push(`BUG: el botón de la segunda tarjeta no debería haber cambiado, dice '${r2.textoSegundaSigueMas}'`);

  if (!r3.volvioAColapsar) fallas.push("BUG: tocar de nuevo el botón (ya en '▲ Menos') no volvió a colapsar el menú");
  if (r3.textoVolvioAMas !== "⋯ Más") fallas.push(`BUG: tras colapsar de nuevo, el texto debería volver a "⋯ Más", dice '${r3.textoVolvioAMas}'`);

  if (!r4_historial.overlayAbierto) fallas.push("BUG: el botón Historial dentro de 'Más' no abrió el modal de historial");

  if (!comoNoAdmin.sinBotonMas) fallas.push("BUG: un Capataz (no admin) ve el botón '⋯ Más' -- no debería, no tiene nada que esconder");
  if (!comoNoAdmin.sinSeccionSecundaria) fallas.push("BUG: un Capataz (no admin) tiene el contenedor del menú secundario en el DOM -- no debería existir para él");
  if (!comoNoAdmin.sigueViendoObservacion) fallas.push("BUG: un Capataz (no admin) debería seguir viendo el botón de Observación");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL MENÚ SECUNDARIO '⋯ MÁS' DE HERRAMIENTAS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
