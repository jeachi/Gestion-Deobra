// Bug real encontrado en auditoría: obtenerEntradaMes() devolvía acumulado:0 para un ítem que ya
// llegó al 100% y no se volvió a tocar (la app deja de pedir % una vez completo -- ver
// renderFormNuevoMes), en vez de arrastrar el último valor conocido como ya hace entradaHastaMes()
// para la lista/resumen. Esto subestimaba el certificado oficial del mes, el A1, los Excel, y el
// propio chequeo de sanidad "Revisar porcentajes" marcaba como incompletos ítems que en realidad
// ya habían llegado al 100% -- y si alguien abría/guardaba la pantalla "Certificados por mes" para
// ese mes (la acción que el propio chequeo sugiere), quedaba una entrada nueva con acumulado:0 que
// REGRESABA PERMANENTEMENTE el ítem a 0% desde ese mes en adelante.
// También se corrige guardarAjustesMesPresupuesto(): (a) su propio cálculo de "anterior" tenía el
// mismo bug (buscaba una entrada exacta en n-1 en vez de arrastrar), y (b) no reencadenaba los
// meses YA CARGADOS posteriores al que se está corrigiendo.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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

  // ---- 1) obtenerEntradaMes() debe arrastrar, no resetear a 0 ----
  const r1 = await page.evaluate(() => {
    const item = { nombre: "Item terminado", precioConCoef: 1000,
      historialMeses: [{ n: 3, anterior: 0.8, enElMes: 0.2, acumulado: 1, monto: 200 }] };
    // Meses 4,5,6 no tienen entrada propia (el ítem ya llegó al 100% y no se volvió a tocar).
    const m6 = obtenerEntradaMes(item, 6);
    return { acumulado: m6.acumulado, anterior: m6.anterior, enElMes: m6.enElMes, monto: m6.monto };
  });
  console.log("1) obtenerEntradaMes de un ítem terminado, en un mes sin entrada propia:", JSON.stringify(r1));
  if (Math.abs(r1.acumulado - 1) > 0.001) throw new Error(`1) BUG REPRODUCIDO: acumulado debería seguir en 100% (1), dio ${r1.acumulado}`);
  if (Math.abs(r1.anterior - 1) > 0.001) throw new Error(`1) 'anterior' debería ser 100% (1), dio ${r1.anterior}`);
  if (r1.enElMes !== 0) throw new Error(`1) 'enElMes' debería ser 0 (nada nuevo ese mes), dio ${r1.enElMes}`);
  if (r1.monto !== 0) throw new Error(`1) 'monto' debería ser 0 (nada nuevo ese mes), dio ${r1.monto}`);

  // ---- 2) Abrir "Certificados por mes" para un mes sin tocar debe precargar el % correcto, y
  //         guardar sin cambiar nada NO debe regresar el ítem a 0% ----
  const r2 = await page.evaluate(async () => {
    obraPredeterminada = "ObraCarry";
    presupuestoItems = [
      { rubro: 1, rubroNombre: "R1", nombre: "Item terminado", unidad: "m2", cantidad: 10, precioConCoef: 1000, pctIncidencia: 1,
        historialMeses: [{ n: 3, anterior: 0.8, enElMes: 0.2, acumulado: 1, monto: 200 }] },
    ];
    abrirDetalleMesPresupuesto(6);
    const input = document.querySelector('.pg-input-acum-mes[data-idx="0"]');
    const precargado = input ? input.value : null;
    await guardarAjustesMesPresupuesto(6);
    const entrada6 = presupuestoItems[0].historialMeses.find(m => m.n === 6);
    return { precargado, entrada6 };
  });
  console.log("2) 'Certificados por mes' de un mes sin tocar, ítem ya terminado:", JSON.stringify(r2));
  if (r2.precargado !== "100.00") throw new Error(`2) BUG REPRODUCIDO: el campo debería precargar 100.00 (ya llegó al 100%), dio ${r2.precargado}`);
  if (!r2.entrada6 || Math.abs(r2.entrada6.acumulado - 1) > 0.001) throw new Error(`2) BUG REPRODUCIDO: guardar sin cambiar nada no debería regresar el ítem a 0%, quedó: ${JSON.stringify(r2.entrada6)}`);
  if (Math.abs(r2.entrada6.anterior - 1) > 0.001) throw new Error(`2) 'anterior' del Mes 6 debería ser 100%, quedó: ${JSON.stringify(r2.entrada6)}`);

  // ---- 3) Corregir un mes YA CARGADO debe reencadenar los meses posteriores ya guardados ----
  const r3 = await page.evaluate(async () => {
    presupuestoItems = [
      { rubro: 1, rubroNombre: "R1", nombre: "Item en curso", unidad: "m2", cantidad: 10, precioConCoef: 1000, pctIncidencia: 1,
        historialMeses: [
          { n: 3, anterior: 0.6, enElMes: 0.1, acumulado: 0.7, monto: 100 },
          { n: 5, anterior: 0.7, enElMes: 0.1, acumulado: 0.8, monto: 100 },
        ] },
    ];
    // Se corrige el Mes 3 de 70% a 75% (ej: se afina un decimal que estaba mal).
    abrirDetalleMesPresupuesto(3);
    const input = document.querySelector('.pg-input-acum-mes[data-idx="0"]');
    input.value = "75";
    await guardarAjustesMesPresupuesto(3);
    const entrada5 = presupuestoItems[0].historialMeses.find(m => m.n === 5);
    return { entrada5 };
  });
  console.log("3) Corregir un mes anterior reencadena el posterior ya cargado:", JSON.stringify(r3));
  if (!r3.entrada5 || Math.abs(r3.entrada5.anterior - 0.75) > 0.001) throw new Error(`3) BUG REPRODUCIDO: el Mes 5 debería quedar con 'anterior' 75% (el Mes 3 corregido), quedó: ${JSON.stringify(r3.entrada5)}`);
  if (Math.abs(r3.entrada5.acumulado - 0.85) > 0.001) throw new Error(`3) El Mes 5 debería quedar con acumulado 85% (75% + 10% de ese mes), quedó: ${JSON.stringify(r3.entrada5)}`);

  console.log("Errores de página:", JSON.stringify(errs));
  if (errs.length) throw new Error("Hubo errores de página durante las pruebas");

  console.log("\nTODOS LOS CHEQUEOS DE ARRASTRE Y REENCADENADO EN PRESUPUESTO OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
