// Pedido del usuario: poder editar una herramienta ya cargada (antes la única forma de corregir
// un error -- un typo en el nombre, la obra equivocada -- era borrarla entera y cargarla de
// nuevo, perdiendo todo su historial de observaciones/préstamos/reparaciones/daños). Se agrega un
// botón "✏️ Editar" (solo Administrador, mismo criterio que Dañada/Reparación/Préstamo/Eliminar)
// que abre un modal con los datos propios de la herramienta -- a propósito NO toca el "Estado"
// (bien/dañada/reparación/prestada), que sigue manejándose solo con los botones dedicados.
const { chromium } = require("playwright");

const FOTO_1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
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

  await page.evaluate((foto) => {
    obraPredeterminada = "VARELA"; obras = ["VARELA", "LANUS"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    herramientas = [{
      id: "h1", nombre: "Taladro Bosch", obra: "VARELA", cantidad: 2, foto,
      condicionInicial: "nueva", fechaCompra: "2026-01-10", fechaIngresoObra: "2026-01-15",
      estado: "bien",
      observaciones: [{ texto: "obs vieja", fecha: "2026-02-01", usuario: "admin" }],
      historialPrestamos: [{ fecha: "2026-03-01", persona: "Juan" }],
      reparacion: null, prestamo: null,
      creadoPor: "admin", timestamp: "2026-01-10T00:00:00.000Z",
    }];
    irA("herramientas");
    document.getElementById("herr-filtro-obra").value = "";
    renderInventarioHerramientas();
  }, FOTO_1x1);
  await page.waitForTimeout(150);

  // ---- 1) Tamaño de las fotos de la lista: un poco más grande que antes (52px -> 68px) ----
  const tamañoFoto = await page.evaluate(() => {
    const img = document.querySelector(".herr-foto");
    const cs = getComputedStyle(img);
    return { width: parseInt(cs.width, 10), height: parseInt(cs.height, 10) };
  });

  // ---- 2) El botón Editar abre el modal con los datos actuales precargados ----
  await page.click('#lista-herramientas button:has-text("Editar")');
  await page.waitForTimeout(100);
  const precarga = await page.evaluate(() => ({
    modalAbierto: document.getElementById("herr-modal-overlay").style.display === "flex",
    nombre: document.getElementById("herr-edit-nombre").value,
    obra: document.getElementById("herr-edit-obra").value,
    cantidad: document.getElementById("herr-edit-cantidad").value,
    fotoSrc: document.getElementById("herr-edit-foto-img").src,
    condicionSel: document.querySelector("#herr-edit-condicion-row .chip-opt.sel").dataset.val,
    fechaCompra: document.getElementById("herr-edit-fecha-compra").value,
    fechaIngreso: document.getElementById("herr-edit-fecha-ingreso").value,
  }));

  // ---- 3) Edita nombre, obra, cantidad, condición y fechas (sin tocar la foto) y guarda ----
  await page.fill("#herr-edit-nombre", "Taladro Bosch GSB 13 RE");
  await page.selectOption("#herr-edit-obra", "LANUS");
  await page.fill("#herr-edit-cantidad", "3");
  await page.click('#herr-edit-condicion-row .chip-opt[data-val="usada"]');
  await page.fill("#herr-edit-fecha-compra", "2026-01-05");
  await page.click('#herr-modal-panel button:has-text("Guardar cambios")');
  await page.waitForTimeout(150);

  const trasGuardar = await page.evaluate(() => {
    const h = herramientas.find(x => x.id === "h1");
    return {
      modalCerrado: document.getElementById("herr-modal-overlay").style.display === "none",
      nombre: h.nombre, obra: h.obra, cantidad: h.cantidad, condicionInicial: h.condicionInicial,
      fechaCompra: h.fechaCompra, fechaIngresoObra: h.fechaIngresoObra,
      fotoSigueSiendoDataUrl: !!h.foto && h.foto.startsWith("data:image"),
      // Lo más importante: estado e historial NO deberían tocarse por editar los datos básicos.
      estadoIntacto: h.estado === "bien",
      observacionesIntactas: h.observaciones.length === 1 && h.observaciones[0].texto === "obs vieja",
      historialPrestamosIntacto: h.historialPrestamos.length === 1,
      listaMuestraNombreNuevo: document.getElementById("lista-herramientas").innerHTML.includes("Taladro Bosch GSB 13 RE"),
    };
  });

  // ---- 4) Sin ser Administrador: no se ve el botón, y la función de todas formas rechaza ----
  const comoNoAdmin = await page.evaluate(() => {
    ingresarComo({ username: "capataz", role: "capataz", permisos: {} });
    usuarios.push({ username: "capataz", role: "capataz", permisos: {} });
    renderInventarioHerramientas();
    const hayBotonEditar = document.getElementById("lista-herramientas").innerHTML.includes("✏️ Editar");
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/Administrador/.test(msg)) huboToast = true; original(msg); };
    abrirModalEditarHerramienta("h1");
    const modalSigueCerrado = document.getElementById("herr-modal-overlay").style.display === "none";
    showToast = original;
    return { hayBotonEditar, huboToast, modalSigueCerrado };
  });

  const resultado = { tamañoFoto, precarga, trasGuardar, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (tamañoFoto.width < 60 || tamañoFoto.height < 60) fallas.push(`BUG: la foto de la lista sigue chica (${tamañoFoto.width}x${tamañoFoto.height}px) -- se pidió agrandarla un poco`);
  if (!precarga.modalAbierto) fallas.push("BUG: el botón Editar no abrió el modal");
  if (precarga.nombre !== "Taladro Bosch") fallas.push(`BUG: el modal no precargó el nombre actual, trajo '${precarga.nombre}'`);
  if (precarga.obra !== "VARELA") fallas.push(`BUG: el modal no precargó la obra actual, trajo '${precarga.obra}'`);
  if (precarga.cantidad !== "2") fallas.push(`BUG: el modal no precargó la cantidad actual, trajo '${precarga.cantidad}'`);
  if (!precarga.fotoSrc || !precarga.fotoSrc.startsWith("data:image")) fallas.push("BUG: el modal no precargó la foto actual");
  if (precarga.condicionSel !== "nueva") fallas.push(`BUG: el modal no precargó la condición actual (nueva), trajo '${precarga.condicionSel}'`);
  if (precarga.fechaCompra !== "2026-01-10") fallas.push(`BUG: el modal no precargó la fecha de compra, trajo '${precarga.fechaCompra}'`);
  if (precarga.fechaIngreso !== "2026-01-15") fallas.push(`BUG: el modal no precargó la fecha de ingreso, trajo '${precarga.fechaIngreso}'`);

  if (!trasGuardar.modalCerrado) fallas.push("BUG: el modal no se cerró después de guardar");
  if (trasGuardar.nombre !== "Taladro Bosch GSB 13 RE") fallas.push(`BUG: el nombre no se actualizó, quedó '${trasGuardar.nombre}'`);
  if (trasGuardar.obra !== "LANUS") fallas.push(`BUG: la obra no se actualizó, quedó '${trasGuardar.obra}'`);
  if (trasGuardar.cantidad !== 3) fallas.push(`BUG: la cantidad no se actualizó, quedó ${trasGuardar.cantidad}`);
  if (trasGuardar.condicionInicial !== "usada") fallas.push(`BUG: la condición no se actualizó, quedó '${trasGuardar.condicionInicial}'`);
  if (trasGuardar.fechaCompra !== "2026-01-05") fallas.push(`BUG: la fecha de compra no se actualizó, quedó '${trasGuardar.fechaCompra}'`);
  if (trasGuardar.fechaIngresoObra !== "2026-01-15") fallas.push(`BUG: la fecha de ingreso (no tocada) debería seguir igual, quedó '${trasGuardar.fechaIngresoObra}'`);
  if (!trasGuardar.fotoSigueSiendoDataUrl) fallas.push("BUG: la foto se perdió al guardar la edición sin tocarla");
  if (!trasGuardar.estadoIntacto) fallas.push("BUG: editar los datos básicos tocó el Estado de la herramienta -- no debería");
  if (!trasGuardar.observacionesIntactas) fallas.push("BUG: editar los datos básicos perdió/alteró las observaciones ya cargadas");
  if (!trasGuardar.historialPrestamosIntacto) fallas.push("BUG: editar los datos básicos perdió el historial de préstamos ya cargado");
  if (!trasGuardar.listaMuestraNombreNuevo) fallas.push("BUG: la lista no se refrescó mostrando el nombre nuevo");

  if (comoNoAdmin.hayBotonEditar) fallas.push("BUG: un Capataz (no admin) ve el botón Editar -- debería ser solo del Administrador");
  if (!comoNoAdmin.huboToast) fallas.push("BUG: llamar a abrirModalEditarHerramienta sin ser admin no avisa que es solo del Administrador");
  if (!comoNoAdmin.modalSigueCerrado) fallas.push("BUG: llamar a abrirModalEditarHerramienta sin ser admin igual abrió el modal");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE EDITAR HERRAMIENTA + FOTO MÁS GRANDE OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
