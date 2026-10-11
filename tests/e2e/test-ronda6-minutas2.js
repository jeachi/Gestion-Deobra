// Ronda 6 de auditoría (relanzada) -- Minutas, arreglos restantes:
// 1) guardarClave() (usado por guardarMinutasIndex y muchas otras) nunca chequeaba {pendiente:true}
//    que devuelve window.storage.set -- siempre devolvía true salvo una excepción real, dejando
//    ciegos a generarMinutaPDF/eliminarMinuta/guardarNumeroMinutaCorregido ante un guardado que en
//    realidad quedó en cola local.
// 2) eliminarMinuta() mentía éxito si el borrado remoto fallaba (window.storage.delete NO tiene
//    cola offline) y reciclaba el N° del correlativo igual, aunque el documento siguiera huérfano
//    en Firestore.
// 3) generarMinutaPDF()/guardarNumeroMinutaCorregido() no chequeaban si guardarMinutasIndex()
//    (el guardado del ÍNDICE, lo que hace visible la minuta en la lista) había quedado pendiente.
// 4) El PDF de la minuta nunca mostraba su propio N°.
// 5) Editar una minuta borraba la autoría y fecha de creación original.
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
    minutasIndex = [];
    correlativoMinutaSiguiente = 1;
    irA("minutas");
    window.jspdf = { jsPDF: function () { this.addImage = () => {}; this.save = () => {}; this.internal = { getNumberOfPages: () => 1 }; this.output = () => new Blob(); } };
    let ultimoHtmlPDF = "";
    window.mostrarModalPDF = (html) => { ultimoHtmlPDF = html; };

    // ---- Creo una minuta normal, de verdad (sin fallas), para usar en los casos siguientes ----
    document.getElementById("min-obra").value = "ObraA";
    document.getElementById("min-fecha").value = "2026-03-01";
    document.getElementById("min-contenido").value = "Contenido original.";
    const card1 = document.getElementById("lista-firmas-minuta").firstElementChild;
    card1.querySelector(".firma-aclaracion-input").value = "Juan Pérez";
    await generarMinutaPDF();
    const idCreada = minutasIndex[0].id;

    // ---- 4) El PDF muestra su propio N° ----
    const r4_pdfMuestraNumero = ultimoHtmlPDF.includes(`MINUTA N° ${minutasIndex[0].numero}`);

    // ---- 1 y 3) generarMinutaPDF detecta si el guardado del ÍNDICE quedó pendiente ----
    const setOriginal = window.storage.set;
    let vecesLlamado = 0;
    window.storage.set = async (k, v, s) => {
      vecesLlamado++;
      // Dejamos pasar el guardado del DETALLE (minuta_<id>, el primero) pero el del ÍNDICE
      // (minutas_index, el segundo) queda pendiente -- simula una conexión que se corta a mitad de camino.
      if (k === "minutas_index") return { key: k, value: v, shared: s, pendiente: true };
      return setOriginal(k, v, s);
    };
    document.getElementById("min-obra").value = "ObraA";
    document.getElementById("min-fecha").value = "2026-03-05";
    document.getElementById("min-contenido").value = "Minuta que no debería quedar en la lista.";
    await generarMinutaPDF();
    window.storage.set = setOriginal;
    const r1_noQuedaEnIndiceSiIndicePendiente = minutasIndex.length === 1; // sigue habiendo solo la primera
    const r1_noAvanzaCorrelativoSiIndicePendiente = correlativoMinutaSiguiente === 2; // no se consumió un 2do número

    // ---- 2) eliminarMinuta no recicla el N° si el borrado remoto falla ----
    // Creo una SEGUNDA minuta de verdad para borrarla.
    document.getElementById("min-contenido").value = "Segunda minuta, para borrar.";
    document.getElementById("min-fecha").value = "2026-03-06";
    await generarMinutaPDF();
    const idSegunda = minutasIndex[0].id; // quedó primera por el unshift
    const numeroSegunda = minutasIndex[0].numero;
    const deleteOriginal = window.storage.delete;
    window.storage.delete = async () => { throw new Error("sin conexión"); };
    const toasts = [];
    const showToastOriginal = window.showToast;
    window.showToast = (m) => toasts.push(m);
    await eliminarMinuta(idSegunda);
    window.storage.delete = deleteOriginal;
    window.showToast = showToastOriginal;
    const r2_seQuitaDeLaListaIgual = !minutasIndex.some(m => m.id === idSegunda); // el índice sí se pudo actualizar
    const r2_noReciclaCorrelativoSiFallaBorrado = correlativoMinutaSiguiente === 3; // NO vuelve a numeroSegunda
    const r2_avisaFalloDeBorrado = toasts.some(t => t.includes("no se pudo borrar"));

    // ---- 5) Editar una minuta conserva autoría/fecha de creación original ----
    const detalleOriginalRaw = await window.storage.get("minuta_" + idCreada, true);
    const detalleOriginal = JSON.parse(detalleOriginalRaw.value);
    sesionActual = { username: "otroUsuario", role: "admin", permisos: {} }; // otra persona edita después
    await editarMinuta(idCreada);
    document.getElementById("min-contenido").value = "Contenido corregido por otra persona.";
    await generarMinutaPDF();
    const detalleTrasEditarRaw = await window.storage.get("minuta_" + idCreada, true);
    const detalleTrasEditar = JSON.parse(detalleTrasEditarRaw.value);
    const r5_conservaCreadoPorOriginal = detalleTrasEditar.creadoPor === detalleOriginal.creadoPor;
    const r5_conservaTimestampOriginal = detalleTrasEditar.timestamp === detalleOriginal.timestamp;
    const r5_registraQuienEdito = detalleTrasEditar.editadoPor === "otroUsuario";

    return {
      r4_pdfMuestraNumero,
      r1_noQuedaEnIndiceSiIndicePendiente, r1_noAvanzaCorrelativoSiIndicePendiente,
      r2_seQuitaDeLaListaIgual, r2_noReciclaCorrelativoSiFallaBorrado, r2_avisaFalloDeBorrado,
      r5_conservaCreadoPorOriginal, r5_conservaTimestampOriginal, r5_registraQuienEdito,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r4_pdfMuestraNumero) fallas.push("BUG REPRODUCIDO: el PDF de la minuta debería mostrar su propio N°");
  if (!resultado.r1_noQuedaEnIndiceSiIndicePendiente) fallas.push("BUG REPRODUCIDO: si el guardado del índice queda pendiente, la minuta no debería aparecer igual en la lista en memoria");
  if (!resultado.r1_noAvanzaCorrelativoSiIndicePendiente) fallas.push("BUG REPRODUCIDO: si el guardado del índice queda pendiente, no debería consumirse un número del correlativo");
  if (!resultado.r2_seQuitaDeLaListaIgual) fallas.push("Si el índice sí se pudo guardar, la minuta debería desaparecer de la lista aunque el borrado remoto falle");
  if (!resultado.r2_noReciclaCorrelativoSiFallaBorrado) fallas.push("BUG REPRODUCIDO: si el borrado remoto falla, no debería reciclarse su N° de correlativo (el documento queda huérfano con ese mismo N°)");
  if (!resultado.r2_avisaFalloDeBorrado) fallas.push("BUG REPRODUCIDO: si el borrado remoto falla, debería avisarse en vez de decir 'Minuta eliminada' sin más");
  if (!resultado.r5_conservaCreadoPorOriginal) fallas.push("BUG REPRODUCIDO: editar una minuta no debería cambiar quién la creó originalmente");
  if (!resultado.r5_conservaTimestampOriginal) fallas.push("BUG REPRODUCIDO: editar una minuta no debería cambiar la fecha/hora de creación original");
  if (!resultado.r5_registraQuienEdito) fallas.push("Debería quedar registrado quién hizo la última edición");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE MINUTAS -- PENDIENTE/BORRADO/AUTORÍA/N° EN PDF (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
