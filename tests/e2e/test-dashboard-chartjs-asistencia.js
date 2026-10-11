// Pedido del usuario: reemplazar el gráfico de "Asistencia -- últimos 7 días" del Dashboard
// (antes un SVG dibujado a mano) por Chart.js, con tooltips reales al pasar el mouse/tocar, sin
// perder el comportamiento de antes: mismo cálculo de porcentajes, mismo criterio de "saltar" un
// día sin datos en vez de cortar la línea, y respeta el filtro de obra. Si Chart.js no llegó a
// cargar desde el CDN (sin señal, CDN bloqueado), tiene que caer al mismo SVG de siempre, sin
// romper el Dashboard.
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  // El sandbox de este entorno bloquea la salida a cdnjs.cloudflare.com (política de red), así
  // que para probar el camino REAL con Chart.js cargado (no solo el de respaldo) se intercepta
  // justo esa URL y se sirve una copia local del mismo paquete (chart.js@4.5.1, bajado de npm,
  // la misma versión que usa index.html) -- el resto de la app sigue pegándole a la red real.
  await page.route("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js", async (route) => {
    await route.fulfill({ path: path.join(__dirname, "libs/chartjs/dist/chart.umd.min.js"), contentType: "application/javascript" });
  });

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

  // Fecha fija (hoy = 2026-10-08) con un par de días de asistencia real cargados en memoria, para
  // que el gráfico tenga datos reales que mostrar (no el estado vacío "todavía no hay datos").
  const resultado = await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    trabajadores = [
      { id: "t1", nombre: "Juan Perez", estado: "Activo", obra: "VARELA" },
      { id: "t2", nombre: "Pedro Gomez", estado: "Activo", obra: "VARELA" },
    ];
    const hoy = new Date();
    const mes = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0");
    const diaHoy = String(hoy.getDate());
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const mesAyer = ayer.getFullYear() + "-" + String(ayer.getMonth() + 1).padStart(2, "0");
    const diaAyer = String(ayer.getDate());
    // "8" = ocho horas trabajadas (cuenta como "presente"), "A" = ausente -- los mismos códigos
    // que usa la grilla real de asistencia (ver clasificarValorDia). Hoy: los dos presentes
    // (100%). Ayer: uno presente, uno ausente (50%) -- para poder chequear el cálculo real.
    asistenciaCache[mes] = asistenciaCache[mes] || {};
    asistenciaCache[mes].t1 = { days: { [diaHoy]: "8" } };
    asistenciaCache[mes].t2 = { days: { [diaHoy]: "8" } };
    asistenciaCache[mesAyer] = asistenciaCache[mesAyer] || {};
    asistenciaCache[mesAyer].t1 = { ...(asistenciaCache[mesAyer].t1||{days:{}}), days: { ...(asistenciaCache[mesAyer].t1||{days:{}}).days, [diaAyer]: "8" } };
    asistenciaCache[mesAyer].t2 = { ...(asistenciaCache[mesAyer].t2||{days:{}}), days: { ...(asistenciaCache[mesAyer].t2||{days:{}}).days, [diaAyer]: "A" } };
    await irA("dashboard");
    await new Promise(r => setTimeout(r, 600));
    return {
      chartDisponible: typeof Chart !== "undefined",
      huboCanvas: !!document.getElementById("dash-asistencia-canvas"),
      instanciaCreada: !!chartAsistenciaDash,
      tipoGrafico: chartAsistenciaDash ? chartAsistenciaDash.config.type : null,
      cantidadPuntos: chartAsistenciaDash ? chartAsistenciaDash.data.datasets[0].data.length : null,
      ultimoValor: chartAsistenciaDash ? chartAsistenciaDash.data.datasets[0].data[6] : null,
      penultimoValor: chartAsistenciaDash ? chartAsistenciaDash.data.datasets[0].data[5] : null,
      spanGaps: chartAsistenciaDash ? chartAsistenciaDash.data.datasets[0].spanGaps : null,
      huboTextoPromedio: !!document.querySelector(".dash-graf-valor"),
    };
  });

  // Re-renderizar el Dashboard una segunda vez (como pasaría al volver a entrar a la pantalla)
  // NO debería tirar un error de "Canvas is already in use" -- Chart.js lo tira si no se destruye
  // la instancia anterior antes de crear una nueva sobre el mismo <canvas> id.
  const segundoRenderOk = await page.evaluate(async () => {
    try {
      await renderGraficoAsistenciaDash();
      return { ok: true, instanciaSigueViva: !!chartAsistenciaDash };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Simula Chart.js NO disponible (CDN bloqueado) -- el Dashboard tiene que caer al SVG de
  // siempre, sin quedar en blanco ni tirar error.
  const resultadoSinChartJs = await page.evaluate(async () => {
    const chartOriginal = window.Chart;
    if (chartAsistenciaDash) { chartAsistenciaDash.destroy(); chartAsistenciaDash = null; }
    delete window.Chart;
    let error = null;
    try { await renderGraficoAsistenciaDash(); } catch (e) { error = String(e); }
    const svgDibujado = !!document.querySelector("#dash-asistencia-grafico svg polyline");
    window.Chart = chartOriginal;
    return { error, svgDibujado, textoPromedio: document.querySelector(".dash-graf-valor")?.textContent };
  });

  const resultadoFinal = { ...resultado, segundoRenderOk, resultadoSinChartJs };
  console.log("Resultado:", JSON.stringify(resultadoFinal, null, 2));

  const fallas = [];
  if (!resultado.chartDisponible) fallas.push("BUG: Chart.js no se pudo cargar desde el CDN (typeof Chart === 'undefined') -- revisar la URL del script o la conexión");
  if (!resultado.huboCanvas) fallas.push("BUG: no se creó el <canvas> del gráfico de asistencia");
  if (!resultado.instanciaCreada) fallas.push("BUG: no se creó la instancia de Chart.js (chartAsistenciaDash)");
  if (resultado.tipoGrafico !== "line") fallas.push(`BUG: el tipo de gráfico debería ser 'line', es '${resultado.tipoGrafico}'`);
  if (resultado.cantidadPuntos !== 7) fallas.push(`BUG: deberían ser 7 puntos (últimos 7 días), hay ${resultado.cantidadPuntos}`);
  if (resultado.ultimoValor !== 100) fallas.push(`BUG: el último punto (hoy, los dos trabajadores presentes) debería ser 100%, es ${resultado.ultimoValor}`);
  if (resultado.penultimoValor !== 50) fallas.push(`BUG: el anteúltimo punto (ayer, uno presente y uno ausente) debería ser 50%, es ${resultado.penultimoValor}`);
  if (resultado.spanGaps !== true) fallas.push("BUG: spanGaps debería ser true (un día sin datos salta, no corta la línea, igual que el SVG de antes)");
  if (!resultado.huboTextoPromedio) fallas.push("BUG: no se mostró el promedio de la semana");
  if (!segundoRenderOk.ok) fallas.push(`BUG: volver a renderizar el gráfico tira un error (probable 'Canvas is already in use'): ${segundoRenderOk.error}`);
  if (!segundoRenderOk.instanciaSigueViva) fallas.push("BUG: tras el segundo render no quedó una instancia de Chart.js viva");
  if (resultadoSinChartJs.error) fallas.push(`BUG: sin Chart.js disponible, renderGraficoAsistenciaDash tira un error en vez de caer al SVG: ${resultadoSinChartJs.error}`);
  if (!resultadoSinChartJs.svgDibujado) fallas.push("BUG: sin Chart.js disponible, no se dibujó el SVG de respaldo (el Dashboard se quedaría sin gráfico)");
  if (!resultadoSinChartJs.textoPromedio) fallas.push("BUG: sin Chart.js disponible, no se mostró el promedio en el SVG de respaldo");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL GRÁFICO DE ASISTENCIA CON CHART.JS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
