// Bug real encontrado en auditoría: correlativoMinutaSiguiente se incrementaba al crear pero nunca
// se decrementaba al borrar la última minuta numerada -- deja huecos permanentes en la numeración,
// y no existía NINGUNA forma de corregir el N° de una minuta ya creada (a diferencia de Caja Chica,
// que ya tiene ambos arreglos). Mismo patrón, mismo fix.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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
    irA("minutas");
  });

  // ---- 1) Borrar la última minuta recicla el correlativo (no deja huecos) ----
  const r1 = await page.evaluate(async () => {
    minutasIndex = [];
    correlativoMinutaSiguiente = 1;

    const id1 = uid();
    minutasIndex.push({ id: id1, numero: correlativoMinutaSiguiente, obra: "ObraTest", fecha: "2026-01-01" });
    await window.storage.set("minuta_" + id1, JSON.stringify({ id: id1, numero: 1, obra: "ObraTest", fecha: "2026-01-01", contenido: "x", firmas: [] }), true);
    await guardarMinutasIndex();
    correlativoMinutaSiguiente++;
    await guardarCorrelativoMinuta();

    const numeroAntesDeBorrar = correlativoMinutaSiguiente; // debería ser 2
    await eliminarMinuta(id1);
    const numeroDespuesDeBorrar = correlativoMinutaSiguiente;

    // Creamos una minuta nueva -- debería reusar el N°1, no saltar al N°2.
    const id2 = uid();
    minutasIndex.push({ id: id2, numero: correlativoMinutaSiguiente, obra: "ObraTest", fecha: "2026-01-02" });
    await window.storage.set("minuta_" + id2, JSON.stringify({ id: id2, numero: correlativoMinutaSiguiente, obra: "ObraTest", fecha: "2026-01-02", contenido: "y", firmas: [] }), true);
    await guardarMinutasIndex();
    correlativoMinutaSiguiente++;
    await guardarCorrelativoMinuta();

    return { numeroAntesDeBorrar, numeroDespuesDeBorrar, numeroDeLaNueva: minutasIndex[0].numero };
  });
  console.log("1) Borrar la última minuta recicla el correlativo:", JSON.stringify(r1));
  if (r1.numeroAntesDeBorrar !== 2) throw new Error(`1) Tras crear la N°1, el correlativo debería quedar en 2, dio ${r1.numeroAntesDeBorrar}`);
  if (r1.numeroDespuesDeBorrar !== 1) throw new Error(`1) BUG REPRODUCIDO: tras borrar la N°1, el correlativo debería volver a 1, quedó en ${r1.numeroDespuesDeBorrar}`);
  if (r1.numeroDeLaNueva !== 1) throw new Error(`1) BUG REPRODUCIDO: la siguiente minuta debería reusar el N°1, salió N°${r1.numeroDeLaNueva}`);

  // ---- 2) Corregir el N° de una minuta ya creada a mano ----
  const r2 = await page.evaluate(async () => {
    const id = minutasIndex[0].id;
    corregirNumeroMinuta(id);
    document.getElementById("minuta-numero-nuevo").value = "99";
    await guardarNumeroMinutaCorregido(id);
    const r = await window.storage.get("minuta_" + id, true);
    return {
      numeroEnIndice: minutasIndex.find(m => m.id === id).numero,
      numeroEnDetalle: r && r.value ? JSON.parse(r.value).numero : null,
      correlativoSiguienteTrasEditar: correlativoMinutaSiguiente,
    };
  });
  console.log("2) Corregir el N° a mano:", JSON.stringify(r2));
  if (r2.numeroEnIndice !== 99) throw new Error(`2) No se pudo corregir el N° a mano (quedó en ${r2.numeroEnIndice})`);
  if (r2.correlativoSiguienteTrasEditar <= 99) throw new Error("2) Tras poner a mano un N° por encima del correlativo actual, el próximo automático debería correrse para no chocar");

  // ---- 3) No se puede corregir a un N° ya usado por otra minuta ----
  const r3 = await page.evaluate(async () => {
    const idOtra = uid();
    minutasIndex.push({ id: idOtra, numero: 5, obra: "ObraTest", fecha: "2026-01-03" });
    await guardarMinutasIndex();
    const idAEditar = minutasIndex[0].id; // la que quedó en 99
    corregirNumeroMinuta(idAEditar);
    document.getElementById("minuta-numero-nuevo").value = "5";
    await guardarNumeroMinutaCorregido(idAEditar);
    return { numeroSigueIgual: minutasIndex.find(m => m.id === idAEditar).numero === 99 };
  });
  console.log("3) No se puede duplicar un N° ya usado:", JSON.stringify(r3));
  if (!r3.numeroSigueIgual) throw new Error("3) BUG: se permitió corregir a un N° ya usado por otra minuta");

  console.log("Errores de página:", JSON.stringify(errs));
  if (errs.length) throw new Error("Hubo errores de página durante las pruebas");

  console.log("\nTODOS LOS CHEQUEOS DE CORRELATIVO DE MINUTAS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
