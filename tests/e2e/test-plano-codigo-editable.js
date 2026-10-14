// Pedido del usuario: "También quisiera poder modificar el correlativo de las etiquetas en los
// planos." El código (V1, P2...) antes se armaba siempre solo a partir de la categoría, sin
// ninguna forma de corregirlo a mano -- si una etiqueta quedaba con el número salteado o
// repetido sin querer, no había cómo arreglarlo salvo borrarla y recrearla. Ahora el formulario
// de la etiqueta tiene un campo "Código" editable (solo visible con categoría elegida): si se
// deja vacío sigue el comportamiento automático de siempre, si se escribe algo se usa tal cual.
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

  // ---- 1) Sin categoría, el campo "Código" no se muestra ----
  const sinCategoria = await page.evaluate(() => {
    abrirPromptTextoPlano({ x: 100, y: 100 });
    return document.getElementById("prompt-texto-plano-codigo-wrap").style.display;
  });
  if (sinCategoria !== "none") throw new Error("El campo Código debería estar oculto sin categoría elegida: " + sinCategoria);

  // ---- 2) Al elegir categoría, aparece y sugiere el próximo automático en el placeholder ----
  const conCategoria = await page.evaluate(() => {
    document.querySelector('#prompt-texto-plano-categoria .chip-opt[data-val="Ventana"]').click();
    return {
      display: document.getElementById("prompt-texto-plano-codigo-wrap").style.display,
      placeholder: document.getElementById("prompt-texto-plano-codigo").placeholder,
    };
  });
  if (conCategoria.display === "none") throw new Error("El campo Código debería mostrarse con categoría 'Ventana' elegida");
  if (!conCategoria.placeholder.includes("V1")) throw new Error("El placeholder debería sugerir 'V1' como primer código: " + conCategoria.placeholder);

  // ---- 3) Dejarlo vacío sigue generando el código automático de siempre ----
  await page.evaluate(() => {
    document.getElementById("prompt-texto-plano-input").value = "1.20 x 0.80";
  });
  await page.evaluate(() => confirmarPromptTextoPlano());
  const primeraEtiqueta = await page.evaluate(() => anotacionesTexto[0]);
  if (primeraEtiqueta.codigo !== "V1") throw new Error("Sin escribir nada, el código automático debería ser V1: " + JSON.stringify(primeraEtiqueta));

  // ---- 4) Editar esa misma etiqueta y escribir un código a mano lo deja tal cual (corrige el correlativo) ----
  await page.evaluate(() => {
    abrirPromptTextoPlano(null, 0);
  });
  const prefillAlEditar = await page.evaluate(() => document.getElementById("prompt-texto-plano-codigo").value);
  if (prefillAlEditar !== "V1") throw new Error("Al editar, el código actual debería estar precargado en el campo: " + prefillAlEditar);
  await page.evaluate(() => {
    document.getElementById("prompt-texto-plano-codigo").value = "V5";
  });
  await page.evaluate(() => confirmarPromptTextoPlano());
  const trasCorregir = await page.evaluate(() => anotacionesTexto[0].codigo);
  if (trasCorregir !== "V5") throw new Error("El código escrito a mano (V5) no se guardó: " + trasCorregir);

  // ---- 5) Persiste de verdad (no es solo un cambio en memoria) ----
  const guardado = await page.evaluate(async () => {
    const r = await window.storage.get("plano_avance_textos_VARELA_pl1", true);
    return JSON.parse(r.value)[0].codigo;
  });
  if (guardado !== "V5") throw new Error("El código corregido no se persistió: " + guardado);

  // ---- 6) Una etiqueta nueva de la misma categoría sigue sugiriendo en base al máximo real (V6, no V2) ----
  const sugeridoLuegoDeCorregir = await page.evaluate(() => {
    abrirPromptTextoPlano({ x: 200, y: 200 });
    document.querySelector('#prompt-texto-plano-categoria .chip-opt[data-val="Ventana"]').click();
    return document.getElementById("prompt-texto-plano-codigo").placeholder;
  });
  if (!sugeridoLuegoDeCorregir.includes("V6")) throw new Error("Tras corregir a V5, la próxima debería sugerir V6: " + sugeridoLuegoDeCorregir);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-codigo-editable");
})().catch((e) => { console.error(e); process.exit(1); });
