// Recuperación de emergencia (ver conversación con el usuario sobre pérdida de datos en
// producción): trabajadores/presupuesto/pedidos quedaron sobrescritos con datos de prueba, pero el
// Excel ORIGINAL subido para armar el presupuesto sobrevivió intacto como un documento aparte
// (presupuesto_excel_original_<obra>). No había ninguna forma de bajar ESE archivo tal cual desde
// la app -- la única lectura existente lo fusionaba con presupuestoItems (que ahora puede estar
// vacío/dañado). Se agrega un botón de solo lectura que decodifica ese base64 y dispara una
// descarga, sin tocar ni fusionar nada, para no arriesgar los datos que sí sobrevivieron.
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

  // Un .xlsx mínimo real (zip con un solo archivo vacío) en base64, solo para probar que SE
  // DESCARGA el contenido tal cual -- no hace falta que sea un Excel abrible de verdad para esto.
  const FAKE_XLSX_B64 = "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAAA=";

  const setup = await page.evaluate(async (b64) => {
    obraPredeterminada = "Varela"; obras = ["Varela"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    // Documento tal cual queda en Firestore (comentario en el código: {base64, hoja})
    await window.storage.set(`presupuesto_excel_original_Varela`, JSON.stringify({ base64: b64, hoja: "Hoja1" }), true);
    irA("presupuesto");
    return true;
  }, FAKE_XLSX_B64);
  await page.waitForTimeout(150);

  // ---- 1) El banner/botón de recuperación aparece cuando SÍ hay un Excel original guardado ----
  const r1 = await page.evaluate(() => ({
    bannerVisible: document.getElementById("pg-recuperar-excel-original").style.display !== "none",
  }));

  // ---- 2) Tocar el botón dispara una descarga con el contenido correcto (decodificado), sin
  // tocar presupuestoItems ni escribir nada de vuelta en Firestore ----
  const r2 = await page.evaluate(async (b64) => {
    const itemsAntes = JSON.stringify(presupuestoItems);
    let blobCapturado = null;
    const createObjectURLOriginal = URL.createObjectURL;
    URL.createObjectURL = function(blob){ blobCapturado = blob; return createObjectURLOriginal.call(URL, blob); };
    let descarga = null;
    const anchorOriginalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){
      if (this.download && this.download.includes("presupuesto_original")) {
        descarga = { nombre: this.download };
      } else {
        anchorOriginalClick.call(this);
      }
    };
    let huboSet = false;
    const storageSetOriginal = window.storage.set;
    window.storage.set = async (...args) => { huboSet = true; return storageSetOriginal(...args); };
    await recuperarExcelOriginalPresupuesto();
    URL.createObjectURL = createObjectURLOriginal;
    HTMLAnchorElement.prototype.click = anchorOriginalClick;
    window.storage.set = storageSetOriginal;
    // El contenido del blob descargado tiene que decodificar EXACTAMENTE al mismo base64 original
    const buf = blobCapturado ? await blobCapturado.arrayBuffer() : null;
    const bytesDescargados = buf ? btoa(String.fromCharCode(...new Uint8Array(buf))) : null;
    return {
      huboDescarga: !!descarga,
      nombreArchivo: descarga ? descarga.nombre : null,
      contenidoCoincide: bytesDescargados === b64,
      itemsNoSeTocaron: JSON.stringify(presupuestoItems) === itemsAntes,
      noEscribioNadaEnFirestore: !huboSet,
    };
  }, FAKE_XLSX_B64);

  // ---- 3) Sin Excel original guardado para la obra: el banner NO aparece, y la función avisa en
  // vez de fallar en silencio ----
  const r3 = await page.evaluate(async () => {
    obras = ["LANUS"]; obraPredeterminada = "LANUS";
    irA("presupuesto");
    await new Promise(r=>setTimeout(r, 50));
    const bannerOculto = document.getElementById("pg-recuperar-excel-original").style.display === "none";
    let mensaje = null;
    const original = showToast;
    showToast = (msg) => { mensaje = msg; original(msg); };
    await recuperarExcelOriginalPresupuesto();
    showToast = original;
    return { bannerOculto, mensaje };
  });

  // ---- 4) Sin ser Administrador: la función rechaza (mismo criterio que el resto de la app) ----
  const comoNoAdmin = await page.evaluate(async () => {
    ingresarComo({ username: "capataz1", role: "capataz", permisos: {} });
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/Administrador/.test(msg)) huboToast = true; original(msg); };
    await recuperarExcelOriginalPresupuesto();
    showToast = original;
    return { huboToast };
  });

  const resultado = { setup, r1, r2, r3, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1.bannerVisible) fallas.push("BUG: con un Excel original guardado, el botón de recuperación no apareció");

  if (!r2.huboDescarga) fallas.push("BUG: tocar el botón no disparó ninguna descarga");
  if (r2.nombreArchivo !== "presupuesto_original_Varela.xlsx") fallas.push(`BUG: nombre de archivo inesperado, dio '${r2.nombreArchivo}'`);
  if (!r2.contenidoCoincide) fallas.push("BUG CRÍTICO: el archivo descargado no coincide con lo guardado en Firestore -- la recuperación entregaría un archivo corrupto");
  if (!r2.itemsNoSeTocaron) fallas.push("BUG: recuperar el Excel modificó presupuestoItems -- no debería tocar nada más");
  if (!r2.noEscribioNadaEnFirestore) fallas.push("BUG DE SEGURIDAD: recuperar el Excel escribió algo en Firestore -- tiene que ser una operación de solo lectura, sobre todo ahora");

  if (!r3.bannerOculto) fallas.push("BUG: sin ningún Excel original guardado para esa obra, el botón de recuperación igual aparece");
  if (!r3.mensaje) fallas.push("BUG: sin Excel original guardado, la función no avisa nada (falla en silencio)");

  if (!comoNoAdmin.huboToast) fallas.push("BUG: un Capataz (no admin) puede usar la recuperación sin aviso");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE RECUPERACIÓN DEL EXCEL ORIGINAL OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
