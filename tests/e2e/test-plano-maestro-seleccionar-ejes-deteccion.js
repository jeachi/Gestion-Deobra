// Pedido del usuario: "revisa que en el plano maestro no está el botón de alineación ni el de
// selección tampoco están los ejes de referencia en plano maestro" -- y, antes, la pregunta de si
// existe una forma de detectar habitaciones sin que el Maestro esté vinculado a ningún
// contratista ("Si, crealo").
// 1) "Seleccionar" (Recuadro/Forma libre) ahora tiene su propio botón de riel + cajón en el
//    Maestro (antes vivía sin nombre propio, mezclado adentro del cajón genérico "Herramientas"),
//    igual que ya tiene el plano de avance. El botón "📐 Alinear" (de un PR anterior) aparece
//    justo al elegir 2+ pines con Recuadro/Forma libre, así que con "Seleccionar" visible y
//    nombrado, "Alinear" queda alcanzable también.
// 2) Los Ejes (líneas de referencia) no existían para nada en el Maestro: no se cargaban al abrir
//    el plano, no se guardaban, no se dibujaban y no había ningún botón para ponerlos. Ahora el
//    Maestro tiene su propio botón "EJES" en el riel (iniciarOEditarReferencia, la misma función
//    que ya usa el plano de avance) y persisten igual que ahí.
// 3) detectarHabitacionesAutomatico() antes solo funcionaba si había un plano de CONTRATISTA
//    vinculado que comparta la misma imagen -- si no, mostraba un error y no hacía nada más. Ahora,
//    cuando no hay ninguno vinculado, cae automáticamente a detectarHabitacionesPorImagen(): analiza
//    directamente las líneas de la imagen del propio Maestro (mismo motor que ya usa "Contorno
//    interno": mapa de bordes + inundar área libre + trazado de contorno), pero recorriendo TODA
//    la imagen en una grilla en vez de esperar un toque adentro de cada ambiente.
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

    // Imagen 400x300: fondo blanco con UN rectángulo cerrado dibujado con borde negro (una
    // "habitación"), con margen de sobra hasta los bordes de la imagen para que la región de
    // afuera (el fondo) sí toque el borde y quede descartada, y la de adentro no.
    function imgConHabitacion() {
      const c = document.createElement("canvas"); c.width = 400; c.height = 300;
      const cx = c.getContext("2d");
      cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, 400, 300);
      cx.strokeStyle = "#000000"; cx.lineWidth = 6;
      cx.strokeRect(60, 60, 280, 180);
      return c.toDataURL("image/png");
    }
    const img = imgConHabitacion();
    const planoM = { id: "plM", nombre: "Maestro", tipo: "maestro", fecha: hoyISO(), miniatura: img };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([planoM]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoM.id}`, img, true);
    await irA("planoavance");
    await new Promise(r => setTimeout(r, 150));
    await seleccionarPlano("plM", true);
    await new Promise(r => setTimeout(r, 400));
  });

  // ---- 1) El riel del Maestro ahora tiene "SELECCIONAR" y "ALINEAR" (Ejes/Escala/Rejilla) propios ----
  const riel = await page.evaluate(() => {
    const btnSel = document.getElementById("btn-drawer-revisar-maestro");
    const btnAlinear = document.getElementById("btn-drawer-medir-maestro");
    const btnEjes = document.getElementById("btn-colocar-referencia-maestro");
    return {
      existeSeleccionar: !!btnSel,
      lblSeleccionar: btnSel ? btnSel.textContent.trim() : null,
      existeAlinear: !!btnAlinear,
      lblAlinear: btnAlinear ? btnAlinear.textContent.trim() : null,
      existeEjes: !!btnEjes,
    };
  });
  if (!riel.existeSeleccionar) throw new Error("El riel del Plano Maestro debería tener un botón 'Seleccionar' propio");
  if (!riel.lblSeleccionar.includes("SELECCIONAR")) throw new Error("El botón de selección del Maestro debería decir SELECCIONAR: " + riel.lblSeleccionar);
  if (!riel.existeAlinear) throw new Error("El riel del Plano Maestro debería tener un botón 'Alinear' propio");
  if (!riel.lblAlinear.includes("ALINEAR")) throw new Error("El botón de alinear del Maestro debería decir ALINEAR: " + riel.lblAlinear);
  if (!riel.existeEjes) throw new Error("El cajón de Alinear del Maestro debería tener el botón de Ejes adentro");

  // ---- 2) El cajón "Seleccionar" del Maestro tiene Recuadro/Forma libre; "Herramientas" ya no ----
  const cajones = await page.evaluate(() => {
    toggleDrawerHerramientas("revisarMaestro");
    const textoRevisar = document.getElementById("drawer-revisarMaestro").textContent;
    const visibleRevisar = document.getElementById("drawer-revisarMaestro").style.display;
    toggleDrawerHerramientas("herramientasMaestro");
    const textoHerramientas = document.getElementById("drawer-herramientasMaestro").textContent;
    return { textoRevisar, visibleRevisar, textoHerramientas };
  });
  if (cajones.visibleRevisar !== "block") throw new Error("El cajón 'Seleccionar' del Maestro debería abrirse");
  if (!cajones.textoRevisar.includes("Recuadro") || !cajones.textoRevisar.includes("Forma libre")) {
    throw new Error("El cajón 'Seleccionar' del Maestro debería tener Recuadro y Forma libre: " + cajones.textoRevisar);
  }
  if (cajones.textoHerramientas.includes("Recuadro") || cajones.textoHerramientas.includes("Forma libre")) {
    throw new Error("El cajón 'Herramientas' del Maestro ya no debería repetir Recuadro/Forma libre: " + cajones.textoHerramientas);
  }

  // ---- 3) "EJES": primer toque coloca un eje horizontal + uno vertical, y persiste ----
  const tapEjes = await page.evaluate(async () => {
    cerrarFlyoutsAbiertos();
    iniciarOEditarReferencia(); // lineasReferencia.length===0 -> va directo a colocar
    const activoAlEmpezar = modoColocarReferencia && document.getElementById("btn-colocar-referencia-maestro").classList.contains("btn-primary");
    manejarTapColocarReferencia(100, 80);
    await new Promise(r => setTimeout(r, 50));
    const r = await window.storage.get("plano_avance_ejes_VARELA_plM", true);
    return { activoAlEmpezar, cantidad: lineasReferencia.length, persistido: r && r.value ? JSON.parse(r.value).length : 0 };
  });
  if (!tapEjes.activoAlEmpezar) throw new Error("Tocar 'EJES' debería activar modoColocarReferencia y resaltar el botón del Maestro");
  if (tapEjes.cantidad !== 2) throw new Error("Un toque para colocar ejes debería dejar 1 horizontal + 1 vertical: " + tapEjes.cantidad);
  if (tapEjes.persistido !== 2) throw new Error("Los ejes del Maestro deberían quedar guardados en storage: " + tapEjes.persistido);

  // ---- 4) Volver a entrar al mismo Maestro recupera los ejes ya puestos (antes no se cargaban) ----
  const trasRecargar = await page.evaluate(async () => {
    await seleccionarPlano("plM", true);
    await new Promise(r => setTimeout(r, 300));
    return lineasReferencia.length;
  });
  if (trasRecargar !== 2) throw new Error("Al reabrir el Plano Maestro los ejes guardados deberían recargarse: " + trasRecargar);

  // ---- 5) Detección de habitaciones SIN ningún plano de contratista vinculado ----
  const deteccion = await page.evaluate(async () => {
    cerrarFlyoutsAbiertos();
    const pinesAntes = pinesMaestro.length;
    await detectarHabitacionesAutomatico(); // sin candidatos -> cae a detectarHabitacionesPorImagen()
    await new Promise(r => setTimeout(r, 50));
    const overlayAbierto = document.getElementById("foto-avance-overlay").style.display === "flex";
    const textoOverlay = document.getElementById("foto-avance-cuerpo").textContent;
    if (overlayAbierto) confirmarCrearPinesDetectados();
    await new Promise(r => setTimeout(r, 50));
    return { pinesAntes, overlayAbierto, textoOverlay, pinesDespues: pinesMaestro.length, pin: pinesMaestro[0] };
  });
  if (!deteccion.overlayAbierto) throw new Error("Debería haber encontrado y ofrecido crear al menos un pin, analizando la imagen sin contratista vinculado: " + deteccion.textoOverlay);
  if (deteccion.pinesDespues !== deteccion.pinesAntes + 1) throw new Error("Debería haberse creado exactamente 1 pin para la única habitación de la imagen: " + JSON.stringify(deteccion));
  const dentroDelRectangulo = deteccion.pin.x > 60 && deteccion.pin.x < 340 && deteccion.pin.y > 60 && deteccion.pin.y < 240;
  if (!dentroDelRectangulo) throw new Error("El pin detectado debería quedar centrado DENTRO del rectángulo dibujado (60,60)-(340,240): " + JSON.stringify(deteccion.pin));
  await page.evaluate(() => new Promise(r => setTimeout(r, 400))); // pasa el anti-doble-cierre de 350ms del overlay
  await page.evaluate(() => cerrarFotoAvanceOverlay()); // deja todo cerrado antes de la segunda corrida
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));

  // ---- 6) Corrida de nuevo: ya hay un pin ahí, no debería ofrecer otro duplicado ----
  const segundaCorrida = await page.evaluate(async () => {
    await detectarHabitacionesAutomatico();
    await new Promise(r => setTimeout(r, 50));
    return { over: document.getElementById("foto-avance-overlay").style.display, pendientes: _centrosDetectadosPendientes.length };
  });
  if (segundaCorrida.over === "flex" || segundaCorrida.pendientes !== 0) {
    throw new Error("No debería volver a ofrecer la misma habitación ya cubierta por un pin cercano: " + JSON.stringify(segundaCorrida));
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-maestro-seleccionar-ejes-deteccion");
})().catch((e) => { console.error(e); process.exit(1); });
