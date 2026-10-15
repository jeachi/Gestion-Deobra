// Bug reportado por el usuario: "me dijiste que si mantengo pulsado se ve el chip de que hace y
// no funciona". La función SÍ mostraba el aviso (ver activarTooltipRiel / el listener delegado de
// .tool-card), pero al soltar el dedo el "click" normal del navegador seguía corriendo el onclick
// del botón -- "mantener pulsado para espiar" terminaba tocando el botón de verdad (entrando a un
// modo de dibujo, moviendo el zoom, etc), que es justo lo que se quería evitar. Un toque CORTO
// tiene que seguir funcionando exactamente igual que siempre.
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
    function imgFalsa(){ const c=document.createElement("canvas"); c.width=800;c.height=600; const cx=c.getContext("2d"); cx.fillStyle="#eee"; cx.fillRect(0,0,800,600); return c.toDataURL("image/png"); }
    const plano = { id:"pl1", nombre:"Plano 1", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([plano]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${plano.id}`, imgFalsa(), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1", true);
    await new Promise(r=>setTimeout(r, 300));
    entrarAEditarPlano();
    await new Promise(r=>setTimeout(r, 200));
    toggleDrawerHerramientas("vista");
  });

  const client = await page.context().newCDPSession(page);
  const btn = await page.$('[onclick="zoomOut()"]');
  const box = await btn.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // ---- 1) Mantener pulsado (>450ms) muestra el aviso pero NO ejecuta la acción al soltar ----
  await page.evaluate(() => { window.__zoomAntesHold = zoomActual; });
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
  await page.waitForTimeout(600);
  const duranteHold = await page.evaluate(() => ({ toastTexto: document.getElementById("toast").textContent }));
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(100);
  const trasHold = await page.evaluate(() => ({ zoomDespues: zoomActual, zoomAntes: window.__zoomAntesHold }));

  if (!duranteHold.toastTexto.includes("Aleja la vista")) throw new Error("BUG: mantener pulsado no mostró el aviso del botón -- texto: " + duranteHold.toastTexto);
  if (trasHold.zoomDespues !== trasHold.zoomAntes) throw new Error("BUG: mantener pulsado para ver el aviso también ejecutó la acción del botón (zoom cambió de " + trasHold.zoomAntes + " a " + trasHold.zoomDespues + ")");

  // ---- 2) Un toque CORTO (sin esperar los 450ms) sigue ejecutando la acción, normal ----
  // Se espera a que termine de ocultarse el aviso del paso 1 (dura 2800ms) para no confundir su
  // texto, todavía presente en el DOM aunque ya oculto, con uno nuevo de este paso.
  await page.waitForTimeout(2800);
  await page.evaluate(() => { window.__zoomAntesCorto = zoomActual; });
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
  await page.waitForTimeout(100);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(100);
  const trasCorto = await page.evaluate(() => ({ zoomDespues: zoomActual, zoomAntes: window.__zoomAntesCorto, toastVisible: document.getElementById("toast").classList.contains("show") }));

  if (trasCorto.zoomDespues === trasCorto.zoomAntes) throw new Error("BUG: el toque corto dejó de ejecutar la acción del botón -- se rompió el uso normal.");
  if (trasCorto.toastVisible) throw new Error("BUG: un toque corto mostró un aviso -- debería hacer falta mantener pulsado.");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-ayuda-mantener-pulsado-no-ejecuta");
})().catch((e) => { console.error(e); process.exit(1); });
