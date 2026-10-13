// El usuario recordaba haber pedido un "seleccionar similares" en el Plano de avance pero no lo
// encontraba buscando en "Comandos" -- existía (🎯 Categoría, seleccionar todas las etiquetas de
// una misma categoría de una sola vez), pero SOLO como botón dentro de la barra de selección
// múltiple (había que entrar primero a "Revisar"), nunca como entrada de la Paleta de Comandos.
// Además, una vez que lo encontró, reportó que el botón "no sale": la barra de selección múltiple
// (#barra-seleccion-multiple) tiene 6 botones + texto en una sola fila sin wrap ni scroll, así que
// en una pantalla angosta de celular simplemente no entra y los botones de las puntas quedan
// fuera de la pantalla (centrada con transform:translateX(-50%), sin overflow-x).
// Este test prueba las dos correcciones: 1) nuevo comando "Seleccionar por categoría" en la
// Paleta, que prende el modo de selección solo si hace falta; 2) la barra ahora tiene
// overflow-x:auto + max-width, así que TODOS sus botones (incluido 🎯 Categoría) quedan dentro
// del ancho visible de la pantalla, sin importar cuántos haya.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // ancho típico de celular, el mismo del reporte
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
    // 3 ventanas ya cargadas de antes, como las que el usuario quiere elegir todas juntas.
    await window.storage.set(`plano_avance_textos_VARELA_${plano.id}`, JSON.stringify([
      { x: 100, y: 100, tipo: "numero", valor: "1x1", unidad: "m", cantidad: 1, categoria: "Ventana", codigo: "V1", estado: "pendiente" },
      { x: 200, y: 100, tipo: "numero", valor: "1x1", unidad: "m", cantidad: 1, categoria: "Ventana", codigo: "V2", estado: "pendiente" },
      { x: 300, y: 100, tipo: "numero", valor: "1x1", unidad: "m", cantidad: 1, categoria: "Puerta", codigo: "P1", estado: "pendiente" },
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1");
    await new Promise(r=>setTimeout(r, 300));
    entrarAEditarPlano(); // la barra de selección múltiple vive en el editor completo, no en "Vista rápida"
    await new Promise(r=>setTimeout(r, 200));
  });

  // ---- 1) El comando aparece en la Paleta de Comandos buscando "categoria" ----
  const r1 = await page.evaluate(() => {
    abrirPaletaComandos();
    document.getElementById("input-paleta-comandos").value = "categoria";
    renderResultadosPaleta();
    const encontrados = filtrarComandosPaleta();
    return { nombres: encontrados.map(c => c.n), cantidad: encontrados.length };
  });

  // ---- 2) Ejecutarlo prende el modo selección y abre el selector de categorías, SIN pasar antes por "Revisar" ----
  const r2 = await page.evaluate(() => {
    const antes = modoSeleccionMultiple;
    comandoSeleccionarPorCategoria();
    return {
      antes,
      modoQuedoActivo: modoSeleccionMultiple,
      seAbrioElSelector: document.getElementById("foto-avance-overlay").style.display === "flex" && document.getElementById("foto-avance-cuerpo").innerHTML.includes("Seleccionar por categoría"),
    };
  });

  // ---- 3) Elegir "Ventana" selecciona las 2 etiquetas de esa categoría (no la de Puerta) ----
  const r3 = await page.evaluate(() => {
    seleccionarPorCategoria("Ventana");
    return {
      cantidadSeleccionada: anotacionesSeleccionadas.size,
      codigosSeleccionados: [...anotacionesSeleccionadas].map(i => anotacionesTexto[i].codigo).sort(),
    };
  });

  // ---- 4) La barra de selección múltiple ahora permite scroll horizontal (no corta botones) ----
  const r4 = await page.evaluate(() => {
    const barra = document.getElementById("barra-seleccion-multiple");
    const estilo = getComputedStyle(barra);
    return {
      overflowX: estilo.overflowX,
      tieneMaxWidth: barra.getBoundingClientRect().width <= window.innerWidth,
      scrollWidthMayorQueClientWidth: barra.scrollWidth > barra.clientWidth, // confirma que SÍ hay contenido de sobra (si no, el fix no se estaría probando de verdad)
    };
  });

  // ---- 5) Scrolleando la barra, el botón "🎯 Categoría" entra en la pantalla visible (no queda recortado) ----
  const r5 = await page.evaluate(() => {
    const barra = document.getElementById("barra-seleccion-multiple");
    const btnCategoria = [...barra.querySelectorAll("button")].find(b => b.textContent.includes("Categoría"));
    if (!btnCategoria) return { existe: false };
    btnCategoria.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = btnCategoria.getBoundingClientRect();
    return { existe: true, dentroDePantalla: r.left >= 0 && r.right <= window.innerWidth };
  });

  // ---- 6) En Plano Maestro, el comando NO aparece (no hay etiquetas de categoría ahí) ----
  const r6 = await page.evaluate(() => {
    modoPlanoMaestro = true;
    const nombres = comandosDisponibles().map(c => c.n);
    modoPlanoMaestro = false;
    return { apareceEnMaestro: nombres.includes("Seleccionar por categoría") };
  });

  console.log("Resultado:", JSON.stringify({ r1, r2, r3, r4, r5, r6 }, null, 2));

  const fallas = [];
  if (!r1.nombres.includes("Seleccionar por categoría")) fallas.push(`BUG: buscando "categoria" en Comandos no aparece "Seleccionar por categoría" -- salió: ${JSON.stringify(r1.nombres)}`);

  if (r2.antes) fallas.push("BUG en el test: el modo selección ya estaba activo antes de probar el comando");
  if (!r2.modoQuedoActivo) fallas.push("BUG: ejecutar el comando desde la Paleta no prendió el modo de selección múltiple");
  if (!r2.seAbrioElSelector) fallas.push("BUG: ejecutar el comando no abrió el cuadro de \"Seleccionar por categoría\"");

  if (r3.cantidadSeleccionada !== 2) fallas.push(`BUG: elegir "Ventana" debería seleccionar 2 etiquetas, seleccionó ${r3.cantidadSeleccionada}`);
  if (JSON.stringify(r3.codigosSeleccionados) !== JSON.stringify(["V1", "V2"])) fallas.push(`BUG: se seleccionaron códigos equivocados: ${JSON.stringify(r3.codigosSeleccionados)}`);

  if (r4.overflowX !== "auto") fallas.push(`BUG: #barra-seleccion-multiple debería tener overflow-x:auto, tiene "${r4.overflowX}"`);
  if (!r4.tieneMaxWidth) fallas.push("BUG: la barra de selección múltiple es más ancha que la pantalla -- sigue sin entrar");
  if (!r4.scrollWidthMayorQueClientWidth) fallas.push("BUG EN EL TEST: la barra no tiene contenido de sobra en este viewport -- el chequeo de scroll no prueba nada real");

  if (!r5.existe) fallas.push("BUG: no se encontró el botón \"🎯 Categoría\" dentro de la barra de selección múltiple");
  else if (!r5.dentroDePantalla) fallas.push("BUG: el botón \"🎯 Categoría\" sigue quedando fuera del área visible de la pantalla aun después de hacer scroll");

  if (r6.apareceEnMaestro) fallas.push("BUG: \"Seleccionar por categoría\" aparece también en Plano Maestro, donde no hay etiquetas de categoría (solo pines)");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL COMANDO \"SELECCIONAR POR CATEGORÍA\" OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
