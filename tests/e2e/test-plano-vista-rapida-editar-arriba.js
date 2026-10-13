// Pedido del usuario: "en la previsualización de planos que el botón para entrar a editar el
// plano no esté al fondo, que se vea arriba para poder ingresar más rápido" -- antes
// "✏️ Editar plano" estaba después de la vista previa, las estadísticas Y la lista de
// actividades (que puede ser larga), así que había que scrollear bastante para llegar. Ahora va
// arriba del todo, justo debajo del título, antes de la vista previa.
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
    // Varias actividades con medidas, para que la lista de "Por actividad" no quede vacía/corta.
    await window.storage.set(`plano_avance_textos_VARELA_${plano.id}`, JSON.stringify([
      { x: 150, y: 150, tipo: "numero", valor: "1x1", unidad: "m", cantidad: 1, categoria: "Ventana", codigo: "V1", estado: "pendiente" },
      { x: 250, y: 150, tipo: "numero", valor: "2x2", unidad: "m", cantidad: 1, categoria: "Puerta", codigo: "P1", estado: "pendiente" },
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1");
    await new Promise(r=>setTimeout(r, 300));
  });

  // ---- 1) "Editar plano" aparece ANTES de la vista previa/estadísticas/lista en el DOM ----
  const r1 = await page.evaluate(() => {
    const btnEditar = document.getElementById("vr-btn-editar");
    const preview = document.querySelector(".vr-preview-cont");
    const listaActividades = document.getElementById("vr-bloque-actividades");
    // Node.DOCUMENT_POSITION_FOLLOWING (4): preview/lista vienen DESPUÉS del botón.
    const editarAntesDePreview = !!(btnEditar.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING);
    const editarAntesDeLista = !!(btnEditar.compareDocumentPosition(listaActividades) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      visible: btnEditar.offsetParent !== null,
      editarAntesDePreview,
      editarAntesDeLista,
      topBtn: btnEditar.getBoundingClientRect().top,
      topPreview: preview.getBoundingClientRect().top,
    };
  });
  console.log("1) Posición del botón Editar plano:", JSON.stringify(r1));
  if (!r1.visible) throw new Error("1) BUG: el botón \"Editar plano\" no está visible en la Vista rápida");
  if (!r1.editarAntesDePreview) throw new Error("1) BUG: \"Editar plano\" sigue apareciendo DESPUÉS de la vista previa en el DOM");
  if (!r1.editarAntesDeLista) throw new Error("1) BUG: \"Editar plano\" sigue apareciendo DESPUÉS de la lista de actividades en el DOM");
  if (!(r1.topBtn < r1.topPreview)) throw new Error(`1) BUG: el botón no se ve arriba de la vista previa en pantalla (topBtn=${r1.topBtn}, topPreview=${r1.topPreview})`);

  // ---- 2) Sigue entrando al editor normalmente al tocarlo ----
  const r2 = await page.evaluate(() => {
    document.getElementById("vr-btn-editar").click();
    return { editorVisible: document.getElementById("card-canvas").style.display === "block" };
  });
  console.log("2) Tocar el botón entra al editor:", JSON.stringify(r2));
  if (!r2.editorVisible) throw new Error("2) BUG: tocar \"Editar plano\" ya no entra al editor del plano");

  console.log("Errores de página:", JSON.stringify(errs));
  if (errs.length) throw new Error("Hubo errores de página durante las pruebas");

  console.log("\nTODOS LOS CHEQUEOS DE \"EDITAR PLANO\" ARRIBA EN VISTA RÁPIDA OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
