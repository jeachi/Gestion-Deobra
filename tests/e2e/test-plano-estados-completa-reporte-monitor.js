// Cobertura de la tanda de pedidos sobre Plano de avance / Plano Maestro:
// 1) El selector rápido de estado (doble toque sobre una etiqueta) ya NO aplica el cambio al
//    tocar un estado -- hace falta confirmar aparte, para que un toque de más no cambie nada
//    por accidente.
// 2) "Configurar estados" tiene una estrella para marcar cuál estado completa la actividad --
//    el reporte y el Monitor calculan el % contra ESE estado, no contra el último de la lista.
// 3) El reporte PDF del plano de avance ahora tiene una tabla de etiquetas por código/medida con
//    estado, agrupada por categoría con subtotal, y una tabla de pines del Maestro vinculados a
//    este plano, agrupados por tipo de ambiente.
// 4) "Monitor de avance" (pantalla nueva) resume el % por categoría de etiqueta y por tipo de
//    ambiente de pines, de TODA la obra.
// 5) Al crear una etiqueta nueva cerca de un pin de un Maestro con la MISMA imagen, se sugiere
//    la ubicación de ese pin solo (editable, no se fuerza).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => d.accept());

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

  await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });

    function imgFalsa(){ const c=document.createElement("canvas"); c.width=800;c.height=600; const cx=c.getContext("2d"); cx.fillStyle="#eee"; cx.fillRect(0,0,800,600); return c.toDataURL("image/png"); }
    const planoMaestro = { id:"maes1", nombre:"Maestro Colegio", tipo:"maestro", fecha:hoyISO(), miniatura:"compartida" };
    const planoAvance = { id:"pl1", nombre:"Avance Aulas", fecha:hoyISO(), miniatura:"compartida" };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([planoMaestro, planoAvance]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoMaestro.id}`, imgFalsa(), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoAvance.id}`, imgFalsa(), true);
    // Pin "Aula 3" cerca de (120,120) -- se usa tanto para el vínculo al reporte como para la
    // sugerencia automática de ubicación de una etiqueta nueva cerca de ahí.
    await window.storage.set(`plano_maestro_pines_VARELA_${planoMaestro.id}`, JSON.stringify([
      { id:"pinAula3", x:120, y:120, nombre:"Aula 3", tipoAmbiente:"Aula", checklist:[{texto:"Pintura", hecho:true}], capasVinculadas:[{tipo:"anotacion", planoId:"pl1", categoria:"Ventana"}] },
    ]), true);
    await window.storage.set(`plano_avance_textos_VARELA_${planoAvance.id}`, JSON.stringify([
      { x: 100, y: 100, tipo: "numero", valor: "2x2", unidad: "m", cantidad: 1, categoria: "Ventana", codigo: "V1", estado: "pendiente" },
      { x: 200, y: 200, tipo: "numero", valor: "1x1", unidad: "m", cantidad: 1, categoria: "Ventana", codigo: "V2", estado: "instalado" },
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1", true);
    await new Promise(r=>setTimeout(r, 300));
  });

  // ---- 1) Doble toque -> tocar un estado NO aplica el cambio solo -- hace falta "Confirmar" ----
  const antesDeConfirmar = await page.evaluate(() => {
    abrirSelectorEstadoRapido(0); // etiqueta V1, estado actual "pendiente"
    marcarEstadoRapidoPendiente(0, "instalado"); // se toca "Instalado" en la lista
    return { estadoReal: anotacionesTexto[0].estado, pendiente: estadoRapidoPendiente };
  });
  if (antesDeConfirmar.estadoReal !== "pendiente") throw new Error("BUG: tocar un estado en la lista lo aplicó solo, sin confirmar: " + JSON.stringify(antesDeConfirmar));
  if (antesDeConfirmar.pendiente !== "instalado") throw new Error("El estado tocado no quedó marcado como pendiente de confirmar: " + JSON.stringify(antesDeConfirmar));
  const trasConfirmar = await page.evaluate(async () => {
    await confirmarEstadoRapido(0);
    return anotacionesTexto[0].estado;
  });
  if (trasConfirmar !== "instalado") throw new Error("BUG: 'Confirmar estado' no aplicó el cambio: " + trasConfirmar);

  // ---- 2) Configurar estados: la estrella marca cuál completa la actividad ----
  const config = await page.evaluate(async () => {
    abrirConfigEstados();
    const sinMarcar = estadoMetaActual().id; // ninguno tiene "completa" todavía -- cae al último de la lista
    await marcarEstadoCompleta(1); // "marco" (índice 1 de ESTADOS_POR_DEFECTO)
    const marcado = estadoMetaActual();
    return { sinMarcar, marcadoId: marcado.id, marcadoCompleta: marcado.completa, otrosSinCompleta: estadosPersonalizados.filter((e,i)=>i!==1).every(e=>!e.completa) };
  });
  if (config.sinMarcar !== "instalado") throw new Error("Sin marcar ninguno, no cayó al último de la lista: " + config.sinMarcar);
  if (config.marcadoId !== "marco" || !config.marcadoCompleta) throw new Error("marcarEstadoCompleta no marcó el estado elegido: " + JSON.stringify(config));
  if (!config.otrosSinCompleta) throw new Error("marcarEstadoCompleta dejó más de un estado marcado a la vez: " + JSON.stringify(config));
  // Se vuelve a dejar en "instalado" (el real pedido del usuario era ESE) para el resto del test.
  await page.evaluate(async () => { await marcarEstadoCompleta(2); });

  // ---- 3) Reporte PDF: tabla de etiquetas por categoría/código + tabla de pines vinculados ----
  await page.evaluate(() => cerrarFotoAvanceOverlay());
  await page.evaluate(() => new Promise(r=>setTimeout(r, 400)));
  const reporte = await page.evaluate(async () => {
    await generarReportePlanoAvancePDF("portrait");
    return document.getElementById("pdf-preview-content").innerHTML;
  });
  if (!reporte.includes("CUADRO DE MEDIDAS")) throw new Error("El reporte no tiene la sección de cuadro de medidas.");
  if (!reporte.includes("V1") || !reporte.includes("V2")) throw new Error("El reporte no lista las etiquetas por código: " + reporte.slice(0,200));
  if (!reporte.includes("Subtotal Ventana")) throw new Error("El reporte no agrupa por categoría con subtotal.");
  if (!reporte.includes("★")) throw new Error("El reporte no marca el estado configurado como meta (★).");
  if (!reporte.includes("PINES DEL PLANO MAESTRO")) throw new Error("El reporte no incluye la página de pines vinculados.");
  if (!reporte.includes("Pines vinculados a este plano, por tipo de ambiente")) throw new Error("El reporte no incluye la tabla de pines vinculados.");
  if (!reporte.includes("Aula")) throw new Error("La tabla de pines no muestra el tipo de ambiente 'Aula': " + reporte.slice(0,200));

  // ---- 4) Monitor de avance: % por categoría de etiqueta y por tipo de ambiente de pines ----
  const monitor = await page.evaluate(async () => {
    await abrirMonitorAvance();
    return document.getElementById("monitor-avance-body").innerHTML;
  });
  if (!monitor.includes("Ventana")) throw new Error("El Monitor no muestra la categoría 'Ventana': " + monitor.slice(0,300));
  if (!monitor.includes("Aula")) throw new Error("El Monitor no muestra el tipo de ambiente 'Aula': " + monitor.slice(0,300));
  await page.evaluate(() => cerrarMonitorAvance());

  // ---- 5) Sugerencia automática de ubicación por el pin más cercano (misma imagen) ----
  const sugerida = await page.evaluate(async () => {
    abrirPromptTextoPlano({ x: 125, y: 125 }); // cerca del pin "Aula 3" en (120,120)
    await new Promise(r => setTimeout(r, 400)); // la búsqueda del pin es async (fire-and-forget)
    return document.getElementById("prompt-texto-plano-ubicacion").value;
  });
  if (sugerida !== "Aula 3") throw new Error("BUG: no se sugirió la ubicación del pin más cercano: '" + sugerida + "'");
  // Sigue siendo editable -- no se fuerza ni se bloquea el campo.
  const editable = await page.evaluate(() => {
    const input = document.getElementById("prompt-texto-plano-ubicacion");
    input.value = "Otra cosa a mano";
    return input.value;
  });
  if (editable !== "Otra cosa a mano") throw new Error("El campo de ubicación sugerido no se puede editar.");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-estados-completa-reporte-monitor");
})().catch((e) => { console.error(e); process.exit(1); });
