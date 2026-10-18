// Bug reportado por el usuario: "esto se dañó... dejó de funcionar bien el zoom" -- después del
// arreglo de rendimiento del pellizco (moverPinch optimizado con requestAnimationFrame), el zoom
// pellizcado quedaba en NaN de verdad en un dispositivo real. Causa: moverPinch() guardaba la
// posición de cada dedo como {x, y}, pero distanciaEntreToques()/puntoMedioToques() leen
// .clientX/.clientY -- con los nombres equivocados, la distancia entre dedos daba NaN
// (undefined - undefined), y de ahí todo el cálculo de zoom quedaba en NaN. El test anterior
// (test-plano-pinch-zoom-performance.js) no lo agarró porque comparaba "Math.abs(NaN-1) < 0.05",
// que da `false` -- cualquier comparación con NaN da false, así que un NaN "pasaba" como si el
// zoom hubiera cambiado lo suficiente. Acá se usan eventos táctiles REALES (CDP), como en un
// celular de verdad, en vez de Event() armados a mano -- para que esta clase de bug (que depende
// de qué formas exactas tienen los objetos touch que entrega el navegador) no se vuelva a colar.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
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
    function imgFalsa(){ const c=document.createElement("canvas"); c.width=2000;c.height=1500; const cx=c.getContext("2d"); cx.fillStyle="#eee"; cx.fillRect(0,0,2000,1500); return c.toDataURL("image/png"); }
    const plano = { id:"pl1", nombre:"Plano 1", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([plano]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${plano.id}`, imgFalsa(), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1", true);
    await new Promise(r=>setTimeout(r, 300));
    entrarAEditarPlano();
    await new Promise(r=>setTimeout(r, 200));
  });

  const client = await page.context().newCDPSession(page);
  const canvas = await page.$("#canvas-plano");
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const zoomAntes = await page.evaluate(() => zoomActual);

  // ---- 1) Pellizco real (dos dedos separándose) hecho con eventos táctiles de verdad (CDP) ----
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: cx - 20, y: cy, id: 0 },
    { x: cx + 20, y: cy, id: 1 },
  ]});
  await page.waitForTimeout(16);
  for (let i = 1; i <= 10; i++) {
    const spread = 20 + i * 8;
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
      { x: cx - spread, y: cy, id: 0 },
      { x: cx + spread, y: cy, id: 1 },
    ]});
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(100);

  const zoomTrasAgrandar = await page.evaluate(() => zoomActual);
  if (!Number.isFinite(zoomTrasAgrandar)) throw new Error("BUG: el zoom quedó en un valor inválido (NaN/Infinity) después de un pellizco para agrandar: " + zoomTrasAgrandar);
  if (zoomTrasAgrandar <= zoomAntes) throw new Error("El pellizco para agrandar (separar los dedos) debería haber aumentado el zoom: antes=" + zoomAntes + " después=" + zoomTrasAgrandar);

  // ---- 2) Pellizco real para achicar (dedos juntándose) -- confirma que no quedó "pegado" en NaN ----
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: cx - 60, y: cy, id: 0 },
    { x: cx + 60, y: cy, id: 1 },
  ]});
  await page.waitForTimeout(16);
  for (let i = 1; i <= 10; i++) {
    const spread = 60 - i * 5;
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
      { x: cx - spread, y: cy, id: 0 },
      { x: cx + spread, y: cy, id: 1 },
    ]});
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(100);

  const zoomTrasachicar = await page.evaluate(() => zoomActual);
  if (!Number.isFinite(zoomTrasachicar)) throw new Error("BUG: el zoom quedó en un valor inválido (NaN/Infinity) después de un pellizco para achicar: " + zoomTrasachicar);
  if (zoomTrasachicar >= zoomTrasAgrandar) throw new Error("El pellizco para achicar (juntar los dedos) debería haber bajado el zoom: antes=" + zoomTrasAgrandar + " después=" + zoomTrasachicar);

  // ---- 3) El <canvas> en pantalla tiene un tamaño válido (no "NaNpx") ----
  const estiloCanvas = await page.evaluate(() => {
    const c = document.getElementById("canvas-plano");
    return { width: c.style.width, height: c.style.height };
  });
  if (estiloCanvas.width.includes("NaN") || estiloCanvas.height.includes("NaN")) {
    throw new Error("BUG: el <canvas> quedó con un tamaño inválido tras el pellizco: " + JSON.stringify(estiloCanvas));
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-pinch-zoom-valores-correctos");
})().catch((e) => { console.error(e); process.exit(1); });
