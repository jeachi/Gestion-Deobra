// Generaliza el fix de Certificados: #fab-guardar-flotante es un único elemento que reusan TODOS
// los módulos. El único lugar donde de verdad se superponen dos "dueños" es el editor de un
// polígono del Plano de avance (su "✓ Listo"), que puede abrirse arriba de OTRO formulario sin
// guardar (ej: un Certificado, vía "Marcar avance"). Antes, terminar de editar el polígono
// OCULTABA el botón sin devolvérselo a quien lo tenía antes -- ahora editarPoligono/salirDeEdicion
// (y los dos cortes de edición dentro de deshacer/rehacer) usan pedirPrestadoBotonFlotanteGuardar
// / devolverBotonFlotanteGuardar, que SÍ lo devuelven. Prueba el mecanismo genérico con las
// funciones reales del plano, no con una simulación manual.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    irA("planoavance");
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
    imagenPlano = img;
    poligonos = [
      { nombreCompleto: "Pared - Estructura", nombreBase: "Pared", capa: "Estructura", color: "#3B82F6", patron: "solido", puntos: [[0,0],[10,0],[10,10],[0,10]], area: 100 },
      { nombreCompleto: "Piso - Carpeta", nombreBase: "Piso", capa: "Carpeta", color: "#10B981", patron: "solido", puntos: [[20,20],[30,20],[30,30],[20,30]], area: 100 },
    ];
    historialPoligonos = [];
    historialFuturo = [];
    iniciarCanvas();
  });
  await page.waitForTimeout(100);

  // ---- 1) Simula que un formulario de OTRO módulo (ej: Certificado) ya tenía su botón puesto ----
  const fabInicial = await page.evaluate(() => {
    mostrarBotonFlotanteGuardar("Guardar certificado", () => {}, "🧾");
    const fab = document.getElementById("fab-guardar-flotante");
    return { visible: fab.style.display === "flex", texto: document.getElementById("fab-guardar-texto").textContent };
  });

  // ---- 2) Editar un polígono del plano "presta" el botón (real editarPoligono, no simulado) ----
  const trasEditar = await page.evaluate(() => {
    editarPoligono(0);
    return {
      texto: document.getElementById("fab-guardar-texto").textContent,
      hayPrestamoGuardado: fabGuardarPrevio !== null,
      textoGuardadoEnPrestamo: fabGuardarPrevio ? fabGuardarPrevio.texto : null,
    };
  });

  // ---- 3) Reentrante: pasar a editar OTRO polígono sin terminar el primero no debe pisar el
  // snapshot original (debe seguir siendo "Guardar certificado", no "✓ Listo") ----
  const trasEditarOtro = await page.evaluate(() => {
    editarPoligono(1); // sin pasar por guardarEdicion/cancelarEdicion del polígono 0
    return {
      texto: document.getElementById("fab-guardar-texto").textContent,
      textoGuardadoEnPrestamo: fabGuardarPrevio ? fabGuardarPrevio.texto : null,
    };
  });

  // ---- 4) Terminar de editar (guardarEdicion -> salirDeEdicion) devuelve el botón original ----
  const trasGuardarEdicion = await page.evaluate(() => {
    guardarEdicion();
    return {
      texto: document.getElementById("fab-guardar-texto").textContent,
      visible: document.getElementById("fab-guardar-flotante").style.display === "flex",
      prestamoLimpio: fabGuardarPrevio === null,
    };
  });

  // ---- 5) Mismo mecanismo al cancelar en vez de guardar ----
  const trasCancelar = await page.evaluate(() => {
    mostrarBotonFlotanteGuardar("Guardar certificado", () => {}, "🧾"); // vuelve a simular el estado previo
    editarPoligono(0);
    cancelarEdicion();
    return { texto: document.getElementById("fab-guardar-texto").textContent };
  });

  // ---- 6) Si NO había nada antes (se entra a editar un polígono directo, sin ningún otro módulo
  // abierto), terminar de editar debe OCULTAR el botón, no mostrar algo vacío ----
  const sinNadaAntes = await page.evaluate(() => {
    ocultarBotonFlotanteGuardar(); // estado limpio, nada mostrándose
    editarPoligono(0);
    const duranteEdicion = document.getElementById("fab-guardar-flotante").style.display === "flex";
    guardarEdicion();
    return { duranteEdicion, visibleDespues: document.getElementById("fab-guardar-flotante").style.display === "flex" };
  });

  // ---- 7) Deshacer/rehacer con una edición de polígono en curso también devuelve el botón ----
  const conDeshacer = await page.evaluate(() => {
    mostrarBotonFlotanteGuardar("Guardar certificado", () => {}, "🧾");
    guardarEnHistorial();
    editarPoligono(0);
    const duranteEdicion = document.getElementById("fab-guardar-texto").textContent;
    deshacerGeneral();
    return { duranteEdicion, texto: document.getElementById("fab-guardar-texto").textContent, indiceEditandoLimpio: indiceEditando === null };
  });

  const resultado = { fabInicial, trasEditar, trasEditarOtro, trasGuardarEdicion, trasCancelar, sinNadaAntes, conDeshacer };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!fabInicial.visible || fabInicial.texto !== "Guardar certificado") fallas.push("BUG (del test): no se pudo simular el botón de otro módulo ya puesto");
  if (trasEditar.texto !== "✓ Listo (aceptar edición)") fallas.push(`BUG: editar un polígono no muestra "✓ Listo", muestra '${trasEditar.texto}'`);
  if (!trasEditar.hayPrestamoGuardado) fallas.push("BUG: editar un polígono no guardó el préstamo del botón anterior");
  if (trasEditar.textoGuardadoEnPrestamo !== "Guardar certificado") fallas.push(`BUG: el préstamo no guardó el texto correcto del botón anterior, guardó '${trasEditar.textoGuardadoEnPrestamo}'`);
  if (trasEditarOtro.texto !== "✓ Listo (aceptar edición)") fallas.push("BUG: pasar a editar otro polígono debería seguir mostrando '✓ Listo'");
  if (trasEditarOtro.textoGuardadoEnPrestamo !== "Guardar certificado") fallas.push(`BUG REENTRANTE: pasar a editar OTRO polígono sin terminar el primero pisó el préstamo original -- quedó '${trasEditarOtro.textoGuardadoEnPrestamo}' en vez de "Guardar certificado"`);
  if (trasGuardarEdicion.texto !== "Guardar certificado") fallas.push(`BUG REAL (generalizado): terminar de editar un polígono no devolvió el botón de "Guardar certificado", quedó '${trasGuardarEdicion.texto}'`);
  if (!trasGuardarEdicion.visible) fallas.push("BUG: tras devolver el botón, no quedó visible");
  if (!trasGuardarEdicion.prestamoLimpio) fallas.push("BUG: tras devolver el botón, el préstamo no se limpió (quedaría mal la próxima vez)");
  if (trasCancelar.texto !== "Guardar certificado") fallas.push(`BUG: cancelar una edición (en vez de guardarla) no devuelve el botón anterior, quedó '${trasCancelar.texto}'`);
  if (!sinNadaAntes.duranteEdicion) fallas.push("BUG: editar un polígono sin nada previo debería igual mostrar '✓ Listo' durante la edición");
  if (sinNadaAntes.visibleDespues) fallas.push("BUG: si no había nada antes de editar, terminar la edición debería OCULTAR el botón (no mostrar uno vacío)");
  if (conDeshacer.duranteEdicion !== "✓ Listo (aceptar edición)") fallas.push("BUG (del test): no se pudo dejar una edición de polígono en curso para probar deshacer");
  if (conDeshacer.texto !== "Guardar certificado") fallas.push(`BUG: deshacer con una edición de polígono en curso no devolvió el botón anterior, quedó '${conDeshacer.texto}'`);
  if (!conDeshacer.indiceEditandoLimpio) fallas.push("BUG: deshacer con una edición en curso no salió del modo edición");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL PRÉSTAMO DEL BOTÓN FLOTANTE OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
