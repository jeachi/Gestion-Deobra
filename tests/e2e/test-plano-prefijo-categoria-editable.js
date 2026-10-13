// Pedido del usuario: en "Plano de avance -> Etiqueta -> Texto", al elegir una categoría
// (Ventana, Puerta, Portón, Reja, o una propia) la app le pone un código automático (V1, P1...)
// con un prefijo FIJO que antes no se podía cambiar. El usuario quería poder reemplazar ese
// prefijo por el que usa en su proyecto real (ej: "VEA" en vez de "V" para Ventana), sin perder
// la numeración automática ni romper los códigos ya puestos.
// Se agregó un engranaje (⚙️) al lado de "Categoría" que abre un cuadrito para cambiar el
// prefijo de la categoría elegida, guardado por plano (mismo criterio que estadosPersonalizados).
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
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1");
    await new Promise(r=>setTimeout(r, 300));
  });

  function elegirCategoria(nombre) {
    return page.evaluate((nombre) => {
      document.querySelector(`#prompt-texto-plano-categoria .chip-opt[data-val="${nombre}"]`).click();
    }, nombre);
  }

  async function crearEtiquetaVentana(valor) {
    await page.evaluate(() => abrirPromptTextoPlano(null));
    await elegirCategoria("Ventana");
    await page.fill("#prompt-texto-plano-input", valor);
    await page.evaluate(() => confirmarPromptTextoPlano());
    await page.waitForTimeout(80);
  }

  // ---- 1) Sin tocar nada, el prefijo por defecto de Ventana sigue siendo "V" ----
  await crearEtiquetaVentana("1.20 x 1.00");
  const codigo1 = await page.evaluate(() => anotacionesTexto[anotacionesTexto.length - 1].codigo);

  // ---- 2) Cambiar el prefijo de Ventana a "VEA" desde el engranaje ----
  await page.evaluate(() => abrirPromptTextoPlano(null));
  await elegirCategoria("Ventana");
  const prefijoPrecargado = await page.evaluate(() => {
    abrirPrefijoCategoriaActual();
    return document.getElementById("prompt-prefijo-categoria-input").value;
  });
  await page.fill("#prompt-prefijo-categoria-input", "VEA");
  await page.evaluate(() => confirmarPromptPrefijoCategoria());
  await page.waitForTimeout(80);
  await page.evaluate(() => cerrarPromptTextoPlano());

  // ---- 3) La próxima etiqueta de Ventana usa el prefijo nuevo, PERO sigue la numeración (no vuelve a 1) ----
  await crearEtiquetaVentana("0.80 x 1.20");
  const codigo2 = await page.evaluate(() => anotacionesTexto[anotacionesTexto.length - 1].codigo);

  // ---- 4) La etiqueta vieja (V1) no se tocó ----
  const codigo1DespuesDelCambio = await page.evaluate(() => anotacionesTexto[0].codigo);

  // ---- 5) Se guardó persistido por plano ----
  const guardado = await page.evaluate(async () => {
    const r = await window.storage.get("plano_avance_prefijos_categoria_VARELA_pl1", true);
    return r && r.value ? JSON.parse(r.value) : null;
  });

  // ---- 6) Sin categoría elegida, el engranaje avisa en vez de abrir el cuadro vacío ----
  const sinCategoriaAvisa = await page.evaluate(() => {
    abrirPromptTextoPlano(null);
    document.querySelector('#prompt-texto-plano-categoria .chip-opt[data-val=""]').click();
    let huboAviso = false;
    const original = showToast;
    showToast = (msg) => { huboAviso = true; original(msg); };
    abrirPrefijoCategoriaActual();
    const seAbrio = document.getElementById("prompt-prefijo-categoria-overlay").style.display === "flex";
    showToast = original;
    cerrarPromptTextoPlano();
    return { huboAviso, seAbrio };
  });

  console.log("Resultado:", JSON.stringify({ codigo1, prefijoPrecargado, codigo2, codigo1DespuesDelCambio, guardado, sinCategoriaAvisa }, null, 2));

  const fallas = [];
  if (codigo1 !== "V1") fallas.push(`BUG: el primer código de Ventana debería ser "V1", dio "${codigo1}"`);
  if (prefijoPrecargado !== "V") fallas.push(`BUG: el cuadro de prefijo debería precargar "V" (el prefijo actual de Ventana), precargó "${prefijoPrecargado}"`);
  if (codigo2 !== "VEA2") fallas.push(`BUG: tras cambiar el prefijo a VEA, la próxima etiqueta debería ser "VEA2" (sigue la cuenta, no reinicia), dio "${codigo2}"`);
  if (codigo1DespuesDelCambio !== "V1") fallas.push(`BUG: cambiar el prefijo tocó una etiqueta ya puesta -- debería seguir siendo "V1", quedó "${codigo1DespuesDelCambio}"`);
  if (!guardado || guardado.Ventana !== "VEA") fallas.push(`BUG: el prefijo no quedó guardado en storage por plano: ${JSON.stringify(guardado)}`);
  if (!sinCategoriaAvisa.huboAviso) fallas.push("BUG: sin categoría elegida, el engranaje debería avisar que hay que elegir una categoría primero");
  if (sinCategoriaAvisa.seAbrio) fallas.push("BUG: sin categoría elegida, el cuadro de prefijo no debería abrirse");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL PREFIJO EDITABLE DE CATEGORÍA OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
