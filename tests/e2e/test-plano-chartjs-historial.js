// Segundo gráfico migrado a Chart.js (mismo patrón ya probado y mergeado para el gráfico de
// asistencia del Dashboard): el historial de avance por capa en Plano de avance ("evolución
// semanal"), que antes era un SVG multi-línea dibujado a mano. Se mantiene intacto el cálculo de
// datos (agrupar por capaId para sobrevivir a un renombre, ordenar por fecha real) -- solo cambia
// el dibujo, con el mismo respaldo SVG si Chart.js no carga desde el CDN.
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.route("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js", async (route) => {
    await route.fulfill({ path: path.join(__dirname, "libs/chartjs/dist/chart.umd.min.js"), contentType: "application/javascript" });
  });

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  await page.evaluate(async () => {
    obraPredeterminada = "ObraPlano";
    irA("planoavance");
    planoActualId = "plano-test-1";
    planosIndex = [{id:"plano-test-1", nombre:"Plano Test", fecha: hoyISO()}];
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const img = new Image();
    await new Promise((resolve,reject)=>{ img.onload=resolve; img.onerror=reject; img.src=dataUrl; });
    imagenPlano = img;
    poligonos = [];
    iniciarCanvas();
    // Tres hitos, dos capas: "Estructura" sube 20 -> 55 -> 80, "Instalaciones" arranca después
    // (solo en el 2do y 3er hito) -- justo el caso que ya cubría el SVG viejo (series que no
    // empiezan todas en el mismo punto).
    snapshotsPlanoActual = [
      { id:"s1", fecha:"2026-06-01", etiqueta:"Semana 1", porcentajes:[
        {capaId:"c1", nombreCompleto:"Pared - Estructura", pct:20},
      ]},
      { id:"s2", fecha:"2026-06-08", etiqueta:"Semana 2", porcentajes:[
        {capaId:"c1", nombreCompleto:"Pared - Estructura", pct:55},
        {capaId:"c2", nombreCompleto:"Pared - Instalaciones", pct:10},
      ]},
      { id:"s3", fecha:"2026-06-15", etiqueta:"Semana 3", porcentajes:[
        {capaId:"c1", nombreCompleto:"Pared - Estructura", pct:80},
        {capaId:"c2", nombreCompleto:"Pared - Instalaciones", pct:40},
      ]},
    ];
    renderListaSnapshots();
  });
  await page.waitForTimeout(200);

  const resultado = await page.evaluate(() => {
    const cont = document.getElementById("grafico-snapshots");
    return {
      chartDisponible: typeof Chart !== "undefined",
      huboCanvas: !!document.getElementById("grafico-snapshots-canvas"),
      instanciaCreada: !!chartHistorialSnapshots,
      cantidadSeries: chartHistorialSnapshots ? chartHistorialSnapshots.data.datasets.length : null,
      etiquetas: chartHistorialSnapshots ? chartHistorialSnapshots.data.labels : null,
      serieEstructura: chartHistorialSnapshots ? chartHistorialSnapshots.data.datasets.find(d=>d.label==="Pared - Estructura").data : null,
      serieInstalaciones: chartHistorialSnapshots ? chartHistorialSnapshots.data.datasets.find(d=>d.label==="Pared - Instalaciones").data : null,
      huboLeyendaPropia: cont.innerHTML.includes("leyenda-grafico") && cont.innerHTML.includes("80%"),
    };
  });

  // Re-renderizar (como al cerrar otra semana) no debería tirar "Canvas is already in use".
  const segundoRenderOk = await page.evaluate(() => {
    try{ renderGraficoHistorialSnapshots(); return { ok:true, instanciaSigueViva: !!chartHistorialSnapshots }; }
    catch(e){ return { ok:false, error:String(e) }; }
  });

  // Con un solo hito (o ninguno) el gráfico no debería mostrarse, y una instancia vieja debe
  // destruirse (no quedar un canvas fantasma referenciando datos viejos).
  const conUnSoloHito = await page.evaluate(() => {
    snapshotsPlanoActual = [snapshotsPlanoActual[0]];
    renderGraficoHistorialSnapshots();
    return {
      instanciaQuedoNula: chartHistorialSnapshots === null,
      contenedorVacio: document.getElementById("grafico-snapshots").innerHTML.trim() === "",
    };
  });

  // Camino de respaldo: sin Chart.js disponible, debe seguir dibujando el SVG de siempre.
  const resultadoSinChartJs = await page.evaluate(() => {
    snapshotsPlanoActual = [
      { id:"s1", fecha:"2026-06-01", etiqueta:"Semana 1", porcentajes:[{capaId:"c1", nombreCompleto:"Pared - Estructura", pct:20}] },
      { id:"s2", fecha:"2026-06-08", etiqueta:"Semana 2", porcentajes:[{capaId:"c1", nombreCompleto:"Pared - Estructura", pct:55}] },
    ];
    const chartOriginal = window.Chart;
    delete window.Chart;
    let error = null;
    try{ renderGraficoHistorialSnapshots(); }catch(e){ error = String(e); }
    const svgDibujado = !!document.querySelector("#grafico-snapshots svg polyline");
    window.Chart = chartOriginal;
    return { error, svgDibujado };
  });

  const resultadoFinal = { resultado, segundoRenderOk, conUnSoloHito, resultadoSinChartJs };
  console.log("Resultado:", JSON.stringify(resultadoFinal, null, 2));

  const fallas = [];
  if (!resultado.chartDisponible) fallas.push("BUG: Chart.js no se pudo cargar (revisar la ruta del route de este test)");
  if (!resultado.huboCanvas) fallas.push("BUG: no se creó el <canvas> del gráfico de historial");
  if (!resultado.instanciaCreada) fallas.push("BUG: no se creó la instancia de Chart.js (chartHistorialSnapshots)");
  if (resultado.cantidadSeries !== 2) fallas.push(`BUG: deberían ser 2 series (una por capa), hay ${resultado.cantidadSeries}`);
  if (JSON.stringify(resultado.etiquetas) !== JSON.stringify(["Semana 1","Semana 2","Semana 3"])) fallas.push(`BUG: las etiquetas del eje X deberían ser las 3 semanas en orden, son ${JSON.stringify(resultado.etiquetas)}`);
  if (JSON.stringify(resultado.serieEstructura) !== JSON.stringify([20,55,80])) fallas.push(`BUG: la serie de Estructura debería ser [20,55,80], es ${JSON.stringify(resultado.serieEstructura)}`);
  // OJO: igual que el SVG original, una capa que arranca después se grafica por su propio índice
  // de aparición (0,1,...), NO alineada a la posición real del hito global -- se preserva ese
  // mismo comportamiento tal cual estaba (no es parte de este cambio arreglarlo).
  if (JSON.stringify(resultado.serieInstalaciones) !== JSON.stringify([10,40])) fallas.push(`BUG: la serie de Instalaciones debería ser [10,40] (por su propio índice de aparición, igual que el SVG original), es ${JSON.stringify(resultado.serieInstalaciones)}`);
  if (!resultado.huboLeyendaPropia) fallas.push("BUG: no se mostró la leyenda propia con el último % de cada capa");
  if (!segundoRenderOk.ok) fallas.push(`BUG: volver a renderizar el gráfico tira un error (probable 'Canvas is already in use'): ${segundoRenderOk.error}`);
  if (!segundoRenderOk.instanciaSigueViva) fallas.push("BUG: tras el segundo render no quedó una instancia de Chart.js viva");
  if (!conUnSoloHito.instanciaQuedoNula) fallas.push("BUG: con un solo hito, la instancia vieja de Chart.js debería destruirse (quedar en null)");
  if (!conUnSoloHito.contenedorVacio) fallas.push("BUG: con un solo hito, el contenedor del gráfico debería quedar vacío");
  if (resultadoSinChartJs.error) fallas.push(`BUG: sin Chart.js disponible, el render tira un error en vez de caer al SVG: ${resultadoSinChartJs.error}`);
  if (!resultadoSinChartJs.svgDibujado) fallas.push("BUG: sin Chart.js disponible, no se dibujó el SVG de respaldo");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL GRÁFICO DE HISTORIAL DE SNAPSHOTS CON CHART.JS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
