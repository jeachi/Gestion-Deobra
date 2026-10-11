// Ronda 7 de auditoría -- módulo Remitos. Varios bugs reales encontrados:
//
// 1) guardarRemito() nunca detectaba un guardado que solo quedó en la cola offline (window.storage.
//    set NUNCA rechaza, encola y devuelve {pendiente:true}) -- mostraba "Remito guardado ✓" igual,
//    generaba el PDF y agregaba las herramientas al inventario, aunque el comprobante (un documento
//    legal de entrega) solo estuviera guardado en este celular.
// 2) guardarRemitosIndex() no devolvía el resultado de guardarClave() -- guardarRemito() no tenía
//    forma de enterarse si el ÍNDICE se guardó bien o quedó pendiente, a diferencia de su par de
//    Minutas (guardarMinutasIndex, que sí lo hace).
// 3) El formulario no se limpiaba después de guardar -- tocar "Guardar remito" dos veces sin querer
//    duplicaba la entrega con un número correlativo distinto.
// 4) agregarHerramientasDesdeRemito(): una cantidad "0" o negativa no se validaba.
// 5) eliminarRemito() dejaba huérfanas (sin vínculo ni aviso) las herramientas que el remito había
//    agregado solo al inventario.
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
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obras = ["VARELA"];
    obrasFinalizadas = [];
    obraPredeterminada = "VARELA";
    remitosIndex = [];
    herramientas = [];
    correlativoRemitoSiguiente = 50;
    window.confirm = () => true;
    window.alert = () => {};
    // guardarRemito() ahora vuelve a pedir el correlativo al servidor antes de asignarlo -- sin
    // esto en el servidor de prueba todavía, "Clave no encontrada" lo resetearía solo a 1.
    await window.storage.set("correlativo_remito", "50", true);

    function cargarFormularioBasico(detalle, cant, esHerramienta){
      prepararVistaRemitos();
      document.getElementById("rem-obra").value = "VARELA";
      document.getElementById("rem-fecha").value = "2026-10-01";
      remItems = [{cant: cant!==undefined?cant:"2", detalle: detalle||"Cemento", esHerramienta: !!esHerramienta}];
    }

    // ---- 1) guardado que queda "pendiente" (sin señal) -- NO debería avisar éxito ni avanzar ----
    cargarFormularioBasico();
    let modalPdfLlamado = false;
    const origMostrarModalPDF = window.mostrarModalPDF;
    window.mostrarModalPDF = () => { modalPdfLlamado = true; };
    const setReal = window.storage.set;
    window.storage.set = async (k,v) => ({key:k, value:v, pendiente:true}); // simula sin señal
    const remitosIndexAntes = remitosIndex.length;
    const correlativoAntes = correlativoRemitoSiguiente;
    await guardarRemito();
    const r1_noAgregoAlIndiceSiQuedoPendiente = remitosIndex.length === remitosIndexAntes;
    const r1_noAvanzoCorrelativoSiQuedoPendiente = correlativoRemitoSiguiente === correlativoAntes;
    const r1_noAbrioElPdfSiQuedoPendiente = !modalPdfLlamado;
    window.storage.set = setReal;
    window.mostrarModalPDF = origMostrarModalPDF;

    // ---- 2) guardado real (con señal) -- SÍ debería funcionar normalmente, y el formulario debería
    // quedar limpio para el próximo remito ----
    cargarFormularioBasico("Cemento", "2");
    document.getElementById("rem-destinatario").value = "Otra empresa";
    modalPdfLlamado = false;
    window.mostrarModalPDF = () => { modalPdfLlamado = true; };
    await guardarRemito();
    const r2_agregoAlIndice = remitosIndex.length === 1 && remitosIndex[0].numero === 50;
    const r2_avanzoCorrelativo = correlativoRemitoSiguiente === 51;
    const r2_abrioElPdf = modalPdfLlamado;
    const r2_formularioQuedoLimpio = remItems.length === 2 && remItems.every(it=>!it.detalle)
      && document.getElementById("rem-destinatario").value === "CYLP SA";
    window.mostrarModalPDF = origMostrarModalPDF;

    // ---- 3) correlativo se refresca desde el servidor antes de asignar (mitiga la carrera entre
    // pestañas) -- si OTRA pestaña ya guardó el 51 en el servidor pero esta todavía tiene 51 "viejo"
    // en memoria, debería usar el valor fresco del servidor, no el de memoria ----
    await window.storage.set("correlativo_remito", "80", true); // "otra pestaña" ya avanzó el real
    cargarFormularioBasico("Arena", "5");
    modalPdfLlamado = false;
    window.mostrarModalPDF = () => { modalPdfLlamado = true; };
    await guardarRemito();
    const r3_usoCorrelativoFrescoDelServidor = remitosIndex[0].numero === 80;
    window.mostrarModalPDF = origMostrarModalPDF;

    // ---- 4) cantidad de herramienta: "0", negativa y vacía caen todas a 1 (nunca negativa) ----
    cargarFormularioBasico("Taladro", "-3", true);
    modalPdfLlamado = true; window.mostrarModalPDF = () => {}; // no nos importa el PDF acá
    await guardarRemito();
    const taladro = herramientas.find(h=>h.nombre==="Taladro");
    const r4_cantidadNegativaCaeA1 = !!taladro && taladro.cantidad === 1;
    const r4_quedoVinculadaAlRemito = !!taladro && !!taladro.origenRemitoId;
    window.mostrarModalPDF = origMostrarModalPDF;

    // ---- 5) eliminarRemito() saca del inventario la herramienta sin usar que ese remito generó ----
    const remitoIdDelTaladro = remitosIndex[0].id; // el remito recién guardado (Taladro)
    const cantidadHerramientasAntes = herramientas.length;
    await eliminarRemito(remitoIdDelTaladro);
    const r5_saloLaHerramientaSinUsar = !herramientas.some(h=>h.id===taladro.id) && herramientas.length === cantidadHerramientasAntes-1;

    // ---- 6) PERO si esa herramienta ya tiene historial (se usó/reparó/prestó), eliminar el remito
    // NO debería borrarla -- solo avisar ----
    cargarFormularioBasico("Amoladora", "1", true);
    modalPdfLlamado = true; window.mostrarModalPDF = () => {};
    await guardarRemito();
    const amoladora = herramientas.find(h=>h.nombre==="Amoladora");
    amoladora.historialDanios = [{fecha:"2026-10-02", motivo:"se rompió el disco", usuario:"admin"}]; // ya tiene historial real
    const remitoIdAmoladora = remitosIndex[0].id;
    await eliminarRemito(remitoIdAmoladora);
    const r6_noBorroHerramientaConHistorial = herramientas.some(h=>h.id===amoladora.id);
    window.mostrarModalPDF = origMostrarModalPDF;

    return {
      r1_noAgregoAlIndiceSiQuedoPendiente, r1_noAvanzoCorrelativoSiQuedoPendiente, r1_noAbrioElPdfSiQuedoPendiente,
      r2_agregoAlIndice, r2_avanzoCorrelativo, r2_abrioElPdf, r2_formularioQuedoLimpio,
      r3_usoCorrelativoFrescoDelServidor,
      r4_cantidadNegativaCaeA1, r4_quedoVinculadaAlRemito,
      r5_saloLaHerramientaSinUsar,
      r6_noBorroHerramientaConHistorial,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_noAgregoAlIndiceSiQuedoPendiente) fallas.push("BUG REPRODUCIDO: se agregó al índice de remitos aunque el guardado real quedó pendiente");
  if (!resultado.r1_noAvanzoCorrelativoSiQuedoPendiente) fallas.push("BUG REPRODUCIDO: se avanzó el correlativo aunque el guardado real quedó pendiente");
  if (!resultado.r1_noAbrioElPdfSiQuedoPendiente) fallas.push("BUG REPRODUCIDO: se abrió el PDF (avisando éxito) aunque el guardado quedó pendiente sin conexión");
  if (!resultado.r2_agregoAlIndice) fallas.push("Un guardado real (con señal) debería agregarse al índice con el número correcto");
  if (!resultado.r2_avanzoCorrelativo) fallas.push("Un guardado real debería avanzar el correlativo");
  if (!resultado.r2_abrioElPdf) fallas.push("Un guardado real debería abrir el PDF");
  if (!resultado.r2_formularioQuedoLimpio) fallas.push("BUG REPRODUCIDO: el formulario no quedó limpio después de guardar (riesgo de duplicar con un segundo click)");
  if (!resultado.r3_usoCorrelativoFrescoDelServidor) fallas.push("BUG REPRODUCIDO: no se refrescó el correlativo desde el servidor antes de asignar el número");
  if (!resultado.r4_cantidadNegativaCaeA1) fallas.push("BUG REPRODUCIDO: una cantidad negativa de herramienta no se corrigió a un valor válido");
  if (!resultado.r4_quedoVinculadaAlRemito) fallas.push("La herramienta creada desde un remito debería quedar vinculada a su origenRemitoId");
  if (!resultado.r5_saloLaHerramientaSinUsar) fallas.push("BUG REPRODUCIDO: borrar el remito no sacó la herramienta sin usar que había generado");
  if (!resultado.r6_noBorroHerramientaConHistorial) fallas.push("Borrar el remito NO debería borrar una herramienta vinculada que ya tiene historial real");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE REMITOS (RONDA 7) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
