// Bug reportado por el usuario: "el zoom de pinzamiento se está tildando y también el plano está
// lento". Causa real: moverPinch() corre decenas de veces por segundo mientras se pellizca, y
// antes llamaba a aplicarZoom() COMPLETO en cada toque -- eso recrea de cero (con sus listeners)
// un <div> por cada manija/badge de %/etiqueta/pin del plano. En un plano con muchas etiquetas,
// hacer eso 60+ veces por segundo es justo lo que se siente como "se tilda". El arreglo: durante
// el pellizco solo se actualiza el <canvas> (barato, es solo CSS) y se junta con
// requestAnimationFrame; el repintado completo de manijas/badges/etiquetas/pines se hace una sola
// vez, al soltar los dedos.
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
    // Un plano con MUCHAS etiquetas -- así se nota de verdad el costo de recrearlas todas de cero.
    const textos = [];
    for(let i=0;i<120;i++){
      textos.push({ x: (i%20)*90+50, y: Math.floor(i/20)*80+50, tipo:"numero", valor:"1x1", unidad:"m", cantidad:1, categoria:"Ventana", codigo:"V"+i, estado:"pendiente" });
    }
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([plano]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${plano.id}`, imgFalsa(), true);
    await window.storage.set(`plano_avance_textos_VARELA_${plano.id}`, JSON.stringify(textos), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1", true);
    await new Promise(r=>setTimeout(r, 300));
    entrarAEditarPlano();
    await new Promise(r=>setTimeout(r, 200));
  });

  // ---- 1) Durante el pellizco, las funciones caras de overlay NO se llaman en cada toque ----
  const resultado = await page.evaluate(async () => {
    let llamadas = 0;
    const original = renderAnotacionesTocables;
    renderAnotacionesTocables = function(){ llamadas++; return original.apply(this, arguments); };

    const canvas = document.getElementById("canvas-plano");
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + 100, cy = rect.top + 100;

    const fakeTouch = (id, x, y) => ({ identifier: id, clientX: x, clientY: y, target: canvas });
    const dispatch = (type, touches) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      ev.touches = touches; ev.changedTouches = touches; ev.targetTouches = touches;
      canvas.dispatchEvent(ev);
    };
    // Arranca el pellizco (esto SÍ hace un repintado inicial normal, al cancelar cualquier punto a
    // medio colocar -- no es parte de lo que se está probando) y recién después se pone el contador
    // en cero, justo antes de la tanda de touchmove que es la que importa.
    dispatch("touchstart", [fakeTouch(0, cx-10, cy), fakeTouch(1, cx+10, cy)]);
    await new Promise(r=>setTimeout(r, 20));
    llamadas = 0;

    // Simula el pellizco: dos "dedos" que se van separando en varios pasos, como haría un dedo
    // real moviéndose -- varios touchmove antes de soltar.
    for(let i=1;i<=15;i++){
      dispatch("touchmove", [fakeTouch(0, cx-10-i*3, cy), fakeTouch(1, cx+10+i*3, cy)]);
    }
    // Deja que corran los requestAnimationFrame pendientes antes de soltar.
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const llamadasAntesDeSoltar = llamadas;
    dispatch("touchend", []);
    await new Promise(r=>setTimeout(r, 50));
    const llamadasTrasSoltar = llamadas;

    renderAnotacionesTocables = original;
    return { llamadasAntesDeSoltar, llamadasTrasSoltar, zoomFinal: zoomActual };
  });

  if (resultado.llamadasAntesDeSoltar > 0) {
    throw new Error("BUG: renderAnotacionesTocables() se llamó " + resultado.llamadasAntesDeSoltar + " veces DURANTE el pellizco -- debería esperar a que se suelten los dedos.");
  }
  if (resultado.llamadasTrasSoltar !== 1) {
    throw new Error("BUG: al soltar los dedos debería haber exactamente 1 repintado completo de las etiquetas, hubo " + resultado.llamadasTrasSoltar);
  }

  // ---- 2) El zoom final y el paneo siguen funcionando bien (no se rompió la matemática del pellizco) ----
  if (Math.abs(resultado.zoomFinal - 1) < 0.05) {
    throw new Error("El zoom debería haber cambiado con el pellizco (quedó prácticamente en 100%): " + resultado.zoomFinal);
  }

  // ---- 3) Las etiquetas quedan tocables de nuevo después del pellizco (el DOM se reconstruyó bien) ----
  const etiquetasTocables = await page.evaluate(() => document.querySelectorAll("#capa-anotaciones .badge-anotacion-tocable").length);
  if (etiquetasTocables !== 120) throw new Error("Después del pellizco deberían seguir las 120 etiquetas tocables: " + etiquetasTocables);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-pinch-zoom-performance");
})().catch((e) => { console.error(e); process.exit(1); });
