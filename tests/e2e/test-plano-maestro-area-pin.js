// Pedido del usuario: "que los planos ya calibrados -- donde esté ubicado un pin que es un
// contorno cerrado ya tenga un aproximado de m2 de área donde está ese pin". Reutiliza el mismo
// motor que ya usa "Contorno interno"/la detección automática de habitaciones (mapa de bordes +
// inundar área libre): si el Plano Maestro tiene escala calibrada y el pin cae dentro de una
// zona encerrada por líneas, el panel del pin muestra "≈ X m²" sin tener que marcarla a mano.
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

    // Misma imagen que el test de detección por imagen: fondo blanco 400x300 con un rectángulo
    // cerrado (60,60)-(340,240) de borde negro -- adentro queda una "habitación", afuera es fondo
    // (toca el borde de la imagen, así que nunca cuenta como encerrado).
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
    await window.storage.set(`plano_maestro_pines_VARELA_${planoM.id}`, JSON.stringify([
      { id: "pAdentro", x: 200, y: 150, nombre: "Living", checklist: [], capasVinculadas: [] },
      { id: "pAfuera", x: 20, y: 20, nombre: "Patio", checklist: [], capasVinculadas: [] },
    ]), true);
    await irA("planoavance");
    await new Promise(r => setTimeout(r, 150));
    await seleccionarPlano("plM", true);
    await new Promise(r => setTimeout(r, 400));
  });

  // ---- 1) Sin escala calibrada, el panel no muestra ningún m² ----
  const sinEscala = await page.evaluate(() => {
    abrirPanelPinMaestro("pAdentro");
    return document.getElementById("pin-maestro-area-m2").textContent.trim();
  });
  if (sinEscala !== "") throw new Error("Sin escala calibrada no debería mostrar ningún m²: " + JSON.stringify(sinEscala));

  // ---- 2) Calibrar la escala (100px = 1m) y reabrir el pin de ADENTRO del contorno ----
  const adentro = await page.evaluate(async () => {
    cerrarPanelPinMaestro();
    metrosPorPixelPlano = 0.01;
    await guardarCalibracionPlano();
    abrirPanelPinMaestro("pAdentro");
    return document.getElementById("pin-maestro-area-m2").textContent.trim();
  });
  const m2Match = adentro.match(/([\d.]+)\s*m²/);
  if (!m2Match) throw new Error("El pin adentro del contorno cerrado debería mostrar un '≈ X m²': " + JSON.stringify(adentro));
  const m2 = parseFloat(m2Match[1]);
  if (m2 < 4.0 || m2 > 5.5) throw new Error(`El área mostrada (${m2} m²) está fuera del rango esperado para ese rectángulo (~4.7 m²): ` + adentro);

  // ---- 3) El pin de AFUERA del contorno (toca el borde de la imagen) no muestra nada ----
  const afuera = await page.evaluate(() => {
    cerrarPanelPinMaestro();
    abrirPanelPinMaestro("pAfuera");
    return document.getElementById("pin-maestro-area-m2").textContent.trim();
  });
  if (afuera !== "") throw new Error("Un pin fuera de cualquier contorno cerrado no debería mostrar ningún m²: " + JSON.stringify(afuera));

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-maestro-area-pin");
})().catch((e) => { console.error(e); process.exit(1); });
