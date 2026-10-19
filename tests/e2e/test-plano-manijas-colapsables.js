// El usuario aprobó un mockup y pidió llevarlo a código: las 3 franjas colapsables del editor de
// plano (encabezado de arriba, barra ORTO/GRID/REF de abajo, y la tarjeta "Actividades y % de
// avance") comparten el mismo lenguaje visual -- una manija fina de 22px con una pastillita
// celeste, en vez de texto "⋯" o una flechita de acordeón. El encabezado de arriba (antes fijo,
// siempre ocupando 58px) ahora arranca COLAPSADO para dejarle más lugar al plano, y se despliega
// tocando su manija.
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
    entrarAEditarPlano();
    await new Promise(r=>setTimeout(r, 200));
  });

  // ---- 1) El encabezado de arriba arranca COLAPSADO (más lugar para el plano desde el vamos) ----
  // El plano recién abierto está "idle" (nada en curso), así que el cartel de ayuda
  // (#cad-hint-idle) está visible por diseño -- el lienzo tiene que dejarle lugar A ÉL, no
  // arrancar en un 22px a secas (eso taparía el cartel, el mismo bug que ya se arregló antes).
  const estadoInicial = await page.evaluate(() => {
    const hint = document.getElementById("cad-hint-idle");
    return {
      abierta: document.getElementById("cad-header-bar").classList.contains("abierta"),
      topLienzo: parseFloat(getComputedStyle(document.getElementById("canvas-wrap")).top),
      topEsperado: Math.max(22, 22 + hint.offsetHeight + 8),
    };
  });
  if (estadoInicial.abierta) throw new Error("BUG: el encabezado debería arrancar colapsado: " + JSON.stringify(estadoInicial));
  if (estadoInicial.topLienzo !== estadoInicial.topEsperado) throw new Error("BUG: con el encabezado colapsado, el lienzo debería dejarle lugar justo al cartel de ayuda visible: " + JSON.stringify(estadoInicial));

  // ---- 2) Tocar la manija de arriba lo despliega, y el lienzo le deja el espacio real (58px del
  //          encabezado + 22px de manija, más lo que haga falta si el cartel de ayuda es más alto) ----
  await page.click("#cad-header-bar .cad-header-handle");
  const estadoAbierto = await page.evaluate(() => {
    const hint = document.getElementById("cad-hint-idle");
    return {
      abierta: document.getElementById("cad-header-bar").classList.contains("abierta"),
      topLienzo: parseFloat(getComputedStyle(document.getElementById("canvas-wrap")).top),
      topEsperado: Math.max(80, 80 + hint.offsetHeight + 8),
    };
  });
  if (!estadoAbierto.abierta) throw new Error("BUG: tocar la manija debería abrir el encabezado.");
  if (estadoAbierto.topLienzo !== estadoAbierto.topEsperado) throw new Error("BUG: con el encabezado abierto, el lienzo debería arrancar debajo de él Y del cartel de ayuda: " + JSON.stringify(estadoAbierto));
  if (estadoAbierto.topLienzo <= estadoInicial.topLienzo) throw new Error("BUG: con el encabezado abierto el lienzo debería arrancar más abajo que con el encabezado colapsado: " + JSON.stringify({ estadoInicial, estadoAbierto }));

  // Tocar de nuevo lo vuelve a colapsar.
  await page.click("#cad-header-bar .cad-header-handle");
  const estadoRecolapsado = await page.evaluate(() => document.getElementById("cad-header-bar").classList.contains("abierta"));
  if (estadoRecolapsado) throw new Error("BUG: tocar la manija de nuevo debería volver a colapsar el encabezado.");

  // ---- 3) Las 3 manijas (arriba, abajo, Actividades) tienen la MISMA altura (22px) y la misma
  //          pastillita celeste -- un solo lenguaje visual, no 3 estilos distintos. ----
  const manijas = await page.evaluate(() => {
    const leer = (sel) => {
      const el = document.querySelector(sel);
      const grabber = el.querySelector(".grabber");
      return {
        alto: el.getBoundingClientRect().height,
        tieneGrabber: !!grabber,
        colorGrabber: grabber ? getComputedStyle(grabber).backgroundColor : null,
      };
    };
    return {
      arriba: leer("#cad-header-bar .cad-header-handle"),
      abajo: leer("#cad-status-bar .cad-status-handle"),
      actividades: leer("#card-actividades .manija-actividades"),
    };
  });
  for (const [nombre, m] of Object.entries(manijas)) {
    if (Math.round(m.alto) !== 22) throw new Error(`BUG: la manija "${nombre}" debería medir 22px de alto, mide ${m.alto}`);
    if (!m.tieneGrabber) throw new Error(`BUG: la manija "${nombre}" debería tener la pastillita (grabber) celeste.`);
  }
  if (manijas.arriba.colorGrabber !== manijas.abajo.colorGrabber || manijas.abajo.colorGrabber !== manijas.actividades.colorGrabber) {
    throw new Error("BUG: las 3 manijas deberían tener exactamente el mismo color de pastillita: " + JSON.stringify(manijas));
  }

  // ---- 4) La barra ORTO/GRID de abajo sigue funcionando (el orden manija-primero-contenido-
  //          después es el que la hace andar -- este fue justamente el bug del mockup). ----
  const botonesAntesDeTocar = await page.evaluate(() => document.getElementById("cad-status-bar").classList.contains("abierta"));
  await page.click("#cad-status-bar .cad-status-handle");
  const botonesTrasTocar = await page.evaluate(() => document.getElementById("cad-status-bar").classList.contains("abierta"));
  if (botonesAntesDeTocar === botonesTrasTocar) throw new Error("BUG: tocar la manija de ORTO/GRID debería abrir/cerrar esa barra.");
  const refVisible = await page.evaluate(() => {
    const btn = document.getElementById("btn-referencias-plano");
    return btn.getBoundingClientRect().width > 0 && btn.getBoundingClientRect().height > 0;
  });
  if (!refVisible) throw new Error("BUG: con la barra de abajo abierta, el botón REF debería ser visible/tocable.");

  // ---- 5) La tarjeta "Actividades y % de avance": el título YA NO es lo que abre/cierra -- es
  //          la manija nueva la que lo hace. ----
  await page.evaluate(() => { document.querySelector("#card-actividades .titulo-card-abajo").click(); });
  const siguioCerradaTrasTocarTitulo = await page.evaluate(() => document.getElementById("cuerpo-card-actividades").style.display === "none");
  if (!siguioCerradaTrasTocarTitulo) throw new Error("BUG: tocar el título de Actividades ya no debería abrir/cerrar nada -- eso ahora lo hace la manija.");
  await page.click("#card-actividades .manija-actividades");
  const abiertaTrasManija = await page.evaluate(() => document.getElementById("cuerpo-card-actividades").style.display === "block");
  if (!abiertaTrasManija) throw new Error("BUG: tocar la manija de Actividades debería abrir la lista.");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-manijas-colapsables");
})().catch((e) => { console.error(e); process.exit(1); });
