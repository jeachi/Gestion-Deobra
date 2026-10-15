// Pedido del usuario: poder activar/desactivar qué tablas aparecen en el Reporte PDF de un plano
// de avance (ejemplo real: "no quiero que salga la tabla de pines en la de ventanas, poder
// desactivarla"). Se agrega "⚙️ Qué mostrar en el reporte" (junto a "🧾 Reporte PDF" en Vista
// rápida y en la Paleta de comandos) con un checkbox por tabla, guardado por plano.
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
    const planoAvance = { id:"pl1", nombre:"Avance Ventanas", fecha:hoyISO(), miniatura:"compartida" };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([planoMaestro, planoAvance]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoMaestro.id}`, imgFalsa(), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoAvance.id}`, imgFalsa(), true);
    await window.storage.set(`plano_maestro_pines_VARELA_${planoMaestro.id}`, JSON.stringify([
      { id:"pinAula3", x:120, y:120, nombre:"Aula 3", tipoAmbiente:"Aula", checklist:[], capasVinculadas:[{tipo:"anotacion", planoId:"pl1", categoria:"Ventana"}] },
    ]), true);
    await window.storage.set(`plano_avance_textos_VARELA_${planoAvance.id}`, JSON.stringify([
      { x: 100, y: 100, tipo: "numero", valor: "2x2", unidad: "m", cantidad: 1, categoria: "Ventana", codigo: "V1", estado: "pendiente" },
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1", true);
    await new Promise(r=>setTimeout(r, 300));
  });

  // ---- 1) Por defecto (planos de antes de esta opción) todas las tablas aparecen ----
  const reporteDefault = await page.evaluate(async () => {
    await generarReportePlanoAvancePDF("portrait");
    return document.getElementById("pdf-preview-content").innerHTML;
  });
  if (!reporteDefault.includes("CUADRO DE MEDIDAS")) throw new Error("Por defecto debería mostrar el cuadro de medidas.");
  if (!reporteDefault.includes("PINES DEL PLANO MAESTRO")) throw new Error("Por defecto debería mostrar la tabla de pines.");

  // ---- 2) El panel "⚙️ Qué mostrar en el reporte" lista las 4 opciones, todas tildadas ----
  await page.evaluate(() => new Promise(r=>setTimeout(r, 400))); // margen anti-doble-cierre del overlay
  const panel = await page.evaluate(() => {
    abrirConfigReporte();
    const checks = [...document.querySelectorAll('#lista-config-reporte input[type="checkbox"]')];
    return { cantidad: checks.length, todasTildadas: checks.every(c => c.checked) };
  });
  if (panel.cantidad !== 4) throw new Error("El panel de configuración no tiene las 4 opciones esperadas: " + panel.cantidad);
  if (!panel.todasTildadas) throw new Error("Por defecto todas las opciones deberían estar tildadas.");

  // ---- 3) Desactivar "Pines del Plano Maestro vinculados" -- el reporte deja de mostrarla, pero el cuadro de medidas queda igual ----
  await page.evaluate(async () => {
    const checks = [...document.querySelectorAll('#lista-config-reporte input[type="checkbox"]')];
    const checkPines = checks.find(c => c.getAttribute("onchange").includes("mostrarPines"));
    checkPines.checked = false;
    await cambiarVisibilidadReporte("mostrarPines", false);
  });
  const reporteSinPines = await page.evaluate(async () => {
    await generarReportePlanoAvancePDF("portrait");
    return document.getElementById("pdf-preview-content").innerHTML;
  });
  if (reporteSinPines.includes("PINES DEL PLANO MAESTRO")) throw new Error("BUG: desactivar 'mostrarPines' no sacó la tabla de pines del reporte.");
  if (!reporteSinPines.includes("CUADRO DE MEDIDAS") || !reporteSinPines.includes("V1")) throw new Error("Desactivar pines no debería afectar el cuadro de medidas: " + reporteSinPines.slice(0,200));

  // ---- 4) La elección persiste (guardada por plano) -- sale igual al volver a cargar el plano ----
  const persistido = await page.evaluate(async () => {
    await seleccionarPlano("pl1", true);
    await new Promise(r => setTimeout(r, 300));
    return reporteConfigVisibilidad.mostrarPines;
  });
  if (persistido !== false) throw new Error("La configuración de 'mostrarPines' no se guardó/recargó para este plano: " + persistido);

  // ---- 5) Desactivar también "Cuadro de medidas" -- el reporte queda sin ninguna de las dos ----
  await page.evaluate(async () => { await cambiarVisibilidadReporte("mostrarMedidas", false); });
  const reporteSinNinguna = await page.evaluate(async () => {
    await generarReportePlanoAvancePDF("portrait");
    return document.getElementById("pdf-preview-content").innerHTML;
  });
  if (reporteSinNinguna.includes("CUADRO DE MEDIDAS") || reporteSinNinguna.includes("PINES DEL PLANO MAESTRO")) {
    throw new Error("BUG: con ambas desactivadas, no debería aparecer ninguna de las dos páginas.");
  }
  if (!reporteSinNinguna.includes("PLANO DE AVANCE")) throw new Error("La página del plano (imagen) no debería desaparecer nunca.");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-reporte-config-visibilidad");
})().catch((e) => { console.error(e); process.exit(1); });
