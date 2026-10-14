// Tres pedidos del usuario sobre gestión de planos (Maestro y de avance):
// 1) "quiero poder cambiar el nombre de los planos tanto maestro como de avance porque al crear
//    copia no me permite cambiar el nombre" -- el botón "🏷️ Renombrar" explícito solo se mostraba
//    en las tarjetas de Plano Maestro; un plano de avance (incluida una copia recién creada) solo
//    tenía el gesto oculto de "mantener presionado", nada visible.
// 2) "si copio un plano también se guarde la escala porque como está no la guarda" -- duplicarPlano
//    copiaba imagen+polígonos+textos, pero no la calibración de escala ni ejes/formas/cotas.
// 3) "en la ventana de previsualización no se ven las etiquetas o lo dibujado, solo se ve la
//    imagen del plano" -- generarImagenSnapshotIndividual (la usan Vista rápida y "Compartir
//    avance") nunca dibujaba anotacionesTexto ni formasPlano, solo polígonos y líneas de avance.
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

  await page.evaluate(() => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    irA("planoavance");
  });

  // ---- 1) El botón "Renombrar" ahora aparece también en una tarjeta de plano de AVANCE ----
  const renombrar = await page.evaluate(() => {
    planosIndex = [
      { id: "av1", nombre: "Planta baja", fecha: "2026-01-01", contratistaId: null, contratistaNombre: null, tipo: undefined, miniatura: null },
      { id: "ma1", nombre: "Maestro Obra", fecha: "2026-01-01", contratistaId: null, contratistaNombre: null, tipo: "maestro", miniatura: null },
    ];
    renderSelectorPlanos();
    const cardAvance = document.querySelector('.plano-card[data-plano-id="av1"]');
    const cardMaestro = document.querySelector('.plano-card[data-plano-id="ma1"]');
    const tieneRenombrarAvance = [...cardAvance.querySelectorAll(".mini-accion-plano")].some(b => b.textContent.includes("Renombrar"));
    const tieneVincularAvance = [...cardAvance.querySelectorAll(".mini-accion-plano")].some(b => b.textContent.includes("Vincular"));
    const tieneRenombrarMaestro = [...cardMaestro.querySelectorAll(".mini-accion-plano")].some(b => b.textContent.includes("Renombrar"));
    return { tieneRenombrarAvance, tieneVincularAvance, tieneRenombrarMaestro };
  });
  if (!renombrar.tieneRenombrarAvance) throw new Error("La tarjeta de un plano de avance debería tener el botón 'Renombrar' visible");
  if (!renombrar.tieneVincularAvance) throw new Error("La tarjeta de avance no debería perder el botón 'Vincular' al agregar 'Renombrar'");
  if (!renombrar.tieneRenombrarMaestro) throw new Error("La tarjeta de un Plano Maestro debería seguir teniendo 'Renombrar' (no se rompió lo que ya andaba)");

  // ---- 2) duplicarPlano() ahora copia también la escala calibrada (y ejes/formas/cotas) ----
  const duplicado = await page.evaluate(async () => {
    const obra = "ObraTest";
    claveObraPlanoAvance = () => obra;
    const idOriginal = "planoConEscala";
    planosIndex = [{ id: idOriginal, nombre: "Con escala", fecha: "2026-01-01", contratistaId: null, contratistaNombre: null, tipo: undefined, miniatura: null }];
    await window.storage.set(`plano_avance_imagen_${obra}_${idOriginal}`, "data:image/png;base64,xxx", true);
    await window.storage.set(`plano_avance_poligonos_${obra}_${idOriginal}`, JSON.stringify([]), true);
    await window.storage.set(`plano_avance_calibracion_${obra}_${idOriginal}`, JSON.stringify({ metrosPorPixel: 0.0123 }), true);
    await window.storage.set(`plano_avance_ejes_${obra}_${idOriginal}`, JSON.stringify([{ orientacion: "h", pos: 50 }]), true);
    await window.storage.set(`plano_avance_formas_${obra}_${idOriginal}`, JSON.stringify([{ id: "f1", tipo: "linea", x1: 0, y1: 0, x2: 10, y2: 10, color: "#3B82F6" }]), true);
    await window.storage.set(`plano_avance_cotas_${obra}_${idOriginal}`, JSON.stringify([{ id: "c1", puntos: [[0, 0], [10, 0]], totalPx: 10 }]), true);

    await duplicarPlano(idOriginal);
    const copia = planosIndex.find(p => p.id !== idOriginal);

    const rCalib = copia ? await window.storage.get(`plano_avance_calibracion_${obra}_${copia.id}`, true) : null;
    const rEjes = copia ? await window.storage.get(`plano_avance_ejes_${obra}_${copia.id}`, true) : null;
    const rFormas = copia ? await window.storage.get(`plano_avance_formas_${obra}_${copia.id}`, true) : null;
    const rCotas = copia ? await window.storage.get(`plano_avance_cotas_${obra}_${copia.id}`, true) : null;
    return {
      copioEscala: !!(rCalib && rCalib.value && JSON.parse(rCalib.value).metrosPorPixel === 0.0123),
      copioEjes: !!(rEjes && rEjes.value && JSON.parse(rEjes.value).length === 1),
      copioFormas: !!(rFormas && rFormas.value && JSON.parse(rFormas.value).length === 1),
      copioCotas: !!(rCotas && rCotas.value && JSON.parse(rCotas.value).length === 1),
    };
  });
  if (!duplicado.copioEscala) throw new Error("duplicarPlano no copió la escala calibrada del original");
  if (!duplicado.copioEjes) throw new Error("duplicarPlano no copió los ejes (líneas de referencia) del original");
  if (!duplicado.copioFormas) throw new Error("duplicarPlano no copió las formas dibujadas (línea/flecha/círculo) del original");
  if (!duplicado.copioCotas) throw new Error("duplicarPlano no copió las cotas del original");

  // ---- 3) generarImagenSnapshotIndividual(null) ahora dibuja etiquetas y formas libres ----
  const vistaPrevia = await page.evaluate(async () => {
    function crearImg(w, h, color) {
      return new Promise((resolve) => {
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const cx = c.getContext("2d"); cx.fillStyle = color; cx.fillRect(0, 0, w, h);
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = c.toDataURL();
      });
    }
    imagenPlano = await crearImg(400, 300, "#dddddd");
    modoPlanoMaestro = false;
    poligonos = [];
    lineasAvance = [];
    estadosPersonalizados = [{ id: "pendiente", nombre: "Pendiente", icono: "", color: "#9CA3AF" }];

    anotacionesTexto = [];
    formasPlano = [];
    const sinNada = generarImagenSnapshotIndividual(null);

    anotacionesTexto = [{ x: 100, y: 100, valor: "1.20", tipo: "numero", unidad: "m", categoria: "", codigo: "", estado: "pendiente" }];
    const conEtiqueta = generarImagenSnapshotIndividual(null);

    formasPlano = [{ id: "f1", tipo: "linea", x1: 10, y1: 10, x2: 200, y2: 200, color: "#3B82F6" }];
    const conFormaTambien = generarImagenSnapshotIndividual(null);

    // Un Plano Maestro no tiene estos datos -- aunque queden sobras en memoria del último plano
    // de avance abierto, no deberían dibujarse (el resultado tiene que ser idéntico a "sinNada").
    modoPlanoMaestro = true;
    const comoMaestro = generarImagenSnapshotIndividual(null);
    modoPlanoMaestro = false;

    // Un snapshot histórico tampoco guardó etiquetas/formas en su momento -- mismo criterio.
    const comoSnapshotViejo = generarImagenSnapshotIndividual({ poligonos: [], lineas: [] });

    return { sinNada, conEtiqueta, conFormaTambien, comoMaestro, comoSnapshotViejo };
  });
  if (vistaPrevia.conEtiqueta === vistaPrevia.sinNada) throw new Error("La etiqueta no se dibujó en la previsualización (el resultado es idéntico a sin ninguna etiqueta)");
  if (vistaPrevia.conFormaTambien === vistaPrevia.conEtiqueta) throw new Error("La forma dibujada (línea) no se agregó a la previsualización");
  if (vistaPrevia.comoMaestro !== vistaPrevia.sinNada) throw new Error("Un Plano Maestro no debería dibujar sobras de etiquetas/formas de otro plano");
  if (vistaPrevia.comoSnapshotViejo !== vistaPrevia.sinNada) throw new Error("Un snapshot histórico no debería dibujar las etiquetas/formas ACTUALES");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-renombrar-duplicar-vistarapida");
})().catch((e) => { console.error(e); process.exit(1); });
