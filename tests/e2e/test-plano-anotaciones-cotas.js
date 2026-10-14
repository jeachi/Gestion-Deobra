// Pedido del usuario: "las cotas esten en anotaciones que este texto etiquetas agrupalos
// estilo autocad". La Cinta métrica (ahora "Cotas") se muda del cajón "Medir y alinear" al
// cajón de Etiquetas, renombrado "Anotaciones" -- junto con Texto, Medidas y Seleccionar,
// como el panel "Annotate" de AutoCAD. "Alinear y calibrar" (antes "Medir y alinear") se queda
// solo con Ejes y Escala.
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
    await seleccionarPlano("pl1");
    await new Promise(r=>setTimeout(r, 300));
    entrarAEditarPlano();
    await new Promise(r=>setTimeout(r, 200));
  });

  // ---- Cajón "Anotaciones" (antes "Etiquetas"): Cotas, Texto, Medidas, Seleccionar ----
  await page.evaluate(() => toggleDrawerHerramientas("etiquetas"));
  const anotaciones = await page.evaluate(() => {
    const drawer = document.getElementById("drawer-etiquetas");
    const titulo = drawer.querySelector(".cad-flyout-titulo").textContent;
    const labels = [...drawer.querySelectorAll(".tool-card .lbl")].map((l) => l.textContent);
    const cotasBtn = [...drawer.querySelectorAll(".tool-card")].find((b) => b.getAttribute("onclick") === "iniciarCintaMetrica()");
    return { titulo, labels, cotasEsDestacado: cotasBtn ? cotasBtn.classList.contains("destacado") : false };
  });
  if (anotaciones.titulo !== "Anotaciones") throw new Error("El cajón de Etiquetas no se renombró a 'Anotaciones': " + anotaciones.titulo);
  if (!anotaciones.labels.includes("Cotas")) throw new Error("'Anotaciones' no incluye 'Cotas': " + JSON.stringify(anotaciones.labels));
  if (!anotaciones.labels.includes("Texto") || !anotaciones.labels.includes("Seleccionar")) {
    throw new Error("'Anotaciones' no agrupa Cotas+Texto+Seleccionar: " + JSON.stringify(anotaciones.labels));
  }
  if (!anotaciones.cotasEsDestacado) throw new Error("'Cotas' debería estar destacada en Anotaciones (es la herramienta principal del panel, como en AutoCAD)");

  // ---- Cajón "Alinear y calibrar" (antes "Medir y alinear"): ya NO tiene Cotas/Cinta métrica ----
  await page.evaluate(() => toggleDrawerHerramientas("medir"));
  const alinear = await page.evaluate(() => {
    const drawer = document.getElementById("drawer-medir");
    const titulo = drawer.querySelector(".cad-flyout-titulo").textContent;
    const labels = [...drawer.querySelectorAll(".tool-card .lbl")].map((l) => l.textContent);
    return { titulo, labels };
  });
  if (alinear.titulo !== "Alinear y calibrar") throw new Error("El cajón de Medir no se renombró a 'Alinear y calibrar': " + alinear.titulo);
  if (alinear.labels.includes("Cotas") || alinear.labels.includes("Cinta métrica")) {
    throw new Error("'Alinear y calibrar' todavía tiene la cinta métrica -- debería haberse mudado a Anotaciones: " + JSON.stringify(alinear.labels));
  }
  if (!alinear.labels.includes("Ejes") || !alinear.labels.includes("Escala")) {
    throw new Error("'Alinear y calibrar' perdió Ejes/Escala: " + JSON.stringify(alinear.labels));
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-anotaciones-cotas");
})().catch((e) => { console.error(e); process.exit(1); });
