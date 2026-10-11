// Ronda 6 de auditoría -- Presupuesto General: guardarPctInlinePresupuesto no reencadenaba.
// El editor de % inline en la lista principal de ítems (distinto del editor "Ajustes del mes X")
// no reencadenaba los meses POSTERIORES ya cargados al corregir un mes anterior -- a diferencia de
// guardarAjustesMesPresupuesto/confirmarInspeccionPresupuesto, que sí lo hacen.
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

  const resultado = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];

    // Ítem con Mes 1 (30%), Mes 2 (+20% => 50% acum) y Mes 3 (+10% => 60% acum) ya cargados.
    presupuestoItems = [{
      id: "i1", nombre: "Item", rubro: "1", rubroNombre: "Materiales", precioConCoef: 100000,
      historialMeses: [
        { n: 1, anterior: 0, enElMes: 0.30, acumulado: 0.30, monto: 30000 },
        { n: 2, anterior: 0.30, enElMes: 0.20, acumulado: 0.50, monto: 20000 },
        { n: 3, anterior: 0.50, enElMes: 0.10, acumulado: 0.60, monto: 10000 },
      ],
    }];
    presupuestoMesActual = 1; // editamos el Mes 1 vía el inline del listado principal

    const fakeInput = document.createElement("input");
    fakeInput.dataset.idx = "0";
    fakeInput.value = "40"; // corrijo el Mes 1 de 30% a 40%
    await guardarPctInlinePresupuesto(fakeInput);

    const it = presupuestoItems[0];
    const mes1 = it.historialMeses.find(m => m.n === 1);
    const mes2 = it.historialMeses.find(m => m.n === 2);
    const mes3 = it.historialMeses.find(m => m.n === 3);

    const r1_mes1Corregido = Math.abs(mes1.acumulado - 0.40) < 1e-9;
    // Mes 2: enElMes se mantiene en 0.20 (lo que de verdad se hizo ESE mes), pero su "anterior" y
    // "acumulado" deben correrse para arrancar desde el nuevo 40% del Mes 1.
    const r2_mes2Reencadenado = Math.abs(mes2.anterior - 0.40) < 1e-9 && Math.abs(mes2.acumulado - 0.60) < 1e-9;
    const r3_mes3Reencadenado = Math.abs(mes3.anterior - 0.60) < 1e-9 && Math.abs(mes3.acumulado - 0.70) < 1e-9;
    const r4_montosRecalculados = Math.abs(mes2.monto - 20000) < 1 && Math.abs(mes3.monto - 10000) < 1;

    return { r1_mes1Corregido, r2_mes2Reencadenado, r3_mes3Reencadenado, r4_montosRecalculados };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_mes1Corregido) fallas.push("El Mes 1 debería quedar en 40% tras la edición inline");
  if (!resultado.r2_mes2Reencadenado) fallas.push("BUG REPRODUCIDO: guardarPctInlinePresupuesto no reencadena el Mes 2 (debería arrancar 'anterior' desde el 40% corregido del Mes 1)");
  if (!resultado.r3_mes3Reencadenado) fallas.push("BUG REPRODUCIDO: guardarPctInlinePresupuesto no reencadena el Mes 3 (arrastra el desfase del Mes 2)");
  if (!resultado.r4_montosRecalculados) fallas.push("Los montos de los meses posteriores deberían recalcularse con el mismo enElMes pero el precioConCoef vigente");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PRESUPUESTO -- REENCADENADO INLINE (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
