// Bug reportado por el usuario (con una captura marcada en rojo): "en la parte superior hay una
// barra que en momentos no permite dibujar porque la imagen se fija en la parte superior izquierda
// y esa barra tapa el área de dibujo". Dos causas reales encontradas:
// 1) La lupa de precisión (el círculo de zoom que aparece sobre el dedo al tocar para ubicar un
//    punto) se calculaba SIEMPRE arriba-centrada del dedo, sin fijarse si entraba en pantalla --
//    cerca del borde superior/izquierdo (justo donde queda el plano paneado hasta el fondo) se iba
//    fuera de la pantalla, invisible. Sin la lupa no se puede ubicar un punto con precisión ahí.
// 2) El cartel de estado mientras se dibuja (".cad-status", #estado-dibujo) y el de "modo especial
//    prendido" (".cad-modo-flotante") NO tenían pointer-events:none como sí tiene el de
//    inactividad (".cad-hint-idle") -- un toque que caía justo en ese cartel se lo comía el DIV en
//    vez de llegarle al <canvas> de abajo: tocar ahí "no hacía nada" de verdad, no era solo un
//    problema visual.
// (Arreglo posterior, PR aparte: pointer-events:none solo evitaba que el toque se "perdiera", pero
// el cartel seguía TAPANDO visualmente el dibujo si el plano quedaba paneado ahí -- ahora además
// el lienzo (#canvas-wrap) se corre hacia abajo para no quedar nunca debajo del cartel, ver
// test-plano-banner-reserva-espacio.js. Por eso la sección 2 de abajo ya no prueba que un toque en
// esa zona llegue al <canvas> -- ahí ya no hay lienzo, es espacio reservado a propósito -- sino que
// el cartel y el lienzo no se superponen.)
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
  });

  // ---- 1) La lupa, al tocar bien cerca del borde superior-izquierdo, queda DENTRO de la pantalla
  //         (no se calcula fuera, invisible) ----
  const canvas = await page.$("#canvas-plano");
  const cbox = await canvas.boundingBox();
  const resultadoLupa = await page.evaluate(({x, y}) => {
    actualizarLupa(x, y, 10, 10, "libre"); // clientX/clientY bien arriba a la izquierda
    const lupa = document.getElementById("lupa");
    const r = lupa.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }, { x: cbox.x + 10, y: cbox.y + 10 });
  if (resultadoLupa.top < 0) throw new Error("BUG: la lupa queda arriba del borde de la pantalla (invisible) cerca del borde superior: top=" + resultadoLupa.top);
  if (resultadoLupa.left < 0) throw new Error("BUG: la lupa queda a la izquierda del borde de la pantalla (invisible) cerca del borde izquierdo: left=" + resultadoLupa.left);
  const alto = await page.evaluate(() => window.innerHeight);
  const ancho = await page.evaluate(() => window.innerWidth);
  if (resultadoLupa.top + resultadoLupa.height > alto) throw new Error("BUG: la lupa se sale por abajo de la pantalla: " + JSON.stringify(resultadoLupa));
  if (resultadoLupa.left + resultadoLupa.width > ancho) throw new Error("BUG: la lupa se sale por la derecha de la pantalla: " + JSON.stringify(resultadoLupa));
  await page.evaluate(() => ocultarLupa());

  // ---- 2) Durante el dibujo activo, el cartel de estado (.cad-status) no se come los toques --
  //         un toque que cae justo en su rectángulo tiene que llegar igual al <canvas>. ----
  await page.evaluate(() => {
    toggleDrawerHerramientas("dibujar");
    document.getElementById("input-nombre-actividad-nueva").value = "Pintura";
    iniciarDibujo();
  });
  await page.waitForTimeout(100);
  const estado = await page.evaluate(() => {
    const est = document.getElementById("estado-dibujo");
    const cs = getComputedStyle(est);
    return { display: est.style.display, pointerEvents: cs.pointerEvents, rect: est.getBoundingClientRect() };
  });
  if (estado.display !== "block") throw new Error("El cartel de estado de dibujo debería estar visible en este punto del test (falló el setup): " + JSON.stringify(estado));
  if (estado.pointerEvents !== "none") {
    throw new Error("BUG: el cartel de estado de dibujo no tiene pointer-events:none -- se comería los toques que caigan encima: " + JSON.stringify(estado));
  }
  // El lienzo (#canvas-wrap) tiene que arrancar, en pantalla, debajo de donde termina el cartel --
  // si no, el cartel seguiría tapando visualmente la franja de arriba del dibujo.
  {
    const rectWrap = await page.evaluate(() => document.getElementById("canvas-wrap").getBoundingClientRect().top);
    if (rectWrap < estado.rect.bottom) {
      throw new Error("BUG: el cartel de estado (termina en " + estado.rect.bottom + "px) sigue tapando el lienzo (arranca en " + rectWrap + "px).");
    }
  }
  await page.evaluate(() => { if (typeof cancelarDibujo === "function") cancelarDibujo(); });

  // ---- 3) El cartel de "modo especial" (.cad-modo-flotante) tampoco se come los toques, pero su
  //         botón ✕ sigue siendo tocable. ----
  const modoFlotante = await page.evaluate(() => {
    toggleModoAutoContorno();
    const cont = document.getElementById("cad-modo-flotante");
    const btnX = cont.querySelector(".x");
    return {
      contPointerEvents: getComputedStyle(cont).pointerEvents,
      xPointerEvents: getComputedStyle(btnX).pointerEvents,
    };
  });
  if (modoFlotante.contPointerEvents !== "none") throw new Error("BUG: .cad-modo-flotante debería dejar pasar los toques al lienzo: " + JSON.stringify(modoFlotante));
  if (modoFlotante.xPointerEvents !== "auto") throw new Error("BUG: el botón '✕' de .cad-modo-flotante debería seguir siendo tocable: " + JSON.stringify(modoFlotante));
  const btnX = await page.$("#cad-modo-flotante .x");
  await btnX.click();
  const sigueActivo = await page.evaluate(() => modoAutoContorno);
  if (sigueActivo) throw new Error("BUG: el botón ✕ del cartel de modo especial dejó de apagar el modo.");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-lupa-y-carteles-no-tapan-dibujo");
})().catch((e) => { console.error(e); process.exit(1); });
