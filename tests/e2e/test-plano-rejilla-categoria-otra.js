// Mejora: el formulario manual de etiquetas tiene "Ventana/Puerta/Portón/Reja + Otra" (categoría
// libre), pero "Colocar en cada cruce" de la Rejilla solo ofrecía esas 4 -- un plano con otras
// categorías (ej: "Columna") no podía usar el llenado en lote para su categoría real. Se agrega
// la misma opción "+ Otra" al selector de la Rejilla.
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
    const plano = { id:"pl1", nombre:"Plano 1", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([plano]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${plano.id}`, imgFalsa(), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1", true);
    await new Promise(r=>setTimeout(r, 300));
    metrosPorPixelPlano = 0.01;
    await guardarCalibracionPlano();
    iniciarRejilla();
    manejarTapRejillaColumna(100, 50);
    document.getElementById("rejilla-distancia").value = "2";
    confirmarSiguienteLineaRejilla("v");
    _rejillaCierreControlado = true; cerrarPromptGenerico(); iniciarRejillaFilas();
    manejarTapRejillaFila(0, 80);
    document.getElementById("rejilla-distancia").value = "2";
    confirmarSiguienteLineaRejilla("h");
    _rejillaCierreControlado = true; cerrarPromptGenerico(); terminarRejilla();
  });

  const grupoId = await page.evaluate(() => lineasReferencia[0].grupoId);
  const resultado = await page.evaluate((grupoId) => {
    abrirColocarEnRejilla(grupoId);
    const tieneBotonOtra = !!document.querySelector('[onclick="mostrarCategoriaOtraRejilla()"]');
    mostrarCategoriaOtraRejilla();
    const inputVisible = document.getElementById("rejilla-categoria-otra-wrap").style.display;
    document.getElementById("rejilla-categoria-otra").value = "Columna";
    confirmarCategoriaOtraRejilla();
    return {
      tieneBotonOtra,
      inputVisible,
      etiquetas: anotacionesTexto.map(a => ({ categoria: a.categoria, codigo: a.codigo })),
    };
  }, grupoId);

  if (!resultado.tieneBotonOtra) throw new Error("BUG: el selector de categoría de la Rejilla no ofrece '+ Otra categoría'.");
  if (resultado.inputVisible !== "block") throw new Error("BUG: tocar '+ Otra categoría' no mostró el campo de texto.");
  if (resultado.etiquetas.length !== 4) throw new Error("Deberían crearse 4 etiquetas (una por cruce): " + JSON.stringify(resultado.etiquetas));
  if (!resultado.etiquetas.every(e => e.categoria === "Columna")) throw new Error("BUG: las etiquetas no quedaron con la categoría personalizada escrita: " + JSON.stringify(resultado.etiquetas));
  if (!resultado.etiquetas.every(e => /^CO\d+$/.test(e.codigo))) throw new Error("BUG: el código automático no se generó para la categoría personalizada: " + JSON.stringify(resultado.etiquetas));

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-rejilla-categoria-otra");
})().catch((e) => { console.error(e); process.exit(1); });
