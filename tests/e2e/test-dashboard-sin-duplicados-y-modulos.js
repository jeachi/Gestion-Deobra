// Reporte del usuario sobre el Dashboard real (no un rediseño, 3 bugs puntuales):
// 1) "hay varias cosas duplicado como última carga de asistencia" -- cuando lo último cargado hoy
//    es justo la asistencia del día, la tarjeta "Última carga de asistencia / nómina" repite lo
//    mismo que ya dice la sección "🟢 Andando bien" de "Hoy en obra". Se oculta SOLO en ese caso
//    puntual -- un alta/baja/edición de trabajadores hoy sigue avisando igual que siempre, porque
//    esa información no está en ningún otro lado del Dashboard.
// 2) "las tarjetas de resumen tienen colores repetido" -- de las 5 tarjetas de Resumen, Personal
//    activo, Saldo de Caja Chica y Herramientas prestadas compartían las 3 el mismo degradé verde
//    por defecto. Caja Chica pasa a azul (tono-d) y Herramientas a gris pizarra (tono-e).
// 3) "agrega los botones de módulos que faltan" -- Presupuesto General y Pendientes (Observaciones/
//    Recordatorios) son pantallas reales del menú que no tenían tarjeta en la grilla de Módulos.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    trabajadores = [{ id: "t1", nombre: "Juan Perez", estado: "Activo", obra: "VARELA" }];
  });

  // ---- FIX 1a: asistencia de HOY cargada -- "Hoy en obra" la muestra, la tarjeta separada NO ----
  const r1a = await page.evaluate(async () => {
    const hoy = new Date();
    const mes = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0");
    const diaHoy = String(hoy.getDate());
    asistenciaCache[mes] = { t1: { days: { [diaHoy]: "8" } } };
    actividadLog = [{ fecha: hoy.toISOString(), usuario: "admin", texto: "cargó la asistencia de hoy con el asistente (0 ausente(s), 0 enfermo(s))" }];
    await renderDashboard();
    return {
      estadoNominaOculto: document.getElementById("dash-estado-nomina").style.display === "none",
      avisosContieneAsistenciaHoy: document.getElementById("dash-avisos-cont").innerHTML.includes("Asistencia de hoy cargada"),
    };
  });

  // ---- FIX 1b: alta de trabajador HOY (sin relación con la asistencia) -- la tarjeta SÍ avisa, no es duplicado ----
  const r1b = await page.evaluate(async () => {
    const hoy = new Date();
    actividadLog = [{ fecha: hoy.toISOString(), usuario: "admin", texto: 'agregó a "Pedro Gomez" a la nómina de "VARELA"' }];
    await renderDashboard();
    return {
      estadoNominaVisible: document.getElementById("dash-estado-nomina").style.display !== "none",
      textoIncluyeAlta: document.getElementById("dash-estado-nomina").innerHTML.includes("agregó a"),
    };
  });

  // ---- FIX 1c: asistencia de AYER (sin cargar hoy) -- sigue avisando como atrasada (sin tocar) ----
  const r1c = await page.evaluate(async () => {
    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    actividadLog = [{ fecha: ayer.toISOString(), usuario: "admin", texto: "cargó la asistencia de hoy con el asistente (0 ausente(s), 0 enfermo(s))" }];
    await renderDashboard();
    const html = document.getElementById("dash-estado-nomina").innerHTML;
    return {
      estadoNominaVisible: document.getElementById("dash-estado-nomina").style.display !== "none",
      avisaAyer: html.includes("ayer"),
      estiloAmarillo: html.includes("#FFF3CD"),
    };
  });

  // ---- FIX 2: colores de las 5 tarjetas de Resumen ----
  const r2 = await page.evaluate(async () => {
    await renderDashboard();
    const html = document.getElementById("dash-stats").innerHTML;
    return {
      cajaTonoD: html.includes('class="dash-stat tono-d" onclick="irA(\'caja\')"'),
      herramientasTonoE: html.includes('class="dash-stat tono-e" onclick="mostrarDetalleHerramientasPrestadas()"'),
      pedidosSigueTonoB: html.includes('class="dash-stat tono-b"'),
      climaSigueTonoC: html.includes('class="dash-stat tono-c"'),
      personalSinTono: /<div class="dash-stat" onclick="irA\('trabajadores'\)"/.test(html),
    };
  });

  // ---- FIX 3: tarjetas de Presupuesto General y Pendientes en la grilla de Módulos ----
  const r3 = await page.evaluate(() => {
    const html = document.querySelector("#view-dashboard .dash-grid.bento").innerHTML;
    return {
      totalTarjetas: document.querySelectorAll("#view-dashboard .dash-grid.bento .dash-card").length,
      hayPresupuesto: html.includes("Presupuesto General") && html.includes("irA('presupuesto')"),
      hayPendientes: html.includes(">Pendientes<") && html.includes("irA('observaciones')"),
      presupuestoDataModulo: /data-modulo="presupuesto"/.test(html),
      pendientesDataModulo: /data-modulo="observaciones"/.test(html),
    };
  });

  // ---- Las tarjetas nuevas respetan los mismos permisos que ya protege irA() ----
  const comoCapatazSinPermiso = await page.evaluate(async () => {
    ingresarComo({ username: "capataz1", role: "capataz", permisos: { asistencia: true } });
    irA("dashboard");
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/permiso/i.test(msg)) huboToast = true; original(msg); };
    await irA("presupuesto");
    const seQuedoEnDashboard = document.getElementById("view-dashboard").classList.contains("active");
    showToast = original;
    return { huboToast, seQuedoEnDashboard };
  });

  const resultado = { r1a, r1b, r1c, r2, r3, comoCapatazSinPermiso };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1a.estadoNominaOculto) fallas.push("BUG REPRODUCIDO: con la asistencia de hoy recién cargada, la tarjeta 'Última carga de asistencia' sigue apareciendo -- duplica lo que ya dice 'Hoy en obra'");
  if (!r1a.avisosContieneAsistenciaHoy) fallas.push("BUG: 'Hoy en obra' debería seguir mostrando 'Asistencia de hoy cargada' -- no se puede perder esa confirmación");

  if (!r1b.estadoNominaVisible) fallas.push("BUG: un alta de trabajador HOY (no relacionada a la asistencia) dejó de avisarse -- esa información no está en ningún otro lado");
  if (!r1b.textoIncluyeAlta) fallas.push("BUG: la tarjeta de estado de nómina no muestra el texto del alta de hoy");

  if (!r1c.estadoNominaVisible) fallas.push("BUG: la advertencia de asistencia vieja (de ayer, sin cargar hoy) dejó de mostrarse -- ese caso no debía tocarse");
  if (!r1c.avisaAyer) fallas.push("BUG: no dice 'ayer' para una carga de asistencia de hace 1 día");
  if (!r1c.estiloAmarillo) fallas.push("BUG: la advertencia de asistencia vieja perdió su estilo de alerta (amarillo)");

  if (!r2.cajaTonoD) fallas.push("BUG: la tarjeta de Caja Chica no tiene el nuevo color (tono-d)");
  if (!r2.herramientasTonoE) fallas.push("BUG: la tarjeta de Herramientas no tiene el nuevo color (tono-e)");
  if (!r2.pedidosSigueTonoB) fallas.push("BUG: Pedidos perdió su color violeta (tono-b) -- no debía tocarse");
  if (!r2.climaSigueTonoC) fallas.push("BUG: Días trabajados perdió su color ámbar (tono-c) -- no debía tocarse");
  if (!r2.personalSinTono) fallas.push("BUG: Personal activo debería seguir con el verde por defecto, sin clase tono-X");

  if (r3.totalTarjetas !== 12) fallas.push(`BUG REPRODUCIDO: la grilla de Módulos debería tener 12 tarjetas (10 + Presupuesto General + Pendientes), tiene ${r3.totalTarjetas}`);
  if (!r3.hayPresupuesto) fallas.push("BUG: falta la tarjeta de 'Presupuesto General' en el Dashboard");
  if (!r3.hayPendientes) fallas.push("BUG: falta la tarjeta de 'Pendientes' en el Dashboard");
  if (!r3.presupuestoDataModulo) fallas.push("BUG: la tarjeta de Presupuesto General no tiene data-modulo='presupuesto' -- no se le va a pintar bien el ícono con los otros temas");
  if (!r3.pendientesDataModulo) fallas.push("BUG: la tarjeta de Pendientes no tiene data-modulo='observaciones' -- no se le va a pintar bien el ícono con los otros temas");

  if (!comoCapatazSinPermiso.huboToast) fallas.push("BUG DE SEGURIDAD: un Capataz sin permiso de Presupuesto pudo entrar tocando la tarjeta nueva, sin aviso");
  if (!comoCapatazSinPermiso.seQuedoEnDashboard) fallas.push("BUG DE SEGURIDAD: un Capataz sin permiso de Presupuesto entró igual a esa pantalla");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL DASHBOARD (SIN DUPLICADOS, COLORES Y MÓDULOS) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
