// Pedido del usuario: "revisa que no está funcionando los dibujos estilo Revit" (la Rejilla).
// Diagnóstico: el flujo de toque normal (botón -> toque en el plano con lupa) funcionaba bien --
// el problema real era que el aviso de "mantené pulsado para ver qué hace" (PR de mantener
// pulsado) se disparaba a los 450ms, un lapso fácil de superar sin querer en un botón poco
// familiar como "Rejilla" -- y cuando eso pasaba, el botón quedaba cancelado EN SILENCIO (sin
// ningún aviso de que no se activó), indistinguible de un botón roto. Se sube el umbral a 600ms
// y, cuando de verdad se cancela, ahora se avisa con un toast claro.
// Bug secundario encontrado de paso: justo después de tocar la primera columna se abre un diálogo
// "¿A qué distancia va la próxima?" -- si se lo cierra por afuera de sus propios botones (la "✕"
// genérica de arriba a la derecha, deslizando, o "atrás" del celular) en vez de usar "Terminar"/
// "Cancelar", la rejilla quedaba en un limbo: ni esperando el próximo toque ni terminada, sin
// ningún botón visible en pantalla para seguir o cancelar. Ahora ese cierre "por afuera" termina
// sola la rejilla (conservando lo ya puesto), igual que tocar "✓ Terminar la rejilla".
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
    metrosPorPixelPlano = 0.01; // 100px = 1m, para cuentas redondas
    await guardarCalibracionPlano();
    toggleDrawerHerramientas("medir");
  });

  const client = await page.context().newCDPSession(page);
  const botonRejilla = () => page.$('[onclick="iniciarRejilla()"]');

  // ---- 1) Un toque CORTO en el botón "Rejilla" sigue activando el modo normalmente ----
  let btn = await botonRejilla();
  let box = await btn.boundingBox();
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x+box.width/2, y: box.y+box.height/2 }] });
  await page.waitForTimeout(100);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
  const trasToqueCorto = await page.evaluate(() => ({ modoColumnas: modoRejillaColumnas }));
  if (!trasToqueCorto.modoColumnas) throw new Error("BUG: un toque corto en 'Rejilla' debería activar el modo igual que siempre: " + JSON.stringify(trasToqueCorto));

  // ---- 2) Tocar el plano con un toque real (no llamando la función directo) coloca la columna 1 ----
  const canvas = await page.$("#canvas-plano");
  const cbox = await canvas.boundingBox();
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cbox.x+100, y: cbox.y+80 }] });
  await page.waitForTimeout(80);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);
  const trasToqueCanvas = await page.evaluate(() => lineasReferencia.map(l=>({orientacion:l.orientacion, nombre:l.nombre})));
  if (trasToqueCanvas.length !== 1 || trasToqueCanvas[0].nombre !== "1") {
    throw new Error("BUG: tocar el plano en modo Rejilla debería poner la columna '1': " + JSON.stringify(trasToqueCanvas));
  }

  // ---- 3) Cerrar el diálogo "¿a qué distancia va la próxima columna?" por afuera de sus propios
  //         botones (la "✕" genérica de arriba a la derecha de cualquier diálogo de la app, que
  //         solo llama a cerrarPromptGenerico()) -- antes dejaba la rejilla en un limbo; ahora
  //         debería terminarla sola, conservando la columna ya puesta. ----
  const promptVisibleAntes = await page.evaluate(() => document.getElementById("prompt-generico-overlay").style.display);
  if (promptVisibleAntes !== "flex") throw new Error("Debería estar abierto el diálogo de distancia tras poner la columna 1.");
  await page.evaluate(() => cerrarPromptGenerico()); // exactamente lo que hace el botón "✕" genérico
  const trasCerrarPorFuera = await page.evaluate(() => ({
    modoColumnas: modoRejillaColumnas, modoFilas: modoRejillaFilas, rejillaEnCurso,
    lineas: lineasReferencia.length,
  }));
  if (trasCerrarPorFuera.modoColumnas || trasCerrarPorFuera.modoFilas) throw new Error("BUG: cerrar el diálogo debería apagar el modo Rejilla: " + JSON.stringify(trasCerrarPorFuera));
  if (trasCerrarPorFuera.rejillaEnCurso !== null) throw new Error("BUG: cerrar el diálogo por afuera debería terminar la rejilla (limpiar rejillaEnCurso), no dejarla colgada en un limbo: " + JSON.stringify(trasCerrarPorFuera));
  if (trasCerrarPorFuera.lineas !== 1) throw new Error("BUG: cerrar el diálogo por afuera no debería borrar la columna ya puesta: " + trasCerrarPorFuera.lineas);

  // ---- 3b) El flujo normal de "Agregar otra columna" (que ya no cierra el diálogo antes de
  //          reabrirlo) sigue funcionando igual que siempre. ----
  await page.evaluate(() => { lineasReferencia = []; guardarLineasReferencia(); toggleDrawerHerramientas("medir"); iniciarRejilla(); });
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cbox.x+100, y: cbox.y+80 }] });
  await page.waitForTimeout(80);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(100);
  const columna2 = await page.evaluate(() => {
    document.getElementById("rejilla-distancia").value = "2";
    confirmarSiguienteLineaRejilla("v");
    return { visible: document.getElementById("prompt-generico-overlay").style.display, lineas: lineasReferencia.length };
  });
  if (columna2.visible !== "flex") throw new Error("BUG: tras 'Agregar otra columna' debería seguir abierto el diálogo pidiendo la siguiente distancia: " + JSON.stringify(columna2));
  if (columna2.lineas !== 2) throw new Error("BUG: 'Agregar otra columna' debería haber puesto la columna 2: " + JSON.stringify(columna2));
  await page.evaluate(() => { _rejillaCierreControlado=true; cerrarPromptGenerico(); terminarRejilla(); });

  // ---- 4) Salir con la "✕" SIN haber puesto ninguna línea todavía -- no debería dejar un grupo
  //         vacío ni mostrar un confuso "Rejilla lista: 0 × 0". ----
  await page.evaluate(() => { lineasReferencia = []; guardarLineasReferencia(); });
  await page.evaluate(() => { toggleDrawerHerramientas("medir"); iniciarRejilla(); });
  const trasSalirSinNada = await page.evaluate(() => { salirDeModosDibujoActivos(); return { lineas: lineasReferencia.length, rejillaEnCurso, modoColumnas: modoRejillaColumnas }; });
  if (trasSalirSinNada.lineas !== 0) throw new Error("BUG: salir sin haber puesto nada no debería dejar líneas huérfanas: " + JSON.stringify(trasSalirSinNada));
  if (trasSalirSinNada.rejillaEnCurso !== null || trasSalirSinNada.modoColumnas) throw new Error("BUG: salir sin haber puesto nada debería limpiar el estado del todo: " + JSON.stringify(trasSalirSinNada));

  // ---- 5) Mantener pulsado el botón "Rejilla" MÁS del umbral (600ms) muestra la descripción pero
  //         YA NO lo activa -- y ahora avisa con un toast claro de que hay que soltar y tocar de
  //         nuevo, en vez de quedar en silencio (eso es lo que se veía como "no funciona"). ----
  await page.evaluate(() => { toggleDrawerHerramientas("medir"); });
  btn = await botonRejilla();
  box = await btn.boundingBox();
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x+box.width/2, y: box.y+box.height/2 }] });
  await page.waitForTimeout(750); // bien por encima del nuevo umbral de 600ms
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
  const trasHold = await page.evaluate(() => ({ modoColumnas: modoRejillaColumnas, toast: document.getElementById("toast").textContent }));
  if (trasHold.modoColumnas) throw new Error("Mantener pulsado más del umbral no debería activar el modo (es la vista previa, no la acción real).");
  if (!trasHold.toast.includes("Soltaste después de ver la descripción")) {
    throw new Error("BUG: al cancelarse por mantener pulsado, debería avisar con claridad que hay que tocar más rápido, no quedar en silencio: " + trasHold.toast);
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-rejilla-no-funciona");
})().catch((e) => { console.error(e); process.exit(1); });
