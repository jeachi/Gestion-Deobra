// Dos problemas reales reportados por el usuario sobre el Plano de avance, después de haber
// agregado "Seleccionar por categoría" a la Paleta de Comandos (ver PR #129):
//
// 1) "Pulso seleccionar o revisar y no aparece la barra con categoría" -- el botón del riel
//    "REVISAR" abre un cajón (#drawer-revisar) que solo tenía herramientas para seleccionar
//    PIEZAS (Recuadro/Forma libre/Interferencias). La selección de ETIQUETAS por categoría vivía
//    escondida en otro cajón totalmente distinto llamado "ETIQUETAS" -- incluso el propio botón
//    ahí adentro se llamaba igual ("Revisar"), lo que hacía al usuario buscar en el lugar
//    equivocado. Se agrega el mismo acceso también dentro de "REVISAR", que es donde cualquiera
//    lo va a buscar primero.
//
// 2) "Para editar el estado de una etiqueta... con pulsarla ya se me abre... se activa y se
//    modifica un estado porque es muy rápida la acción" -- un toque simple sobre una etiqueta ya
//    puesta abría directo el editor de estado y lo dejaba a un toque de cambiarse sin querer
//    (por ejemplo al rozarla leyendo el plano). Ahora hace falta DOBLE toque, mismo criterio
//    (400ms) que ya usa detectarDobleTapEnArea() para las piezas del plano.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => d.accept());

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
    await window.storage.set(`plano_avance_textos_VARELA_${plano.id}`, JSON.stringify([
      { x: 150, y: 150, tipo: "numero", valor: "1x1", unidad: "m", cantidad: 1, categoria: "Ventana", codigo: "V1", estado: "pendiente" },
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1");
    await new Promise(r=>setTimeout(r, 300));
    entrarAEditarPlano();
    await new Promise(r=>setTimeout(r, 200));
  });

  // ---- 1) El cajón "REVISAR" ahora tiene una forma de seleccionar ETIQUETAS, no solo piezas ----
  const r1 = await page.evaluate(() => {
    toggleDrawerHerramientas("revisar");
    const drawer = document.getElementById("drawer-revisar");
    const visible = drawer.style.display !== "none";
    const botones = [...drawer.querySelectorAll(".tool-card")].map(b => b.querySelector(".lbl").textContent);
    return { visible, botones };
  });

  // ---- 2) Tocarlo prende el modo selección (la "barra con categoría") sin pasar por otro cajón ----
  const r2 = await page.evaluate(() => {
    const drawer = document.getElementById("drawer-revisar");
    const btnEtiquetas = [...drawer.querySelectorAll(".tool-card")].find(b => b.querySelector(".lbl").textContent === "Etiquetas");
    btnEtiquetas.click();
    return {
      modoActivo: modoSeleccionMultiple,
      barraVisible: document.getElementById("barra-seleccion-multiple").style.display === "flex",
    };
  });
  await page.evaluate(() => salirModoSeleccionMultiple());

  function tocarEtiqueta() {
    return page.evaluate(() => {
      const btn = document.querySelector(".badge-anotacion-tocable");
      const r = btn.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      btn.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }));
      btn.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y, bubbles: true }));
    });
  }

  // ---- 3) UN solo toque NO abre el editor de estado ----
  const r3 = await page.evaluate(() => document.getElementById("foto-avance-overlay").style.display);
  await tocarEtiqueta();
  const r3b = await page.evaluate(() => document.getElementById("foto-avance-overlay").style.display);

  // ---- 4) El SEGUNDO toque, rápido (dentro de los 400ms), SÍ abre el editor ----
  await tocarEtiqueta();
  const r4 = await page.evaluate(() => ({
    overlayAbierto: document.getElementById("foto-avance-overlay").style.display === "flex",
    muestraElCodigo: document.getElementById("foto-avance-cuerpo").innerHTML.includes("V1"),
  }));
  // cerrarFotoAvanceOverlay() ignora a propósito los cierres dentro de los primeros 350ms de
  // abierto (así el mismo gesto que lo abre no lo cierra de rebote) -- hay que esperar ese margen.
  await page.waitForTimeout(400);
  await page.evaluate(() => cerrarFotoAvanceOverlay());

  // ---- 5) Dos toques separados por MÁS de 400ms NO cuentan como doble toque ----
  await tocarEtiqueta();
  await page.waitForTimeout(500);
  await tocarEtiqueta();
  const r5 = await page.evaluate(() => document.getElementById("foto-avance-overlay").style.display);

  console.log("Resultado:", JSON.stringify({ r1, r2, r3, r3b, r4, r5 }, null, 2));

  const fallas = [];
  if (!r1.visible) fallas.push("BUG: el cajón REVISAR no se abrió");
  if (!r1.botones.includes("Etiquetas")) fallas.push(`BUG: el cajón REVISAR no tiene una opción para seleccionar etiquetas -- botones: ${JSON.stringify(r1.botones)}`);

  if (!r2.modoActivo) fallas.push("BUG: tocar \"Etiquetas\" dentro de REVISAR no prendió el modo de selección múltiple");
  if (!r2.barraVisible) fallas.push("BUG: tocar \"Etiquetas\" dentro de REVISAR no mostró la barra de selección (con el botón de categoría)");

  if (r3 !== "none") fallas.push("BUG EN EL TEST: el editor ya estaba abierto antes de tocar nada");
  if (r3b === "flex") fallas.push("BUG: un solo toque sobre la etiqueta abrió el editor de estado -- debería hacer falta doble toque");

  if (!r4.overlayAbierto) fallas.push("BUG: el segundo toque rápido (doble toque) no abrió el editor de estado");
  if (!r4.muestraElCodigo) fallas.push("BUG: el editor que se abrió no corresponde a la etiqueta V1");

  if (r5 === "flex") fallas.push("BUG: dos toques separados por más de 400ms se contaron como doble toque y abrieron el editor igual");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE \"REVISAR\" Y DOBLE TOQUE EN ETIQUETAS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
