// Tres pedidos del usuario sobre el Plano Maestro:
// 1) "Cuando arrastró para mover un pin no se mueve" -- .pin-maestro-tocable usaba
//    touch-action:manipulation, que deja que el navegador tome el gesto como scroll/pan nativo
//    del plano antes de que el JS de arrastre (iniciarArrastrePin) pueda tomar control. Se
//    corrige a touch-action:none, igual que ya usan las etiquetas (que sí arrastran bien).
// 2) "quisiera que indicará que acción realiza el botón" (copiar pin / 🎯 diana) -- antes solo
//    tenían un title (invisible en touch). Ahora, mantener presionado los muestra como toast,
//    reusando el mismo mecanismo que ya existe para los botones de herramienta (.tool-card).
// 3) "un botón que al seleccionar varios pins me permite alinearlos" -- nuevo botón "📐 Alinear"
//    en la barra de selección (Recuadro/Forma libre) que deja a los pines elegidos en la misma
//    fila o columna, tomando el promedio de sus posiciones actuales.
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
    const planoM = { id:"plM", nombre:"Maestro", tipo:"maestro", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([planoM]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoM.id}`, imgFalsa(), true);
    await window.storage.set(`plano_maestro_pines_VARELA_${planoM.id}`, JSON.stringify([
      { id:"p1", x:100, y:50, nombre:"Dorm 1", checklist:[], capasVinculadas:[] },
      { id:"p2", x:300, y:90, nombre:"Dorm 2", checklist:[], capasVinculadas:[] },
      { id:"p3", x:500, y:70, nombre:"Dorm 3", checklist:[], capasVinculadas:[] },
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("plM", true);
    await new Promise(r=>setTimeout(r, 300));
  });

  // ---- 1) Fix: el pin usa touch-action:none (antes "manipulation" dejaba scrollear en vez de mover) ----
  const touchAction = await page.evaluate(() => {
    const div = document.querySelector('.pin-maestro-tocable[data-pin-id="p1"]');
    return getComputedStyle(div).touchAction;
  });
  if (touchAction !== "none") throw new Error("El pin debería tener touch-action:none para poder arrastrarse: " + touchAction);

  // ---- 2) Mantener presionado el botón "Copiar pin" muestra qué hace (su title, como toast) ----
  await page.evaluate(() => abrirPanelPinMaestro("p1"));
  const tituloBoton = await page.evaluate(() => document.querySelector('.btn-pin-accion[onclick="iniciarCopiarPin()"]').getAttribute("title"));
  await page.evaluate(() => {
    const btn = document.querySelector('.btn-pin-accion[onclick="iniciarCopiarPin()"]');
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await page.waitForTimeout(700); // bien por encima del umbral de 600ms (antes 450ms) para no ser flaky
  const textoToast = await page.evaluate(() => document.getElementById("toast").textContent);
  await page.evaluate(() => {
    document.querySelector('.btn-pin-accion[onclick="iniciarCopiarPin()"]').dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
  });
  if (textoToast !== tituloBoton) throw new Error(`Mantener presionado 'Copiar pin' debería mostrar su title ("${tituloBoton}") como toast, mostró: "${textoToast}"`);

  // ---- 3) Alinear varios pines seleccionados ----
  await page.evaluate(() => cerrarPanelPinMaestro());
  const estadoBarra = await page.evaluate(() => {
    seleccionAreaResultado = ["p1", "p2", "p3"];
    mostrarBarraSeleccionArea();
    return {
      display: document.getElementById("barra-seleccion-area").style.display,
      btnAlinearVisible: document.getElementById("btn-alinear-seleccion").style.display !== "none",
    };
  });
  if (estadoBarra.display !== "flex" || !estadoBarra.btnAlinearVisible) {
    throw new Error("Con 3 pines seleccionados en el Maestro debería verse la barra y el botón 'Alinear': " + JSON.stringify(estadoBarra));
  }

  const textoSelector = await page.evaluate(() => {
    abrirAlinearPinesSeleccionados();
    return document.getElementById("foto-avance-cuerpo").textContent;
  });
  if (!textoSelector.includes("3 pines")) throw new Error("El selector de alinear no menciona los 3 pines elegidos: " + textoSelector);

  const trasAlinearHorizontal = await page.evaluate(async () => {
    await confirmarAlinearPinesSeleccionados("horizontal");
    return pinesMaestro.map(p => ({ id: p.id, x: p.x, y: p.y }));
  });
  const ys = trasAlinearHorizontal.map(p => p.y);
  if (!ys.every(y => y === ys[0])) throw new Error("Alinear horizontal debería dejar a los 3 pines con la misma Y: " + JSON.stringify(trasAlinearHorizontal));
  // Promedio de 50, 90, 70 = 70 -- y las X no deberían haber cambiado.
  if (ys[0] !== 70) throw new Error("La Y promedio esperada era 70: " + JSON.stringify(trasAlinearHorizontal));
  const xsSinCambios = trasAlinearHorizontal.every((p, i) => p.x === [100, 300, 500][i]);
  if (!xsSinCambios) throw new Error("Alinear horizontal no debería tocar la X de los pines: " + JSON.stringify(trasAlinearHorizontal));

  // La selección se limpia y queda persistido.
  const trasLimpiar = await page.evaluate(() => ({
    seleccion: seleccionAreaResultado.length,
    barraOculta: document.getElementById("barra-seleccion-area").style.display === "none",
  }));
  if (trasLimpiar.seleccion !== 0 || !trasLimpiar.barraOculta) throw new Error("Tras alinear debería limpiarse la selección y cerrarse la barra: " + JSON.stringify(trasLimpiar));
  const persistido = await page.evaluate(async () => {
    const r = await window.storage.get("plano_maestro_pines_VARELA_plM", true);
    return JSON.parse(r.value).map(p => p.y);
  });
  if (!persistido.every(y => y === 70)) throw new Error("El alineado no se persistió en storage: " + JSON.stringify(persistido));

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-maestro-arrastre-ayuda-alinear");
})().catch((e) => { console.error(e); process.exit(1); });
