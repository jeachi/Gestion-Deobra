// Dos pedidos del usuario sobre Plano Maestro + Plano de avance:
// 1) "Si agrego pins en un plano maestro de áreas y luego coloco una etiqueta de ventanas en una
//    aula [...] puede cargar el nombre del área del plano maestro" -- el formulario de etiqueta
//    ahora tiene un selector 📍 que lista los pines de los Planos Maestro de la obra; elegir uno
//    completa "Ubicación" con su nombre y registra el vínculo pin↔categoría para este plano (el
//    mismo dato que ya usaba "Vincular" del lado del pin, completado ahora desde el otro lado).
//    De paso, esto expuso un bug real: conTodosLosPinesMaestro() filtraba por "p.obra===obra",
//    pero planosIndex nunca tiene ese campo (ya está scopeado a una obra por su propia clave de
//    storage) -- la comparación daba siempre false y el barrido de "todos los Maestro" nunca
//    encontraba ninguno. Se verifica acá que ya encuentra el Maestro de prueba.
// 2) "quiero también poder ocultar o apagar capas de etiqueta o pins o áreas [...] un bombillo
//    estilo autocad" -- se agregan 👁/🚫 para categorías de etiquetas (en el panel "Capas" del
//    plano de avance) y para pines individuales (en "Todos los pines" del Plano Maestro),
//    reusando el mismo criterio que ya existía para las áreas (capasOcultasCad).
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
    const planoMaestro = { id:"maes1", nombre:"Maestro Colegio", tipo:"maestro", fecha:hoyISO() };
    const planoAvance = { id:"pl1", nombre:"Avance Aulas", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([planoMaestro, planoAvance]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoMaestro.id}`, imgFalsa(), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoAvance.id}`, imgFalsa(), true);
    await window.storage.set(`plano_maestro_pines_VARELA_${planoMaestro.id}`, JSON.stringify([
      { id:"pinAula3", x:100, y:100, nombre:"Aula 3", checklist:[], capasVinculadas:[] },
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
  });

  // ---- 1) Fix: conTodosLosPinesMaestro ya encuentra el Maestro (antes el filtro .obra lo perdía) ----
  const fixBarrido = await page.evaluate(async () => {
    const encontrados = [];
    await conTodosLosPinesMaestro("VARELA", (pin) => { encontrados.push(pin.id); return false; });
    return encontrados;
  });
  if (!fixBarrido.includes("pinAula3")) throw new Error("conTodosLosPinesMaestro sigue sin encontrar el pin del Maestro: " + JSON.stringify(fixBarrido));

  // ---- 2) Ocultar/mostrar un pin individual en el Plano Maestro (👁/🚫) ----
  await page.evaluate(async () => { await seleccionarPlano("maes1", true); await new Promise(r=>setTimeout(r, 300)); });
  const antesDeOcultarPin = await page.evaluate(() => document.querySelectorAll(".pin-maestro-tocable").length);
  if (antesDeOcultarPin !== 1) throw new Error("El pin de prueba no se renderizó en el mapa del Maestro: " + antesDeOcultarPin);
  const trasOcultarPin = await page.evaluate(() => {
    toggleOcultarPinCad("pinAula3");
    return { oculto: pinesOcultosCad.has("pinAula3"), enMapa: document.querySelectorAll(".pin-maestro-tocable").length };
  });
  if (!trasOcultarPin.oculto || trasOcultarPin.enMapa !== 0) throw new Error("Ocultar el pin no lo sacó del mapa: " + JSON.stringify(trasOcultarPin));
  const trasMostrarPin = await page.evaluate(() => {
    toggleOcultarPinCad("pinAula3");
    return { oculto: pinesOcultosCad.has("pinAula3"), enMapa: document.querySelectorAll(".pin-maestro-tocable").length };
  });
  if (trasMostrarPin.oculto || trasMostrarPin.enMapa !== 1) throw new Error("Volver a mostrar el pin no lo devolvió al mapa: " + JSON.stringify(trasMostrarPin));

  // ---- 3) Elegir la ubicación de una etiqueta desde un pin del Plano Maestro ----
  await page.evaluate(async () => { await seleccionarPlano("pl1", true); await new Promise(r=>setTimeout(r, 300)); });
  await page.evaluate(() => {
    abrirPromptTextoPlano({ x: 50, y: 50 });
    document.querySelector('#prompt-texto-plano-categoria .chip-opt[data-val="Ventana"]').click();
  });
  const listaSelector = await page.evaluate(async () => {
    await abrirSelectorUbicacionMaestro();
    return document.getElementById("foto-avance-cuerpo").textContent;
  });
  if (!listaSelector.includes("Aula 3")) throw new Error("El selector de ubicación no lista el pin 'Aula 3' del Maestro: " + listaSelector);
  await page.evaluate(() => new Promise(r => setTimeout(r, 400))); // pasa el anti-doble-cierre de 350ms del overlay
  await page.evaluate(async () => { await elegirUbicacionDesdeMaestro("maes1", "pinAula3"); });
  const ubicacionTrasElegir = await page.evaluate(() => document.getElementById("prompt-texto-plano-ubicacion").value);
  if (ubicacionTrasElegir !== "Aula 3") throw new Error("Elegir el pin no completó 'Ubicación' con su nombre: " + ubicacionTrasElegir);

  await page.evaluate(() => {
    document.getElementById("prompt-texto-plano-input").value = "1.20 x 0.80";
  });
  await page.evaluate(() => confirmarPromptTextoPlano());
  const etiquetaGuardada = await page.evaluate(() => anotacionesTexto[0]);
  if (etiquetaGuardada.ubicacion !== "Aula 3" || etiquetaGuardada.categoria !== "Ventana") {
    throw new Error("La etiqueta no quedó guardada con la ubicación/categoría esperadas: " + JSON.stringify(etiquetaGuardada));
  }

  // ---- 4) Elegir el pin también registró el vínculo pin↔categoría (del lado del Maestro) ----
  const vinculo = await page.evaluate(async () => {
    const r = await window.storage.get("plano_maestro_pines_VARELA_maes1", true);
    const pines = JSON.parse(r.value);
    const pin = pines.find(p => p.id === "pinAula3");
    return pin.capasVinculadas || [];
  });
  const tieneVinculo = vinculo.some(v => v.tipo === "anotacion" && v.planoId === "pl1" && v.categoria === "Ventana");
  if (!tieneVinculo) throw new Error("No se registró el vínculo pin↔categoría al elegir la ubicación: " + JSON.stringify(vinculo));

  // ---- 5) Ocultar/mostrar una categoría entera de etiquetas (👁/🚫 en el panel "Capas") ----
  await page.evaluate(() => { cerrarPromptTextoPlano(); redibujar(); });
  const antesDeOcultarCategoria = await page.evaluate(() => document.getElementById("capa-anotaciones").children.length);
  if (antesDeOcultarCategoria !== 1) throw new Error("La etiqueta recién creada no aparece como tocable en el canvas: " + antesDeOcultarCategoria);
  const panelConCategoria = await page.evaluate(() => { renderPanelCapasCad(); return document.getElementById("lista-capas-cad").textContent; });
  if (!panelConCategoria.includes("Ventana")) throw new Error("El panel de Capas no lista la categoría 'Ventana' de etiquetas: " + panelConCategoria);
  const trasOcultarCategoria = await page.evaluate(() => {
    toggleOcultarCategoriaCad("Ventana");
    redibujar();
    return { oculta: categoriasOcultasCad.has("Ventana"), tocables: document.getElementById("capa-anotaciones").children.length };
  });
  if (!trasOcultarCategoria.oculta || trasOcultarCategoria.tocables !== 0) throw new Error("Ocultar la categoría no sacó la etiqueta del canvas: " + JSON.stringify(trasOcultarCategoria));
  const trasMostrarCategoria = await page.evaluate(() => {
    toggleOcultarCategoriaCad("Ventana");
    redibujar();
    return { oculta: categoriasOcultasCad.has("Ventana"), tocables: document.getElementById("capa-anotaciones").children.length };
  });
  if (trasMostrarCategoria.oculta || trasMostrarCategoria.tocables !== 1) throw new Error("Volver a mostrar la categoría no devolvió la etiqueta al canvas: " + JSON.stringify(trasMostrarCategoria));

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-vinculo-maestro-ocultar-capas");
})().catch((e) => { console.error(e); process.exit(1); });
