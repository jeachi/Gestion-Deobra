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
  console.log("App booted.");

  // ================= 1) Tracker accesible: cada paso es un botón propio con aria-current =================
  const r1 = await page.evaluate(() => {
    observaciones = [
      { id: "o1", titulo: "Falta baranda", obra: "ObraX", responsable: "Pedro", descripcion: "En escalera", prioridad: "alta", estado: "asignado", fecha: "2026-05-10" },
    ];
    errorCargaObservaciones = false;
    obsFiltroPrioridad = "";
    irA("observaciones");
    document.getElementById("obs-filtro-obra").innerHTML = `<option value="">Todas las obras</option>`;
    document.getElementById("obs-filtro-obra").value = "";
    renderListaObservaciones();
    const botones = document.querySelectorAll(".obs-item .estado-paso");
    return {
      cantidadPasos: botones.length,
      elActualTieneAriaCurrent: botones[1].getAttribute("aria-current") === "step",
      otrosNoTienenAriaCurrent: botones[0].getAttribute("aria-current") !== "step" && botones[2].getAttribute("aria-current") !== "step",
      textoVisible: document.getElementById("lista-observaciones").innerHTML.includes(">Materiales<"),
    };
  });
  console.log("1) Tracker accesible:", JSON.stringify(r1));
  if (r1.cantidadPasos !== 4) throw new Error(`1) Se esperaban 4 pasos clickeables, hubo ${r1.cantidadPasos}`);
  if (!r1.elActualTieneAriaCurrent) throw new Error("1) El paso actual (Materiales) debería tener aria-current=\"step\"");
  if (!r1.otrosNoTienenAriaCurrent) throw new Error("1) Los pasos que no son el actual no deberían tener aria-current");
  if (!r1.textoVisible) throw new Error("1) El texto 'Materiales' debería seguir visible en el paso");

  // ================= 2) Saltar directo a un paso más adelante =================
  const r2 = await page.evaluate(async () => {
    await tocarEstadoObservacion("o1", 3); // tocar "Resuelto" directo
    return observaciones[0].estado;
  });
  console.log("2) Salta directo a 'resuelto':", r2);
  if (r2 !== "resuelto") throw new Error(`2) Debería saltar directo a 'resuelto', quedó '${r2}'`);

  // ================= 3) Tocar el paso ACTUAL lo desactiva (corrige un toque por error) =================
  const r3 = await page.evaluate(async () => {
    // Ahora está en "resuelto" (idx 3) -- tocar el paso 3 de nuevo (el actual) debe volver a "en_curso" (idx 2).
    await tocarEstadoObservacion("o1", 3);
    return observaciones[0].estado;
  });
  console.log("3) Tocar el actual lo desactiva (vuelve al anterior):", r3);
  if (r3 !== "en_curso") throw new Error(`3) Debería volver a 'en_curso' al tocar el paso actual de nuevo, quedó '${r3}'`);

  // ================= 4) No puede bajar de "detectado" (piso en 0) =================
  const r4 = await page.evaluate(async () => {
    observaciones[0].estado = "detectado";
    await tocarEstadoObservacion("o1", 0); // tocar el actual (detectado) -- no debería romper ni bajar de 0
    return observaciones[0].estado;
  });
  console.log("4) No baja de 'detectado':", r4);
  if (r4 !== "detectado") throw new Error(`4) Debería quedarse en 'detectado' (no hay estado anterior), quedó '${r4}'`);

  // ================= 5) Foto de "después" -- botón, input compartido, y guardado =================
  const r5 = await page.evaluate(() => {
    const tieneInputCompartido = !!document.getElementById("obs-foto-despues-input");
    const tieneBotonEnFicha = document.getElementById("lista-observaciones").innerHTML.includes("elegirFotoObservacionDespues('o1')");
    elegirFotoObservacionDespues("o1");
    return { tieneInputCompartido, tieneBotonEnFicha, targetGuardado: obsFotoDespuesTargetId === "o1" };
  });
  console.log("5) Foto de después -- setup:", JSON.stringify(r5));
  if (!r5.tieneInputCompartido) throw new Error("5) Falta el <input> compartido para la foto de después");
  if (!r5.tieneBotonEnFicha) throw new Error("5) Falta el botón 'Foto de después' en la ficha de la observación");
  if (!r5.targetGuardado) throw new Error("5) elegirFotoObservacionDespues no guardó el id de destino");

  const r6 = await page.evaluate(async () => {
    // Simula elegir un archivo -- reemplaza abrirEditorMarcado por una versión que no abre UI,
    // solo para poder probar el guardado sin la pantalla de marcado real.
    const original = window.abrirEditorMarcado;
    window.abrirEditorMarcado = (dataUrl, cb) => cb(dataUrl);
    const original2 = window.comprimirImagenMiniatura;
    window.comprimirImagenMiniatura = (file, cb) => cb("data:image/png;base64,FAKEDESPUES");
    obsFotoDespuesTargetId = "o1";
    const inputFalso = { value: "x", files: [{ name: "foto.png" }] };
    await handleFotoObservacionDespues(inputFalso);
    window.abrirEditorMarcado = original;
    window.comprimirImagenMiniatura = original2;
    return { fotoDespues: observaciones[0].fotoDespues, inputLimpio: inputFalso.value === "" };
  });
  console.log("6) Guardar la foto de después:", JSON.stringify(r6));
  if (r6.fotoDespues !== "data:image/png;base64,FAKEDESPUES") throw new Error(`6) No se guardó la foto de después: ${JSON.stringify(r6)}`);
  if (!r6.inputLimpio) throw new Error("6) El <input> debería quedar vacío después de usarlo");

  // o1 no tiene foto de "antes" -- la de "después" recién guardada pasa a ocupar el lugar grande
  // de arriba (obs-foto) en vez de la miniatura chica de abajo (obs-foto-despues), para no dejar
  // ese lugar vacío cuando es la única foto que existe.
  const r6b = await page.evaluate(() => {
    renderListaObservaciones();
    const item = document.querySelector("#lista-observaciones .obs-item");
    const fotoArriba = item.querySelector("img.obs-foto");
    return {
      fotoArribaSrc: fotoArriba ? fotoArriba.getAttribute("src") : null,
      tieneMiniaturaAbajo: item.innerHTML.includes("obs-foto-despues"),
    };
  });
  if (r6b.fotoArribaSrc !== "data:image/png;base64,FAKEDESPUES") throw new Error(`6b) La foto de después no pasó al lugar grande de arriba (no hay foto de "antes"): ${JSON.stringify(r6b)}`);
  if (r6b.tieneMiniaturaAbajo) throw new Error("6b) No debería duplicarse la miniatura abajo si ya se muestra arriba");

  // ================= 7) El informe fotográfico agrupado por día llama a mostrarModalPDF =================
  const r7 = await page.evaluate(() => {
    observaciones = [
      { id: "a", titulo: "Filtración", obra: "ObraFoto", responsable: "Ana", descripcion: "", prioridad: "alta", estado: "resuelto", fecha: "2026-06-01", foto: "data:image/png;base64,ANTES1", fotoDespues: "data:image/png;base64,DESPUES1" },
      { id: "b", titulo: "Cerco roto", obra: "ObraFoto", responsable: "", descripcion: "", prioridad: "media", estado: "detectado", fecha: "2026-06-01", foto: "data:image/png;base64,ANTES2" },
      { id: "c", titulo: "Cable suelto", obra: "ObraFoto", responsable: "", descripcion: "", prioridad: "baja", estado: "detectado", fecha: "2026-06-02" },
    ];
    document.getElementById("obs-filtro-obra").innerHTML = `<option value="">Todas las obras</option>`;
    document.getElementById("obs-filtro-obra").value = "";
    let capturado = null;
    window.mostrarModalPDF = (html, orient, nombre) => { capturado = { html, orient, nombre }; };
    generarInformeFotograficoObservacionesPDF();
    return {
      llamado: !!capturado,
      tieneAmbosDias: capturado.html.includes("1 de junio") || (capturado.html.match(/lunes|martes/gi) || []).length >= 2 || (capturado.html.match(/junio/gi)||[]).length>=2,
      tieneAntesYDespues: capturado.html.includes("ANTES1") && capturado.html.includes("DESPUES1"),
      tieneSinFotoParaC: capturado.html.includes("Sin foto"),
      nombreArchivo: capturado.nombre,
    };
  });
  console.log("7) Informe fotográfico:", JSON.stringify({ ...r7, tieneAmbosDias: r7.tieneAmbosDias }));
  if (!r7.llamado) throw new Error("7) generarInformeFotograficoObservacionesPDF no llamó a mostrarModalPDF");
  if (!r7.tieneAntesYDespues) throw new Error("7) El informe no incluye las fotos de antes y después");
  if (!r7.tieneSinFotoParaC) throw new Error("7) El informe debería mostrar 'Sin foto' para la observación sin fotos");

  console.log("Errores de página:", JSON.stringify(errs));
  if (errs.length) throw new Error("Hubo errores de página durante las pruebas");

  console.log("TODOS LOS CHEQUEOS DEL TRACKER ACCESIBLE + FOTO DESPUÉS + INFORME FOTOGRÁFICO OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
