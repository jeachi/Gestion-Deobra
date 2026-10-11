// Dos bugs reales encontrados al revisar por qué el cierre en cadena dejaba de "enganchar" viejas
// rendiciones con las nuevas:
//
// 1) Rendiciones viejas (de antes de que existiera el campo "usuario") quedaron con ese campo
//    vacío, pero rendiciones nuevas SI lo tienen seteado al nombre de usuario real del
//    Administrador (ej: "admin"). Antes, el cierre en cadena agrupaba por el valor crudo de
//    "usuario" ("" vs "admin") -- dos grupos DISTINTOS que nunca se comparaban entre sí, aunque
//    fueran la misma caja de la misma persona. Resultado: una rendición vieja nunca se enganchaba
//    con una nueva que la cubría.
//
// 2) Al corregir el N° de una rendición a mano (ej: de 13 a 11), cualquier OTRA rendición que decía
//    "saldada por la N°13" quedaba con una referencia HUÉRFANA -- seguía diciendo "cubierta por
//    N°13" aunque esa rendición ahora se llama "11", en vez de actualizarse a "cubierta por N°11".
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message + "\n" + (e.stack || "")));

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
    usuarios = [{ username: "admin", role: "admin" }];
    obraPredeterminada = "VARELA";
    obras = ["VARELA"];
    obrasFinalizadas = [];
    irA("caja");
  });

  // ---- Bug 1: bucket "" vs "admin" ----
  const resultadoBucket = await page.evaluate(async () => {
    rendicionesIndex = [];
    rendicionesCache = {};

    // N°10: rendición VIEJA, con "usuario" vacío (como quedaron las de antes de que existiera el campo).
    const r10 = {
      id: "vieja-10", numero: 10, usuario: "", obra: "VARELA", responsable: "JESUS CHIMINO",
      mes: "Agosto", quincena: "1ra Quincena", saldoAnterior: 0,
      gastos: [], fondo: [{ detalle: "Entrega", monto: 100000 }],
      totalGastos: 150100, totalCaja: 100000, diferencia: -50100,
      cerradaManual: false, saldadaPor: null,
    };
    rendicionesIndex.push({ id: r10.id, numero: r10.numero, usuario: r10.usuario, obra: r10.obra, responsable: r10.responsable,
      mes: r10.mes, quincena: r10.quincena, totalGastos: r10.totalGastos, totalCaja: r10.totalCaja, diferencia: r10.diferencia,
      cerradaManual: r10.cerradaManual, saldadaPor: r10.saldadaPor });
    await guardarRendicionDetalle(r10);
    correlativoCajaSiguiente = 11;

    // N°11: rendición NUEVA, cargada por el mismo Administrador (usuario="admin" real), que recibe
    // exactamente lo necesario para cubrir su propio gasto MÁS el arrastre de la N°10.
    document.getElementById("rc-obra").innerHTML = `<option value="VARELA">VARELA</option>`;
    cambiarVistaCaja("nueva");
    document.getElementById("rc-obra").value = "VARELA";
    document.getElementById("rc-responsable").value = "JESUS CHIMINO";
    document.getElementById("rc-saldo-anterior").value = -50100;
    rcFondo = [{ detalle: "Entrega", monto: 150100 }];
    rcGastos = [{ fecha: "2026-09-20", ticket: "", tipoCosto: "", observaciones: "Gasto", centroCosto: "", monto: 100000 }];
    await guardarRendicion();

    const porNumero = {};
    rendicionesIndex.forEach(r => { porNumero[r.numero] = r; });
    return {
      diez: { diferencia: porNumero[10].diferencia, saldadaPor: porNumero[10].saldadaPor, cerrada: estaRendicionCerrada(porNumero[10]) },
      once: { diferencia: porNumero[11].diferencia, saldadaPor: porNumero[11].saldadaPor },
    };
  });

  // ---- Bug 2: renumerar no actualiza referencias "saldadaPor" huérfanas ----
  const resultadoRenumerar = await page.evaluate(async () => {
    // A esta altura la N°10 quedó saldada por la N°11 (si el bug 1 está resuelto). Ahora corregimos
    // el N° de la rendición que saldó a la N°10 (la "11") para que pase a ser la "99".
    const idQueEraOnce = rendicionesIndex.find(r => r.numero === 11).id;
    await editarRendicion(idQueEraOnce);
    document.getElementById("rc-numero-editar").value = "99";
    await guardarRendicion();

    const porNumero = {};
    rendicionesIndex.forEach(r => { porNumero[r.numero] = r; });
    return {
      diez: { saldadaPor: porNumero[10] ? porNumero[10].saldadaPor : null },
      noventaYNueve: { existe: !!porNumero[99] },
    };
  });

  console.log("Bucket usuario (\"\" vs \"admin\"):", JSON.stringify(resultadoBucket, null, 2));
  console.log("Renumerar actualiza referencias:", JSON.stringify(resultadoRenumerar, null, 2));
  console.log("Errores de página:", JSON.stringify(pageErrors));

  const fallas = [];
  if (Math.abs(resultadoBucket.once.diferencia - 0) > 1) fallas.push(`La N°11 debería cerrar en $0 (cubre su gasto + el arrastre de la N°10), dio ${resultadoBucket.once.diferencia}`);
  if (!resultadoBucket.diez.cerrada) fallas.push("BUG REPRODUCIDO: la N°10 (usuario vacío) no se cerró aunque la N°11 (usuario='admin') ya la cubrió -- el agrupamiento por usuario crudo las separaba");
  if (resultadoBucket.diez.saldadaPor !== 11) fallas.push(`La N°10 debería decir "saldada por N°11", dio saldadaPor=${resultadoBucket.diez.saldadaPor}`);

  if (!resultadoRenumerar.noventaYNueve.existe) fallas.push("No se pudo renumerar la rendición de 11 a 99");
  if (resultadoRenumerar.diez.saldadaPor !== 99) fallas.push(`BUG REPRODUCIDO: tras renumerar la N°11 a N°99, la N°10 debería decir "saldada por N°99" (no quedar con una referencia vieja a la N°11), dio saldadaPor=${resultadoRenumerar.diez.saldadaPor}`);

  if (pageErrors.length) fallas.push(`${pageErrors.length} error(es) de página sin atrapar`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE BUCKET DE USUARIO Y RENUMERACIÓN OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
