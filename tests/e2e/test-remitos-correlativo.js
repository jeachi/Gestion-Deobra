// Mismo bug ya encontrado y arreglado en Caja Chica/Minutas: correlativoRemitoSiguiente se
// incrementaba al crear pero nunca se decrementaba al borrar el último remito numerado, y no
// existía NINGUNA forma de corregir el N° de un remito ya creado (ni siquiera edición completa).
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
    irA("remitos");
  });

  // ---- 1) Borrar el último remito recicla el correlativo ----
  const r1 = await page.evaluate(async () => {
    remitosIndex = [];
    correlativoRemitoSiguiente = 1;

    const id1 = uid();
    remitosIndex.push({ id: id1, numero: correlativoRemitoSiguiente, obra: "ObraTest", fecha: "2026-01-01" });
    await window.storage.set("remito_" + id1, JSON.stringify({ id: id1, numero: 1, obra: "ObraTest", fecha: "2026-01-01", items: [], chofer: {}, autorizaciones: [] }), true);
    await guardarRemitosIndex();
    correlativoRemitoSiguiente++;
    await guardarCorrelativoRemito();

    const numeroAntesDeBorrar = correlativoRemitoSiguiente;
    await eliminarRemito(id1);
    const numeroDespuesDeBorrar = correlativoRemitoSiguiente;

    const id2 = uid();
    remitosIndex.push({ id: id2, numero: correlativoRemitoSiguiente, obra: "ObraTest", fecha: "2026-01-02" });
    await window.storage.set("remito_" + id2, JSON.stringify({ id: id2, numero: correlativoRemitoSiguiente, obra: "ObraTest", fecha: "2026-01-02", items: [], chofer: {}, autorizaciones: [] }), true);
    await guardarRemitosIndex();
    correlativoRemitoSiguiente++;
    await guardarCorrelativoRemito();

    return { numeroAntesDeBorrar, numeroDespuesDeBorrar, numeroDeLaNueva: remitosIndex[0].numero };
  });
  console.log("1) Borrar el último remito recicla el correlativo:", JSON.stringify(r1));
  if (r1.numeroAntesDeBorrar !== 2) throw new Error(`1) Tras crear el N°1, el correlativo debería quedar en 2, dio ${r1.numeroAntesDeBorrar}`);
  if (r1.numeroDespuesDeBorrar !== 1) throw new Error(`1) BUG REPRODUCIDO: tras borrar el N°1, el correlativo debería volver a 1, quedó en ${r1.numeroDespuesDeBorrar}`);
  if (r1.numeroDeLaNueva !== 1) throw new Error(`1) BUG REPRODUCIDO: el siguiente remito debería reusar el N°1, salió N°${r1.numeroDeLaNueva}`);

  // ---- 2) Corregir el N° de un remito ya creado a mano ----
  const r2 = await page.evaluate(async () => {
    const id = remitosIndex[0].id;
    corregirNumeroRemito(id);
    document.getElementById("remito-numero-nuevo").value = "77";
    await guardarNumeroRemitoCorregido(id);
    const g = await window.storage.get("remito_" + id, true);
    return {
      numeroEnIndice: remitosIndex.find(x => x.id === id).numero,
      numeroEnDetalle: g && g.value ? JSON.parse(g.value).numero : null,
      correlativoSiguienteTrasEditar: correlativoRemitoSiguiente,
    };
  });
  console.log("2) Corregir el N° a mano:", JSON.stringify(r2));
  if (r2.numeroEnIndice !== 77) throw new Error(`2) No se pudo corregir el N° a mano (quedó en ${r2.numeroEnIndice})`);
  if (r2.numeroEnDetalle !== 77) throw new Error(`2) El detalle guardado también debería reflejar el N° corregido, dio ${r2.numeroEnDetalle}`);
  if (r2.correlativoSiguienteTrasEditar <= 77) throw new Error("2) El próximo correlativo debería correrse para no chocar con el N° corregido a mano");

  // ---- 3) No se puede corregir a un N° ya usado por otro remito ----
  const r3 = await page.evaluate(async () => {
    const idOtro = uid();
    remitosIndex.push({ id: idOtro, numero: 3, obra: "ObraTest", fecha: "2026-01-03" });
    await guardarRemitosIndex();
    const idAEditar = remitosIndex[0].id; // la que quedó en 77
    corregirNumeroRemito(idAEditar);
    document.getElementById("remito-numero-nuevo").value = "3";
    await guardarNumeroRemitoCorregido(idAEditar);
    return { numeroSigueIgual: remitosIndex.find(x => x.id === idAEditar).numero === 77 };
  });
  console.log("3) No se puede duplicar un N° ya usado:", JSON.stringify(r3));
  if (!r3.numeroSigueIgual) throw new Error("3) BUG: se permitió corregir a un N° ya usado por otro remito");

  console.log("Errores de página:", JSON.stringify(errs));
  if (errs.length) throw new Error("Hubo errores de página durante las pruebas");

  console.log("\nTODOS LOS CHEQUEOS DE CORRELATIVO DE REMITOS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
