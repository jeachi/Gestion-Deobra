// Ronda 5 de auditoría -- Caja Chica/Rendiciones: 3 arreglos.
// 1) construirHtmlRendicion() descartaba gastos desde el índice 37 en adelante sin paginar.
// 2) Editar/borrar una rendición vieja no reencadenaba saldoAnterior/totalCaja/diferencia de las
//    rendiciones posteriores de la misma caja.
// 3) Sin aviso de gasto con fecha futura.
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
    usuarios = [{ username: "admin", role: "admin" }];
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    tiposCosto = ["Materiales", "Viáticos"];

    // ---- 1) El PDF genera tantas hojas de ledger como hagan falta, sin perder gastos ----
    const gastos45 = Array.from({ length: 45 }, (_, i) => ({ fecha: "2026-09-01", ticket: `T${i}`, tipoCosto: "Materiales", observaciones: `Gasto ${i}`, centroCosto: "", monto: 1000 }));
    const rendicionGrande = {
      id: "rGrande", numero: 1, usuario: "admin", obra: "ObraTest", responsable: "Juan",
      mes: "Septiembre", quincena: "1ra Quincena", semana: "1",
      saldoAnterior: 0, gastos: gastos45, fondo: [{ detalle: "Reposición", monto: 50000 }],
      totalGastos: 45000, totalCaja: 50000, diferencia: 5000, cerradaManual: false, saldadaPor: null,
    };
    const htmlGrande = construirHtmlRendicion(rendicionGrande);
    const r1_dosHojas = (htmlGrande.match(/print-page rc-page/g) || []).length === 2;
    const r1_gasto0presente = /Gasto 0</.test(htmlGrande);
    const r1_gasto44presente = /Gasto 44</.test(htmlGrande); // el índice 44 (gasto N°45) ya no debería desaparecer
    const r1_totalCorrectoEnUltimaHoja = htmlGrande.includes(formatoMoneda(45000));
    const r1_avisoHojaXdeY = /Hoja 1 de 2/.test(htmlGrande) && /Hoja 2 de 2/.test(htmlGrande);

    // ---- 2) Editar una rendición vieja reencadena el saldo de las posteriores ----
    const r10 = { id: "r10", numero: 10, usuario: "admin", obra: "ObraTest", responsable: "Juan", mes: "Enero", quincena: "1ra Quincena", semana: "",
      saldoAnterior: 0, gastos: [{ fecha: "2026-01-05", ticket: "1", tipoCosto: "Materiales", observaciones: "x", centroCosto: "", monto: 100000 }], fondo: [{ detalle: "Reposición", monto: 100000 }],
      totalGastos: 100000, totalCaja: 100000, diferencia: 0, cerradaManual: false, saldadaPor: null };
    const r11 = { id: "r11", numero: 11, usuario: "admin", obra: "ObraTest", responsable: "Juan", mes: "Enero", quincena: "2da Quincena", semana: "",
      saldoAnterior: 0, gastos: [{ fecha: "2026-01-20", ticket: "1", tipoCosto: "Materiales", observaciones: "y", centroCosto: "", monto: 30000 }], fondo: [{ detalle: "Reposición", monto: 50000 }],
      totalGastos: 30000, totalCaja: 50000, diferencia: 20000, cerradaManual: false, saldadaPor: null };
    rendicionesCache = { r10: { ...r10 }, r11: { ...r11 } };
    rendicionesIndex = [
      { id: "r10", numero: 10, usuario: "admin", obra: "ObraTest", responsable: "Juan", mes: "Enero", quincena: "1ra Quincena", totalGastos: 100000, totalCaja: 100000, diferencia: 0, cerradaManual: false, saldadaPor: null },
      { id: "r11", numero: 11, usuario: "admin", obra: "ObraTest", responsable: "Juan", mes: "Enero", quincena: "2da Quincena", totalGastos: 30000, totalCaja: 50000, diferencia: 20000, cerradaManual: false, saldadaPor: null },
    ];
    // Se "corrige" el gasto de la rendición 10: en realidad era 20000, no 100000.
    const detalle10 = await cargarRendicionDetalle("r10");
    detalle10.gastos[0].monto = 20000;
    detalle10.totalGastos = 20000;
    detalle10.diferencia = detalle10.totalCaja - detalle10.totalGastos; // 100000-20000=80000
    await guardarRendicionDetalle(detalle10);
    rendicionesIndex[0].totalGastos = 20000;
    rendicionesIndex[0].diferencia = 80000;
    await reencadenarSaldoRendicionesPosteriores("admin");
    const detalle11 = await cargarRendicionDetalle("r11");
    const r2_saldoAnteriorReencadenado = detalle11.saldoAnterior === 80000;
    const r2_totalCajaReencadenado = detalle11.totalCaja === 130000; // 80000+50000 de fondo
    const r2_diferenciaReencadenada = detalle11.diferencia === 100000; // 130000-30000
    const r2_indiceActualizado = rendicionesIndex[1].diferencia === 100000;

    // ---- 3) Aviso de gasto con fecha futura (no bloqueante, sigue guardando) ----
    const toasts = [];
    const showToastOriginal = window.showToast;
    window.showToast = (msg) => toasts.push(msg);
    document.getElementById("rc-obra").innerHTML = `<option value="ObraTest">ObraTest</option>`;
    document.getElementById("rc-obra").value = "ObraTest";
    document.getElementById("rc-responsable").value = "Juan";
    document.getElementById("rc-saldo-anterior").value = "0";
    document.getElementById("rc-numero-editar").value = "";
    document.getElementById("rc-mes").value = "Septiembre";
    document.getElementById("rc-quincena").value = "1ra Quincena";
    document.getElementById("rc-semana").value = "1";
    rendicionEditandoId = null;
    correlativoCajaSiguiente = 100;
    rcGastos = [{ fecha: "2099-01-01", ticket: "1", tipoCosto: "Materiales", observaciones: "gasto futuro", centroCosto: "", monto: 500 }];
    rcFondo = [{ detalle: "Reposición", monto: 500 }];
    await guardarRendicion();
    window.showToast = showToastOriginal;
    const r3_avisoFechaFutura = toasts.some(t => t.includes("fecha futura"));
    const r3_igualGuardo = rendicionesIndex.some(r => r.numero === 100); // el aviso no bloquea el guardado

    return { r1_dosHojas, r1_gasto0presente, r1_gasto44presente, r1_totalCorrectoEnUltimaHoja, r1_avisoHojaXdeY, r2_saldoAnteriorReencadenado, r2_totalCajaReencadenado, r2_diferenciaReencadenada, r2_indiceActualizado, r3_avisoFechaFutura, r3_igualGuardo };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_dosHojas) fallas.push("BUG REPRODUCIDO: con 45 gastos (>37) debería generarse una 2da hoja de ledger");
  if (!resultado.r1_gasto0presente) fallas.push("El gasto N°1 debería seguir apareciendo");
  if (!resultado.r1_gasto44presente) fallas.push("BUG REPRODUCIDO: el gasto N°45 (índice 44) desaparecía del PDF sin avisar");
  if (!resultado.r1_totalCorrectoEnUltimaHoja) fallas.push("El TOTAL debería seguir mostrando la suma real de todos los gastos");
  if (!resultado.r1_avisoHojaXdeY) fallas.push("Debería mostrarse 'Hoja 1 de 2' y 'Hoja 2 de 2' cuando hay más de una hoja de ledger");
  if (!resultado.r2_saldoAnteriorReencadenado) fallas.push("BUG REPRODUCIDO: al corregir un gasto de una rendición vieja, el saldoAnterior de la posterior debería reencadenarse");
  if (!resultado.r2_totalCajaReencadenado) fallas.push("El totalCaja de la rendición posterior debería recalcularse con el nuevo saldoAnterior");
  if (!resultado.r2_diferenciaReencadenada) fallas.push("La diferencia de la rendición posterior debería recalcularse en cadena");
  if (!resultado.r2_indiceActualizado) fallas.push("rendicionesIndex también debería reflejar la diferencia reencadenada (para Dashboard/Lista)");
  if (!resultado.r3_avisoFechaFutura) fallas.push("BUG REPRODUCIDO: debería avisar cuando se guarda un gasto con fecha futura");
  if (!resultado.r3_igualGuardo) fallas.push("El aviso de fecha futura no debería bloquear el guardado");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CAJA CHICA (RONDA 5) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
