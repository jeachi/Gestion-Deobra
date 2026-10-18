// Mejoras de UX ya propuestas en el mockup anterior, implementadas ahora: (1) el diálogo de
// distancia muestra cuántas columnas/filas ya se pusieron y una vista previa en vivo de a
// cuántos px equivale lo tipeado; (2) el cartel flotante de "tocá un punto" también suma ese
// resumen, para no tener que mirar el plano para saber en qué pinta de la rejilla se está.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
    metrosPorPixelPlano = 0.01; // 100px = 1m
    await guardarCalibracionPlano();
    iniciarRejilla();
    manejarTapRejillaColumna(100, 50);
  });

  // ---- 1) El diálogo de distancia muestra el resumen de columnas/filas puestas ----
  const resumen = await page.evaluate(() => document.getElementById("prompt-generico-cuerpo").textContent);
  if (!resumen.includes("1 columna") || !resumen.includes("0 filas")) {
    throw new Error("BUG: el diálogo debería mostrar '1 columna · 0 filas puestas hasta ahora': " + resumen);
  }

  // ---- 2) Tipear una distancia muestra la vista previa en px, en vivo ----
  const previewAntes = await page.evaluate(() => document.getElementById("rejilla-distancia-preview").textContent);
  if (previewAntes !== "") throw new Error("La vista previa no debería mostrar nada sin haber tipeado todavía: " + previewAntes);
  const previewDespues = await page.evaluate(() => {
    const input = document.getElementById("rejilla-distancia");
    input.value = "3";
    actualizarPreviewDistanciaRejilla();
    return document.getElementById("rejilla-distancia-preview").textContent;
  });
  if (previewDespues !== "≈ 300px en el plano") throw new Error("BUG: la vista previa en px no calculó bien (3m a 0.01 m/px = 300px): " + previewDespues);

  // ---- 3) El cartel flotante también suma el resumen al pasar a filas ----
  await page.evaluate(() => {
    document.getElementById("rejilla-distancia").value = "2";
    confirmarSiguienteLineaRejilla("v"); // columna 2
    _rejillaCierreControlado = true; cerrarPromptGenerico(); iniciarRejillaFilas();
  });
  const textoCartel = await page.evaluate(() => document.getElementById("cad-modo-flotante-txt").textContent);
  if (!textoCartel.includes("2 columnas ya puestas")) {
    throw new Error("BUG: el cartel flotante debería avisar cuántas columnas ya hay al pasar a filas: " + textoCartel);
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-rejilla-mejoras-guiado");
})().catch((e) => { console.error(e); process.exit(1); });
