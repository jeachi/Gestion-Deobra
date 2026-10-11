// Ronda 6 de auditoría -- Dashboard: 4 arreglos.
// 1) renderGraficoAsistenciaDash() ignoraba el filtro de obra del Dashboard.
// 2) El aviso de predicción de Caja Chica podía aparecer y desaparecer solo (condición de carrera
//    con el segundo renderAvisosImportantesDash que dispara renderGraficoAsistenciaDash).
// 3) El aviso de "Mes X del Presupuesto sin cargar" no respetaba el filtro de obra del Dashboard.
// 4) La ventana de "últimos 14 días" de gastos en realidad cubre 15 días pero dividía por 14.
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

  const resultado = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    usuarios = [{ username: "admin", role: "admin" }];
    obraPredeterminada = "ObraA";
    obras = ["ObraA", "ObraB"];
    obrasFinalizadas = [];
    pedidosIndex = []; remitosIndex = []; herramientas = []; observaciones = []; recordatorios = [];
    climaRegistros = []; climaCiudadRef = null; actividadLog = [];
    contratistasIndex = []; presupuestoItems = [];
    mesesConErrorDeCarga = {};

    // ---- 1) El gráfico de asistencia respeta el filtro de obra del Dashboard ----
    trabajadores = [
      { id: "tA", nombre: "Juan (Obra A)", categoria: "Oficial", obra: "ObraA", estado: "Activo", fechaBaja: "", obs: "" },
      { id: "tB", nombre: "Pedro (Obra B)", categoria: "Oficial", obra: "ObraB", estado: "Activo", fechaBaja: "", obs: "" },
    ];
    const hoy = new Date();
    const mesHoy = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0");
    const diaHoy = String(hoy.getDate());
    // Solo el trabajador de Obra B tiene asistencia cargada hoy -- con el filtro en "Obra A", el
    // gráfico de asistencia no debería tener ningún dato (0 presentes de 0 con datos = sin promedio).
    asistenciaCache[mesHoy] = { tB: { obra: "ObraB", days: { [diaHoy]: "9" }, notaQ1: "", notaQ2: "" } };
    dashboardObraFiltro = "ObraA";
    await renderGraficoAsistenciaDash();
    const htmlGraficoA = document.getElementById("dash-asistencia-grafico").innerHTML;
    const r1_sinDatosFiltradoObraA = htmlGraficoA.includes("Todavía no hay suficientes datos");
    dashboardObraFiltro = "ObraB";
    await renderGraficoAsistenciaDash();
    const htmlGraficoB = document.getElementById("dash-asistencia-grafico").innerHTML;
    const r1_conDatosFiltradoObraB = htmlGraficoB.includes("100%");
    dashboardObraFiltro = null;

    // ---- 2) El aviso de predicción de Caja Chica no desaparece por la condición de carrera ----
    // Forzamos que cargarAsistenciaMes tarde un poco -- así, en el código VIEJO (sin sequenciar),
    // agregarAlertaCajaPrediccion gana la carrera, inserta su aviso, y el renderAvisosImportantesDash
    // disparado DESPUÉS por renderGraficoAsistenciaDash lo borra en silencio.
    const cargarAsistenciaMesOriginal = window.cargarAsistenciaMes;
    window.cargarAsistenciaMes = async (mes) => {
      await new Promise(r => setTimeout(r, 120));
      return cargarAsistenciaMesOriginal(mes);
    };
    // Gasto/saldo elegidos para que la alerta dispare SIEMPRE, con la división vieja (/14) o la
    // nueva (/15) -- así este caso aísla limpiamente la condición de carrera (ítem 2) del arreglo
    // de la división de días (ítem 4), sin que se mezclen.
    rendicionesIndex = [{ id: "r1", numero: 1, usuario: "admin", obra: "ObraA", responsable: "Juan", mes: "Enero", quincena: "1ra Quincena", totalGastos: 5000, totalCaja: 8000, diferencia: 3000, cerradaManual: false, saldadaPor: null }];
    const hoyISOOriginal = window.hoyISO;
    const hoyStr = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
    const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
    const ayerStr = ayer.getFullYear() + "-" + String(ayer.getMonth() + 1).padStart(2, "0") + "-" + String(ayer.getDate()).padStart(2, "0");
    await window.storage.set("rendicion_r1", JSON.stringify({
      id: "r1", numero: 1, usuario: "admin", obra: "ObraA", responsable: "Juan",
      gastos: [{ fecha: ayerStr, ticket: "1", tipoCosto: "Materiales", observaciones: "x", centroCosto: "", monto: 5000 }],
      fondo: [{ detalle: "Reposición", monto: 8000 }], totalGastos: 5000, totalCaja: 8000, diferencia: 3000,
      cerradaManual: false, saldadaPor: null,
    }), true);
    rendicionesCache = {};
    await renderDashboard();
    await new Promise(r => setTimeout(r, 700)); // esperamos a que terminen ambas llamadas async
    const htmlAvisos = document.getElementById("dash-avisos-cont").innerHTML;
    const r2_avisoCajaPersiste = htmlAvisos.includes("Caja Chica se agota");
    window.cargarAsistenciaMes = cargarAsistenciaMesOriginal;

    // ---- 3) El aviso de Presupuesto respeta el filtro de obra del Dashboard ----
    presupuestoItems = [{ id: "i1", nombre: "Item", historialMeses: [] }]; // obraPorDefecto() = "ObraA" (obraPredeterminada)
    dashboardObraFiltro = "ObraB"; // el usuario filtró por una obra DISTINTA a la del presupuesto cargado
    const estaSemanaFiltrada = await agregarAvisosDeEstaSemana([]);
    const r3_noMuestraDeOtraObra = !estaSemanaFiltrada.some(a => a.view === "presupuesto");
    dashboardObraFiltro = null;
    const estaSemanaSinFiltro = await agregarAvisosDeEstaSemana([]);
    const r3_muestraYAclaraObraSinFiltro = estaSemanaSinFiltro.some(a => a.view === "presupuesto" && a.texto.includes("ObraA"));

    // ---- 4) La ventana de "14 días" de gastos ahora divide por 15 (días reales incluidos) ----
    // Elegimos gasto reciente=1500 y saldo=1100 a propósito: con el cálculo CORRECTO (/15),
    // ritmoDiario=100/día -> diasRestantes=floor(1100/100)=11 -> >10 días de margen, NO debería
    // avisar. Con el bug viejo (/14), ritmoDiario≈107.14 -> diasRestantes=floor(1100/107.14)=10 ->
    // SÍ dispara una alerta falsa un día antes de lo real.
    rendicionesIndex = [{ id: "r2", numero: 1, usuario: "admin", obra: "ObraA", responsable: "Juan", mes: "Enero", quincena: "1ra Quincena", totalGastos: 1500, totalCaja: 2600, diferencia: 1100, cerradaManual: false, saldadaPor: null }];
    await window.storage.set("rendicion_r2", JSON.stringify({
      id: "r2", numero: 1, usuario: "admin", obra: "ObraA", responsable: "Juan",
      gastos: [{ fecha: ayerStr, ticket: "1", tipoCosto: "Materiales", observaciones: "x", centroCosto: "", monto: 1500 }],
      fondo: [{ detalle: "Reposición", monto: 2600 }], totalGastos: 1500, totalCaja: 2600, diferencia: 1100,
      cerradaManual: false, saldadaPor: null,
    }), true);
    rendicionesCache = {};
    document.getElementById("dash-avisos-cont").innerHTML = `<div class="dash-seccion-tit urgente">x <span class="contador">0</span></div>`;
    await agregarAlertaCajaPrediccion(rendicionesIndex[0]);
    const htmlAviso4 = document.getElementById("dash-avisos-cont").innerHTML;
    const r4_noDisparaAlertaFalsa = !htmlAviso4.includes("Caja Chica se agota");

    return { r1_sinDatosFiltradoObraA, r1_conDatosFiltradoObraB, r2_avisoCajaPersiste, r3_noMuestraDeOtraObra, r3_muestraYAclaraObraSinFiltro, r4_noDisparaAlertaFalsa };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_sinDatosFiltradoObraA) fallas.push("BUG REPRODUCIDO: con el Dashboard filtrado por 'Obra A', el gráfico de asistencia no debería mostrar datos de un trabajador de 'Obra B'");
  if (!resultado.r1_conDatosFiltradoObraB) fallas.push("Con el Dashboard filtrado por 'Obra B', el gráfico sí debería mostrar el 100% de asistencia de ese trabajador");
  if (!resultado.r2_avisoCajaPersiste) fallas.push("BUG REPRODUCIDO: el aviso de predicción de Caja Chica no debería desaparecer por la condición de carrera con renderGraficoAsistenciaDash");
  if (!resultado.r3_noMuestraDeOtraObra) fallas.push("BUG REPRODUCIDO: el aviso de Presupuesto no debería mostrarse si el Dashboard está filtrado por una obra distinta a la del presupuesto cargado");
  if (!resultado.r3_muestraYAclaraObraSinFiltro) fallas.push("Sin filtro de obra, el aviso de Presupuesto debería mostrarse y aclarar de qué obra es");
  if (!resultado.r4_noDisparaAlertaFalsa) fallas.push("BUG REPRODUCIDO: con 11 días reales de margen, la predicción de Caja Chica no debería disparar una alerta (el bug de dividir por 14 en vez de 15 la adelantaba un día)");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE DASHBOARD (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
