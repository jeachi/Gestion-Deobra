// Pedido del usuario: "activa siempre la lupa cuando ubico cosas en el plano porque cuando fui
// a medir con cinta no tenía lupa y cuando fui a dar puntos para escalar el plano tampoco salió
// la lupa y pasa que cuando activo una etiqueta o pin al pulsar el plano lo coloca de una vez
// quiero poder previsualización y moverlo al sitio exacto antes de que quede fijo" -- y, al
// preguntarle el alcance, contestó "en todos los lugares donde tengo que hacer algo en el plano".
//
// Antes, el dibujo de ÁREAS (polígonos/rectángulos) ya tenía lupa + arrastre antes de confirmar,
// pero estas OTRAS 8 herramientas de "tocar y ubicar" fijaban el punto apenas se tocaba, sin lupa
// ni chance de corregir: cinta métrica, calibración de escala, agregar pin (Maestro), etiqueta
// nueva, ejes/referencias, origen de grilla, foto de avance y contorno interno (auto-hatch). Ahora
// las 8 pasan por el mismo mecanismo genérico (iniciarColocacionConLupa): mantener presionado
// muestra la lupa, se puede arrastrar para ajustar, y recién al soltar se confirma el punto --
// usando la posición donde se SOLTÓ, no donde se tocó por primera vez.
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

  // Arrastra el dedo desde (ax,ay) hasta (bx,by) -- en coordenadas NATIVAS del plano -- y devuelve
  // si la lupa estuvo visible durante el arrastre y si quedó oculta al soltar.
  async function arrastrar(ax, ay, bx, by) {
    return page.evaluate(([ax, ay, bx, by]) => {
      const canvas = document.getElementById("canvas-plano");
      const rect = canvas.getBoundingClientRect();
      const escalaX = canvas.width / rect.width, escalaY = canvas.height / rect.height;
      const toClient = (x, y) => ({ clientX: rect.left + x / escalaX, clientY: rect.top + y / escalaY });
      const A = toClient(ax, ay), B = toClient(bx, by);
      // La calibración de escala escucha "pointerdown" en vez de "mousedown" (a diferencia de las
      // demás herramientas, que cuelgan de canvas.onmousedown) -- se disparan los dos para que el
      // mismo helper sirva para todas; en un dispositivo real, un toque siempre dispara ambos.
      canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: A.clientX, clientY: A.clientY, bubbles: true, cancelable: true }));
      canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: A.clientX, clientY: A.clientY, bubbles: true, cancelable: true }));
      const lupaAlTocar = document.getElementById("lupa").style.display === "block";
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: B.clientX, clientY: B.clientY, bubbles: true, cancelable: true }));
      const lupaAlArrastrar = document.getElementById("lupa").style.display === "block";
      document.dispatchEvent(new MouseEvent("mouseup", { clientX: B.clientX, clientY: B.clientY, bubbles: true, cancelable: true }));
      const lupaOcultaAlSoltar = document.getElementById("lupa").style.display === "none";
      return { lupaAlTocar, lupaAlArrastrar, lupaOcultaAlSoltar };
    }, [ax, ay, bx, by]);
  }

  const A = [100, 100], B = [400, 300]; // bien separados -- si usara el punto de A en vez de B, se notaría

  // ---- 1) Cinta métrica: lupa visible durante el arrastre, punto final = donde se soltó ----
  const r1 = await page.evaluate(() => { iniciarCintaMetrica(); return { modoActivo: modoCinta }; });
  const r1b = await arrastrar(...A, ...B);
  const r1c = await page.evaluate(() => ({ punto: puntosCinta[0] }));
  await page.evaluate(() => salirDeCinta());

  // ---- 2) Calibración de escala: mismo mecanismo ----
  const r2 = await page.evaluate(() => { iniciarCalibracionEscalaManual(); return { activa: calibracionActiva }; });
  const r2b = await arrastrar(...A, ...B);
  const r2c = await page.evaluate(() => ({ punto: calibracionPuntos[0] }));
  await page.evaluate(() => { calibracionActiva = false; calibracionPuntos = []; document.getElementById("canvas-plano").removeEventListener("pointerdown", capturarPuntoCalibracion); cerrarPromptGenerico(); });

  // ---- 3) Ejes / líneas de referencia ----
  const r3 = await page.evaluate(() => { lineasReferencia = []; iniciarColocarReferencia(); return { activo: modoColocarReferencia }; });
  const r3b = await arrastrar(...A, ...B);
  const r3c = await page.evaluate(() => {
    const v = lineasReferencia.find(l => l.orientacion === "v"), h = lineasReferencia.find(l => l.orientacion === "h");
    return { x: v && v.pos, y: h && h.pos };
  });
  await page.evaluate(() => { modoColocarReferencia = false; salirDeColocarReferencia(); });

  // ---- 4) Origen de grilla ----
  const r4 = await page.evaluate(() => { iniciarUbicarOrigenGrid(); return { activo: modoUbicarOrigenGrid }; });
  const r4b = await arrastrar(...A, ...B);
  const r4c = await page.evaluate(() => ({ x: gridOffsetX, y: gridOffsetY }));

  // ---- 5) Etiqueta nueva (ancla de texto) ----
  const r5 = await page.evaluate(() => { iniciarColocarTextoPlano(); return { activo: modoAnclaTextoPlano }; });
  const r5b = await arrastrar(...A, ...B);
  const r5c = await page.evaluate(() => {
    const ancla = JSON.parse(document.getElementById("prompt-texto-plano-overlay").dataset.ancla || "null");
    return { ancla, overlayAbierto: document.getElementById("prompt-texto-plano-overlay").style.display === "flex" };
  });
  await page.evaluate(() => cerrarPromptTextoPlano());

  // ---- 6) Foto de avance (ancla) -- se activa el flag directo (iniciarFotoAvance() exige tener
  //      Gemini configurado, algo ajeno a lo que se prueba acá: solo el mecanismo de lupa) ----
  const r6 = await page.evaluate(() => { fotoAvanceAncla = null; modoAnclaFotoAvance = true; return { activo: modoAnclaFotoAvance }; });
  const r6b = await arrastrar(...A, ...B);
  const r6c = await page.evaluate(() => ({ ancla: fotoAvanceAncla }));
  await page.evaluate(() => { modoAnclaFotoAvance = false; fotoAvanceAncla = null; });

  // ---- 7) Contorno interno (semilla del auto-hatch) -- se activa el flag directo y se espía
  //      detectarContornoPorPuntoInterno, para no depender de las precondiciones de
  //      iniciarContornoPorPuntoInterno() (mapa de bordes real, actividad elegida) ni de que la
  //      imagen de prueba tenga una habitación real cerrada -- ajenas a lo que se prueba acá ----
  const r7 = await page.evaluate(() => {
    window._xyCapturado = null;
    window._detectarOriginal = detectarContornoPorPuntoInterno;
    detectarContornoPorPuntoInterno = (x, y) => { window._xyCapturado = { x, y }; return { ok: false, motivo: "test" }; };
    modoContornoInterno = true;
    return { activo: modoContornoInterno };
  });
  const r7b = await arrastrar(...A, ...B);
  const r7c = await page.evaluate(() => {
    const captado = window._xyCapturado;
    detectarContornoPorPuntoInterno = window._detectarOriginal;
    modoContornoInterno = false;
    return { captado };
  });

  console.log("Resultado:", JSON.stringify({ r1, r1b, r1c, r2, r2b, r2c, r3, r3b, r3c, r4, r4b, r4c, r5, r5b, r5c, r6, r6b, r6c, r7, r7b, r7c }, null, 2));

  const fallas = [];
  const cerca = (v, esperado, tol = 2) => typeof v === "number" && Math.abs(v - esperado) <= tol;

  // Cinta
  if (!r1.modoActivo) fallas.push("1) BUG EN EL TEST: no se activó la cinta métrica");
  if (!r1b.lupaAlArrastrar) fallas.push("1) BUG: la lupa no aparece al arrastrar con la cinta métrica activa");
  if (!r1b.lupaOcultaAlSoltar) fallas.push("1) BUG: la lupa no se oculta al soltar (cinta)");
  if (!r1c.punto || !cerca(r1c.punto[0], B[0]) || !cerca(r1c.punto[1], B[1])) fallas.push(`1) BUG: el punto de la cinta se fijó donde se tocó (A), no donde se soltó (B) -- quedó ${JSON.stringify(r1c.punto)}, esperado ~${JSON.stringify(B)}`);

  // Calibración
  if (!r2.activa) fallas.push("2) BUG EN EL TEST: no se activó la calibración manual");
  if (!r2b.lupaAlArrastrar) fallas.push("2) BUG: la lupa no aparece al arrastrar en calibración de escala");
  if (!r2c.punto || !cerca(r2c.punto[0], B[0]) || !cerca(r2c.punto[1], B[1])) fallas.push(`2) BUG: el punto de calibración se fijó en A, no en B -- quedó ${JSON.stringify(r2c.punto)}`);

  // Ejes
  if (!r3.activo) fallas.push("3) BUG EN EL TEST: no se activó colocar referencia (ejes)");
  if (!r3b.lupaAlArrastrar) fallas.push("3) BUG: la lupa no aparece al colocar un eje");
  if (!cerca(r3c.x, B[0]) || !cerca(r3c.y, B[1])) fallas.push(`3) BUG: el eje se colocó en A, no en B -- quedó ${JSON.stringify(r3c)}`);

  // Grilla
  if (!r4.activo) fallas.push("4) BUG EN EL TEST: no se activó ubicar origen de grilla");
  if (!r4b.lupaAlArrastrar) fallas.push("4) BUG: la lupa no aparece al ubicar el origen de la grilla");
  if (!cerca(r4c.x, B[0]) || !cerca(r4c.y, B[1])) fallas.push(`4) BUG: el origen de grilla quedó en A, no en B -- quedó ${JSON.stringify(r4c)}`);

  // Etiqueta nueva
  if (!r5.activo) fallas.push("5) BUG EN EL TEST: no se activó colocar etiqueta nueva");
  if (!r5b.lupaAlArrastrar) fallas.push("5) BUG: la lupa no aparece al ubicar una etiqueta nueva");
  if (!r5c.overlayAbierto) fallas.push("5) BUG: no se abrió el cuadro de la etiqueta nueva al soltar");
  if (!r5c.ancla || !cerca(r5c.ancla.x, B[0]) || !cerca(r5c.ancla.y, B[1])) fallas.push(`5) BUG: la etiqueta se ancló en A, no en B -- quedó ${JSON.stringify(r5c.ancla)}`);

  // Foto de avance
  if (!r6.activo) fallas.push("6) BUG EN EL TEST: no se activó anclar foto de avance");
  if (!r6b.lupaAlArrastrar) fallas.push("6) BUG: la lupa no aparece al anclar una foto de avance");
  if (!r6c.ancla || !cerca(r6c.ancla.x, B[0]) || !cerca(r6c.ancla.y, B[1])) fallas.push(`6) BUG: la foto se ancló en A, no en B -- quedó ${JSON.stringify(r6c.ancla)}`);

  // Contorno interno
  if (!r7.activo) fallas.push("7) BUG EN EL TEST: no se activó contorno interno");
  if (!r7b.lupaAlArrastrar) fallas.push("7) BUG: la lupa no aparece al ubicar el punto semilla de contorno interno");
  if (!r7c.captado || !cerca(r7c.captado.x, B[0]) || !cerca(r7c.captado.y, B[1])) fallas.push(`7) BUG: el punto semilla de contorno interno se tomó de A, no de B -- quedó ${JSON.stringify(r7c.captado)}`);

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE LUPA EN LAS 8 HERRAMIENTAS DE COLOCAR UN PUNTO OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
