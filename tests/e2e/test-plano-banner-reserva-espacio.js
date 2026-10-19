// Bug reportado por el usuario: después del arreglo anterior (pointer-events:none en la barra de
// estado/cartel flotante del plano), el toque ya pasaba bien al lienzo, pero el cartel seguía
// TAPANDO VISUALMENTE el dibujo cuando el plano quedaba paneado/zoomeado de forma que esa zona
// cayera justo debajo del cartel -- el cartel es position:absolute fijo en la esquina de la
// pantalla, no se mueve con el plano, y antes el lienzo (#canvas-wrap) arrancaba siempre en el
// mismo lugar (top fijo) sin importar si había o no un cartel encima.
// Arreglo: cuando cualquiera de los 3 carteles flotantes (#estado-dibujo, #cad-hint-idle,
// #cad-modo-flotante) está visible, el lienzo tiene que arrancar más abajo, debajo de la altura
// real de ESE cartel (que varía según el texto) -- así nunca hay píxeles del dibujo debajo del
// cartel, sin importar cuánto texto tenga.
// (Ronda posterior: el encabezado de arriba se volvió colapsable -- el "top fijo" de referencia
// ya no es 58px siempre, sino TOP_BASE=22 con el encabezado colapsado (el estado por defecto al
// entrar al editor, que es el que usa este test) o 80 si está desplegado.)
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

  // ---- 1) Sin ningún cartel visible, el lienzo arranca en el lugar de siempre (TOP_BASE, con el
  //          encabezado colapsado por defecto) ----
  const topSinCartel = await page.evaluate(() => {
    document.getElementById("estado-dibujo").style.display = "none";
    document.getElementById("cad-hint-idle").style.display = "none";
    document.getElementById("cad-modo-flotante").style.display = "none";
    document.getElementById("canvas-wrap").style.top = ""; // fuerza a que se recalcule desde cero
    if (typeof recalcularEspacioCadStatus === "function") recalcularEspacioCadStatus();
    return getComputedStyle(document.getElementById("canvas-wrap")).top;
  });
  if (topSinCartel !== "22px") {
    throw new Error("BUG: sin ningún cartel visible (encabezado colapsado), el lienzo debería arrancar en 22px: " + topSinCartel);
  }

  // ---- 2) Con un cartel de texto LARGO (varias líneas) visible, el lienzo se corre hacia abajo
  //          lo suficiente para no quedar tapado -- no un número fijo adivinado. ----
  const resultado = await page.evaluate(() => {
    const cartel = document.getElementById("estado-dibujo");
    cartel.style.display = "block";
    cartel.textContent = "Primera esquina lista. Ahora tocá la esquina OPUESTA (en diagonal) para completar el rectángulo. Si te equivocaste, tocá Deshacer y volvé a intentar.";
    if (typeof recalcularEspacioCadStatus === "function") recalcularEspacioCadStatus();
    const wrap = document.getElementById("canvas-wrap");
    const alturaCartel = cartel.offsetHeight;
    const topLienzo = parseFloat(getComputedStyle(wrap).top);
    return { alturaCartel, topLienzo };
  });
  if (!(resultado.alturaCartel > 30)) {
    throw new Error("El cartel de prueba debería haber ocupado varias líneas (texto largo): altura=" + resultado.alturaCartel);
  }
  // El cartel arranca en el mismo TOP_BASE que el lienzo (22px, encabezado colapsado) -- el
  // lienzo tiene que arrancar, como mínimo, donde termina el cartel (22 + su alto real), si no
  // una parte del cartel multi-línea seguiría quedando por encima del lienzo (tapando el borde
  // superior del dibujo).
  if (resultado.topLienzo < 22 + resultado.alturaCartel) {
    throw new Error("BUG: el lienzo (top=" + resultado.topLienzo + "px) debería arrancar debajo del cartel visible (que termina en " + (22 + resultado.alturaCartel) + "px) -- el cartel todavía tapa parte del dibujo.");
  }

  // ---- 3) Al ocultar el cartel de nuevo, el lienzo vuelve a su lugar de siempre ----
  const topTrasOcultar = await page.evaluate(() => {
    document.getElementById("estado-dibujo").style.display = "none";
    if (typeof recalcularEspacioCadStatus === "function") recalcularEspacioCadStatus();
    return getComputedStyle(document.getElementById("canvas-wrap")).top;
  });
  if (topTrasOcultar !== "22px") {
    throw new Error("BUG: al ocultar el cartel, el lienzo debería volver a 22px: " + topTrasOcultar);
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-banner-reserva-espacio");
})().catch((e) => { console.error(e); process.exit(1); });
