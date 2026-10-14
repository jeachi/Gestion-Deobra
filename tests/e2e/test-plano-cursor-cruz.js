// Pedido del usuario: "también quiero un cursor estilo cruz de autocad que pueda configurar las
// líneas del cursor largo y color, eso ayuda a dibujar y colocar pin o etiqueta". Al preguntarle,
// confirmó: siempre visible en el editor (no solo al dibujar) y las líneas cruzan TODO el plano
// de punta a punta (como un eje), no un largo fijo en píxeles. Color configurable.
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
    try { localStorage.removeItem("cruz_cursor_activa"); localStorage.removeItem("cruz_cursor_color"); } catch (e) {}
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

  function moverSobreCanvas(clientX, clientY) {
    return page.evaluate(([clientX, clientY]) => {
      const canvas = document.getElementById("canvas-plano");
      canvas.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY, bubbles: true }));
    }, [clientX, clientY]);
  }

  // ---- 1) Activada por defecto: mover sobre el canvas muestra las dos líneas, cruzando TODO el plano ----
  const canvasRect = await page.evaluate(() => document.getElementById("canvas-plano").getBoundingClientRect());
  const cx = canvasRect.left + canvasRect.width / 2, cy = canvasRect.top + canvasRect.height / 2;
  await moverSobreCanvas(cx, cy);
  const r1 = await page.evaluate(() => {
    const h = document.getElementById("cruz-cursor-h"), v = document.getElementById("cruz-cursor-v");
    const rect = document.getElementById("canvas-plano").getBoundingClientRect();
    return {
      hVisible: h.style.display === "block",
      vVisible: v.style.display === "block",
      hCruzaTodoElAncho: Math.abs(parseFloat(h.style.width) - rect.width) < 1,
      vCruzaTodoElAlto: Math.abs(parseFloat(v.style.height) - rect.height) < 1,
      hTop: parseFloat(h.style.top),
      vLeft: parseFloat(v.style.left),
    };
  });
  console.log("1) Cruz activa por defecto, siguiendo el cursor:", JSON.stringify(r1));

  // ---- 2) Al salir del canvas (pointerleave), se oculta ----
  const r2 = await page.evaluate(() => {
    document.getElementById("canvas-plano").dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    const h = document.getElementById("cruz-cursor-h"), v = document.getElementById("cruz-cursor-v");
    return { hOculta: h.style.display === "none", vOculta: v.style.display === "none" };
  });
  console.log("2) Se oculta al salir del canvas:", JSON.stringify(r2));

  // ---- 3) Botón de la barra de estado la apaga/prende (toggleCruzCursor) ----
  const r3 = await page.evaluate(() => { toggleCruzCursor(); return { activaTrasApagar: cruzCursorActiva }; });
  await moverSobreCanvas(cx, cy);
  const r3b = await page.evaluate(() => ({
    hVisible: document.getElementById("cruz-cursor-h").style.display === "block",
  }));
  await page.evaluate(() => toggleCruzCursor()); // la reactiva para el resto de los chequeos

  // ---- 4) Ajustes: cambiar el color se refleja en las líneas y queda guardado ----
  const r4 = await page.evaluate(() => {
    abrirAjustesCruzCursor();
    const overlayAbierto = document.getElementById("ajustes-cruz-overlay").style.display === "flex";
    document.getElementById("input-cruz-color").value = "#FF5500";
    guardarAjustesCruzCursor();
    return { overlayAbierto, colorGuardado: localStorage.getItem("cruz_cursor_color") };
  });
  await moverSobreCanvas(cx, cy);
  const r4b = await page.evaluate(() => {
    const colorHex = (s) => s.toLowerCase().replace(/\s/g, "");
    return { colorLinea: colorHex(document.getElementById("cruz-cursor-h").style.background || "") };
  });

  // ---- 5) Salir del editor (volver al selector) oculta la cruz, no queda flotando en otra pantalla ----
  await page.evaluate(() => volverASelectorPlanos());
  const r5 = await page.evaluate(() => ({
    hOculta: document.getElementById("cruz-cursor-h").style.display === "none",
    vOculta: document.getElementById("cruz-cursor-v").style.display === "none",
  }));
  console.log("5) Se oculta al volver al selector de planos:", JSON.stringify(r5));

  console.log("Resultado:", JSON.stringify({ r1, r2, r3, r3b, r4, r4b, r5 }, null, 2));

  const fallas = [];
  if (!r1.hVisible || !r1.vVisible) fallas.push("1) BUG: el cursor en cruz no aparece al mover sobre el plano (debería estar activo por defecto)");
  if (!r1.hCruzaTodoElAncho) fallas.push(`1) BUG: la línea horizontal no cruza TODO el ancho del plano -- ${JSON.stringify(r1)}`);
  if (!r1.vCruzaTodoElAlto) fallas.push(`1) BUG: la línea vertical no cruza TODO el alto del plano -- ${JSON.stringify(r1)}`);
  if (Math.abs(r1.hTop - cy) > 1) fallas.push(`1) BUG: la línea horizontal no sigue al cursor -- top=${r1.hTop}, esperado ~${cy}`);
  if (Math.abs(r1.vLeft - cx) > 1) fallas.push(`1) BUG: la línea vertical no sigue al cursor -- left=${r1.vLeft}, esperado ~${cx}`);

  if (!r2.hOculta || !r2.vOculta) fallas.push("2) BUG: el cursor en cruz no se oculta al salir del canvas (pointerleave)");

  if (r3.activaTrasApagar) fallas.push("3) BUG EN EL TEST: toggleCruzCursor() no la desactivó");
  if (r3b.hVisible) fallas.push("3) BUG: con el cursor en cruz desactivado, sigue apareciendo al mover sobre el plano");

  if (!r4.overlayAbierto) fallas.push("4) BUG: abrirAjustesCruzCursor() no abrió el cuadro de ajustes");
  if (r4.colorGuardado !== "#ff5500") fallas.push(`4) BUG: el color elegido no se guardó en localStorage -- quedó "${r4.colorGuardado}"`);
  if (!r4b.colorLinea.includes("255,85,0") && !r4b.colorLinea.includes("#ff5500")) fallas.push(`4) BUG: la línea no usa el nuevo color elegido -- quedó "${r4b.colorLinea}"`);

  if (!r5.hOculta || !r5.vOculta) fallas.push("5) BUG: al volver al selector de planos, el cursor en cruz quedó flotando visible");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL CURSOR EN CRUZ OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
