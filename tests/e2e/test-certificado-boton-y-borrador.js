// Reporte del usuario: "2 veces se me desapareció el botón de guardar certificado y al salir se
// había perdido el certificado". Dos cambios:
// 1) BUG real: el botón flotante de guardar es un único elemento compartido en toda la app
//    (#fab-guardar-flotante) -- el editor de Plano de avance (que se abre como overlay ARRIBA del
//    formulario de certificado, vía "Marcar avance") lo reusa para sus propias cosas (ej: "✓ Listo"
//    al editar un polígono) y lo oculta al terminar. volverDesdeCertificadoAPlano() nunca lo volvía
//    a mostrar -- quedaba oculto para siempre aunque el certificado siguiera abierto debajo.
// 2) Red extra: autosave en localStorage de los valores tipeados (fecha/anotación/% por ítem),
//    SOLO en el dispositivo, NUNCA en el certificado real -- se restaura solo si de verdad difiere
//    de los valores por defecto, y se borra apenas se guarda de verdad (nunca crea un certificado
//    nuevo por sí solo).
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
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    try{ localStorage.removeItem("cert_borrador_c1_nuevo"); localStorage.removeItem("cert_borrador_c1_1"); }catch(e){}
    contratistasCache["c1"] = {
      id: "c1", nombre: "Contratista Test", obra: "VARELA",
      montoContrato: 100000, anticipoMonto: 0,
      items: [
        { id: "i1", nombre: "Estructura", pctIncidencia: 60 },
        { id: "i2", nombre: "Terminaciones", pctIncidencia: 40 },
      ],
      certificados: [],
    };
    contratistasIndex = [{ id: "c1", nombre: "Contratista Test", obra: "VARELA", montoContrato: 100000, anticipoMonto: 0, totalPagado: 0, saldoPendiente: 100000 }];
    planosIndex = [];
    irA("certificados");
  });

  // ---- 1) Abrir un certificado NUEVO, tipear valores (fecha, anotación, % de un ítem) ----
  const trasTipear = await page.evaluate(() => {
    abrirFormCertificado("c1", null);
    document.getElementById("cf-fecha").value = "2026-03-15";
    document.getElementById("cf-fecha").dispatchEvent(new Event("input"));
    document.getElementById("cf-anotacion").value = "Se avanzó con la estructura";
    document.getElementById("cf-anotacion").dispatchEvent(new Event("input"));
    actualizarFilaCertForm(0, "35");
    const borrador = JSON.parse(localStorage.getItem("cert_borrador_c1_nuevo") || "null");
    return { fabVisible: document.getElementById("fab-guardar-flotante").style.display === "flex", borrador };
  });

  // ---- 2) Se cierra el formulario SIN guardar (justo el escenario del bug: el botón desaparece,
  // el usuario termina saliendo) -- el borrador tiene que seguir en localStorage. ----
  const trasCerrarSinGuardar = await page.evaluate(() => {
    cerrarFormCertificado();
    return { borradorSigueGuardado: !!localStorage.getItem("cert_borrador_c1_nuevo") };
  });

  // ---- 3) Reabrir el MISMO certificado (nuevo, contratista c1) -- debe recuperar el borrador ----
  const trasReabrir = await page.evaluate(() => {
    let huboToastBorrador = false;
    const original = showToast;
    showToast = (msg) => { if (/borrador/.test(msg)) huboToastBorrador = true; original(msg); };
    abrirFormCertificado("c1", null);
    showToast = original;
    return {
      huboToastBorrador,
      fecha: document.getElementById("cf-fecha").value,
      anotacion: document.getElementById("cf-anotacion").value,
      pctItem1: document.getElementById("cf-input-0").value,
    };
  });

  // ---- 4) Guardar de verdad -- el borrador tiene que desaparecer ----
  const trasGuardar = await page.evaluate(async () => {
    await guardarCertificadoConfirmado();
    return {
      borradorBorrado: !localStorage.getItem("cert_borrador_c1_nuevo"),
      certificadosGuardados: contratistasCache["c1"].certificados.length,
      numeroGuardado: contratistasCache["c1"].certificados[0]?.numero,
      fechaGuardada: contratistasCache["c1"].certificados[0]?.fecha,
    };
  });

  // ---- 5) Si no se toca NADA, no hay borrador que restaurar ni toast de "borrador" ----
  const sinTocarNada = await page.evaluate(() => {
    abrirFormCertificado("c1", null); // ahora ya hay 1 certificado guardado, este es el 2do ("nuevo" de nuevo, mismo slot)
    let huboToastBorrador = false;
    const original = showToast;
    showToast = (msg) => { if (/borrador/.test(msg)) huboToastBorrador = true; original(msg); };
    cerrarFormCertificado(); // cierra sin tocar nada
    abrirFormCertificado("c1", null); // reabre -- no debería haber pasado nada raro
    showToast = original;
    return { huboToastBorrador, hayBorrador: !!localStorage.getItem("cert_borrador_c1_nuevo") };
  });
  await page.evaluate(() => cerrarFormCertificado());

  // ---- 6) EL BUG REAL: abrir un certificado, simular que el editor del plano (overlay) se roba
  // el botón flotante (como pasa al editar un polígono) y lo oculta, y después volver del plano al
  // certificado -- el botón de "Guardar cambios/certificado" tiene que reaparecer. ----
  const bugBotonDesaparecido = await page.evaluate(() => {
    abrirFormCertificado("c1", null);
    const fabAntes = document.getElementById("fab-guardar-flotante").style.display === "flex";

    // Simula entrar a "Marcar avance": el plano se abre como overlay arriba del certificado.
    const view = document.getElementById("view-planoavance");
    view.classList.add("active", "plano-modo-overlay");
    document.getElementById("btn-volver-certificado-plano").style.display = "block";

    // Simula lo que hace el editor del plano al terminar de editar un polígono: se roba el botón
    // flotante para su propio "✓ Listo" y lo oculta al terminar -- el bug real es que esto nunca
    // se revertía.
    mostrarBotonFlotanteGuardar("✓ Listo (aceptar edición)", ()=>{}, "✏️");
    ocultarBotonFlotanteGuardar();
    const fabRoboYOcultoPorElPlano = document.getElementById("fab-guardar-flotante").style.display === "none";

    volverDesdeCertificadoAPlano();

    const fab = document.getElementById("fab-guardar-flotante");
    return {
      fabAntes,
      fabRoboYOcultoPorElPlano,
      fabVisibleDespues: fab.style.display === "flex",
      textoFab: fab.textContent,
    };
  });

  const resultado = { trasTipear, trasCerrarSinGuardar, trasReabrir, trasGuardar, sinTocarNada, bugBotonDesaparecido };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!trasTipear.fabVisible) fallas.push("BUG: al abrir el formulario de certificado no aparece el botón flotante de guardar");
  if (!trasTipear.borrador) fallas.push("BUG: tipear valores no guardó ningún borrador en localStorage");
  else {
    if (trasTipear.borrador.fecha !== "2026-03-15") fallas.push(`BUG: el borrador no guardó la fecha tipeada, guardó '${trasTipear.borrador.fecha}'`);
    if (trasTipear.borrador.anotacion !== "Se avanzó con la estructura") fallas.push(`BUG: el borrador no guardó la anotación tipeada`);
    const item1 = (trasTipear.borrador.items || []).find(it => it.itemId === "i1");
    if (!item1 || Math.abs(item1.pctAcumulado - 0.35) > 0.0001) fallas.push(`BUG: el borrador no guardó el 35% tipeado en el ítem 1, guardó ${item1 && item1.pctAcumulado}`);
  }
  if (!trasCerrarSinGuardar.borradorSigueGuardado) fallas.push("BUG: cerrar el formulario sin guardar borró el borrador -- se perdería igual que antes");
  if (!trasReabrir.huboToastBorrador) fallas.push("BUG: reabrir el mismo certificado con un borrador pendiente no avisó que se recuperó uno");
  if (trasReabrir.fecha !== "2026-03-15") fallas.push(`BUG: al reabrir no se restauró la fecha del borrador, quedó '${trasReabrir.fecha}'`);
  if (trasReabrir.anotacion !== "Se avanzó con la estructura") fallas.push(`BUG: al reabrir no se restauró la anotación del borrador`);
  if (trasReabrir.pctItem1 !== "35.0") fallas.push(`BUG: al reabrir no se restauró el % del ítem 1, quedó '${trasReabrir.pctItem1}'`);
  if (!trasGuardar.borradorBorrado) fallas.push("BUG: guardar de verdad el certificado no borró el borrador -- quedaría reapareciendo para siempre");
  if (trasGuardar.certificadosGuardados !== 1) fallas.push(`BUG: debería haber quedado 1 certificado guardado, hay ${trasGuardar.certificadosGuardados}`);
  if (trasGuardar.fechaGuardada !== "2026-03-15") fallas.push(`BUG: el certificado guardado no tiene la fecha correcta, tiene '${trasGuardar.fechaGuardada}'`);
  if (sinTocarNada.huboToastBorrador) fallas.push("BUG: sin tocar nada, avisó de un borrador recuperado que no debería existir (no se escribió ninguno)");
  if (sinTocarNada.hayBorrador) fallas.push("BUG: sin tocar nada, quedó un borrador guardado en localStorage de todas formas");

  if (!bugBotonDesaparecido.fabAntes) fallas.push("BUG: al abrir el certificado no se ve el botón flotante de guardar");
  if (!bugBotonDesaparecido.fabRoboYOcultoPorElPlano) fallas.push("BUG (del test): no se pudo simular que el editor del plano se roba y oculta el botón");
  if (!bugBotonDesaparecido.fabVisibleDespues) fallas.push("BUG REAL REPORTADO: al volver del plano al certificado, el botón de guardar NO reaparece -- se pierde lo tipeado si no hay otra forma de guardar");
  if (!/Guardar certificado/.test(bugBotonDesaparecido.textoFab)) fallas.push(`BUG: al volver del plano, el botón debería decir "Guardar certificado" (es nuevo), dice '${bugBotonDesaparecido.textoFab}'`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL BOTÓN DE GUARDAR Y EL BORRADOR DE CERTIFICADO OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
