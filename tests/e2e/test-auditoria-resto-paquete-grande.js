// Pedido del usuario (auditoría, paquete grande): resto de hallazgos medios/bajos.
// 1) Herramientas: prestar una herramienta DAÑADA ahora avisa y deja cancelar.
// 2) Plano: eliminarPoligonoEditando() devuelve el botón flotante prestado.
// 3) El overlay genérico de modales se cierra con "atrás" del celular (popstate).
// 4) Certificado: un borrador obsoleto (% por debajo del pctAnterior vigente) no se restaura ciego.
// 5) Dark mode: .fila-separador-prestado tiene color definido para body.tema-oscuro.
// 6) NEXO: nexoBorrarMemoria pide confirmación.
// 7) Minutas: bajar el número a mano libera el hueco del correlativo.
// 8) Visual: formatoMonedaAbreviado() abrevia montos grandes para las tarjetas compactas.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  // ---- 1) Herramientas: prestar una dañada avisa, y cancelar no cambia nada ----
  const r1 = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    herramientas = [{ id: "h1", nombre: "Taladro", obra: "ObraTest", estado: "danada", prestamo: null, historialDanios: [{ motivo: "Se rompió", fecha: "2026-01-01" }] }];
    document.querySelectorAll("#modal-prest-tipo-row").forEach(el => el.remove());
    const cont = document.createElement("div");
    cont.innerHTML = `
      <div id="modal-prest-tipo-row"><button class="chip-opt sel" data-val="obra"></button></div>
      <select id="modal-prest-obra"><option value="OtraObra">OtraObra</option></select>
      <input id="modal-prest-persona" value="">
      <input id="modal-prest-envio" value="2026-02-01">
      <input id="modal-prest-entrega" value="">
      <input id="modal-prest-recepcion" value="">`;
    document.body.appendChild(cont);
    const confirmOriginal = window.confirm;
    window.confirm = () => false; // cancela
    await guardarPrestamoHerramienta("h1");
    const estadoTrasCancelar = herramientas[0].estado;
    window.confirm = () => true; // confirma
    await guardarPrestamoHerramienta("h1");
    const estadoTrasConfirmar = herramientas[0].estado;
    window.confirm = confirmOriginal;
    cont.remove();
    return { estadoTrasCancelar, estadoTrasConfirmar };
  });

  // ---- 2) Plano: eliminarPoligonoEditando devuelve el botón flotante prestado ----
  const r2 = await page.evaluate(() => {
    poligonos = [{ nombreCompleto: "Área test", puntos: [[0, 0], [1, 0], [1, 1]] }];
    indiceEditando = 0;
    backupPuntosEdicion = null;
    mostrarBotonFlotanteGuardar("Guardar certificado", () => {}, "🧾"); // simula el botón "de abajo" (Certificado)
    pedirPrestadoBotonFlotanteGuardar("✓ Listo", () => {}, "✓"); // el editor de polígono lo toma prestado
    const textoAntesDeEliminar = document.getElementById("fab-guardar-texto").textContent;
    const confirmOriginal = window.confirm;
    window.confirm = () => true;
    eliminarPoligonoEditando();
    window.confirm = confirmOriginal;
    const textoDespues = document.getElementById("fab-guardar-texto").textContent;
    const displayDespues = document.getElementById("fab-guardar-flotante").style.display;
    return { textoAntesDeEliminar, textoDespues, displayDespues, poligonoBorrado: poligonos.length === 0 };
  });

  // ---- 3) El modal genérico se cierra con "atrás" ----
  const r3 = await page.evaluate(() => {
    vistaActualNexo = "dashboard";
    abrirPromptGenerico("<p>contenido de prueba</p>");
    const abiertoAntes = document.getElementById("prompt-generico-overlay").style.display === "flex";
    window.dispatchEvent(new PopStateEvent("popstate", { state: { vistaApp: "dashboard" } }));
    const displayDespues = document.getElementById("prompt-generico-overlay").style.display;
    return { abiertoAntes, cerradoDespues: displayDespues === "none" };
  });

  // ---- 4) Certificado: borrador obsoleto (por debajo del pctAnterior) no se restaura ----
  const r4 = await page.evaluate(() => {
    contratistaParaCertificarId = "cTest";
    certFormNumeroDraft = "nuevo";
    certFormItems = [
      { itemId: "i1", nombre: "Item 1", pctAnterior: 0.5, pctAcumulado: 0.5 }, // el real ya subió a 50% desde que se guardó el borrador
      { itemId: "i2", nombre: "Item 2", pctAnterior: 0.1, pctAcumulado: 0.1 },
    ];
    document.getElementById("cf-anotacion").value = "";
    const borrador = {
      fecha: "2026-01-01",
      anotacion: "nota vieja",
      items: [
        { itemId: "i1", pctAcumulado: 0.3 }, // 30% -- quedó por DEBAJO del pctAnterior real (50%), es obsoleto
        { itemId: "i2", pctAcumulado: 0.4 }, // 40% -- sigue siendo válido (por encima de pctAnterior 10%)
      ],
    };
    localStorage.setItem(claveBorradorCertificado("cTest", "nuevo"), JSON.stringify(borrador));
    const toasts = [];
    const toastOriginal = window.showToast;
    window.showToast = (msg) => toasts.push(msg);
    restaurarBorradorCertificadoSiHayDiferencias("2026-02-01");
    window.showToast = toastOriginal;
    localStorage.removeItem(claveBorradorCertificado("cTest", "nuevo"));
    return {
      item1QuedoEnElValorReal: Math.abs(certFormItems[0].pctAcumulado - 0.5) < 0.001, // NO se pisó con el 30% obsoleto
      item2SeRestauroDelBorrador: Math.abs(certFormItems[1].pctAcumulado - 0.4) < 0.001, // este sí es válido
      huboAvisoDeObsoleto: toasts.some(t => /desactualizado/i.test(t)),
    };
  });

  // ---- 5) Dark mode: .fila-separador-prestado tiene color para body.tema-oscuro ----
  const r5 = await page.evaluate(() => {
    document.body.classList.add("tema-oscuro");
    const div = document.createElement("table");
    div.innerHTML = `<tr class="fila-separador-prestado"><td>x</td></tr>`;
    document.body.appendChild(div);
    const td = div.querySelector("td");
    const bg = getComputedStyle(td).backgroundColor;
    div.remove();
    document.body.classList.remove("tema-oscuro");
    // En claro el fondo era #F3EEFF (rgb(243, 238, 255)) -- en oscuro tiene que ser otro color, no ese.
    return { bgEnOscuro: bg, esElMismoQueClaro: bg === "rgb(243, 238, 255)" };
  });

  // ---- 6) NEXO: nexoBorrarMemoria pide confirmación ----
  const r6 = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin" };
    memoriaNexo = [{ texto: "Preferencia test", fecha: "2026-01-01" }];
    const confirmOriginal = window.confirm;
    let sePidioConfirmacion = false;
    window.confirm = (msg) => { sePidioConfirmacion = true; return false; };
    await nexoBorrarMemoria(0);
    const siguioHabiendoUnoTrasCancelar = memoriaNexo.length === 1;
    window.confirm = (msg) => true;
    await nexoBorrarMemoria(0);
    const quedoVacioTrasConfirmar = memoriaNexo.length === 0;
    window.confirm = confirmOriginal;
    return { sePidioConfirmacion, siguioHabiendoUnoTrasCancelar, quedoVacioTrasConfirmar };
  });

  // ---- 7) Minutas: bajar el número a mano libera el hueco ----
  const r7 = await page.evaluate(async () => {
    minutasIndex = [{ id: "m1", numero: 5, obra: "ObraTest" }];
    correlativoMinutaSiguiente = 6; // el 5 es el más alto en uso
    document.querySelectorAll("#minuta-numero-nuevo").forEach(el => el.remove());
    const input = document.createElement("input");
    input.id = "minuta-numero-nuevo";
    input.value = "3"; // se corrige el N° 5 hacia abajo, a 3 (ej: era un error de tipeo)
    document.body.appendChild(input);
    await guardarNumeroMinutaCorregido("m1");
    input.remove();
    return { correlativoLiberado: correlativoMinutaSiguiente, numeroFinal: minutasIndex[0].numero };
  });

  // ---- 9) Asistencia Informes respeta el filtro de obra ----
  const r9 = await page.evaluate(() => {
    trabajadores = [
      { id: "tA", nombre: "Trabajador A", categoria: "Oficial", obra: "Obra A", estado: "activo" },
      { id: "tB", nombre: "Trabajador B", categoria: "Oficial", obra: "Obra B", estado: "activo" },
    ];
    mesActual = "2026-03";
    asistenciaCache = {
      "2026-03": {
        tA: { obra: "Obra A", days: { 1: "8", 2: "8", 3: "8" }, diasObra: {} },
        tB: { obra: "Obra B", days: { 1: "8", 2: "8" }, diasObra: {} },
      },
    };
    const statsObraA = calcularStatsAsistenciaMes("2026-03", "Obra A");
    const statsObraB = calcularStatsAsistenciaMes("2026-03", "Obra B");
    const statsTodas = calcularStatsAsistenciaMes("2026-03", "");
    return {
      obraA_diasTrabajados: statsObraA.diasTrabajados, // debería ser 3 (solo los días de tA)
      obraA_totalPresenteA: statsObraA.porTrabajador.tA.presente,
      obraA_totalPresenteB: statsObraA.porTrabajador.tB.presente, // debería ser 0 (tB no es de Obra A)
      obraB_diasTrabajados: statsObraB.diasTrabajados, // debería ser 2 (solo los días de tB)
      todas_diasTrabajados: statsTodas.diasTrabajados, // sin filtro, sigue sumando todo (3 días distintos con presencia)
    };
  });

  // ---- 8) Visual: formatoMonedaAbreviado abrevia montos grandes ----
  const r8 = await page.evaluate(() => ({
    millones: formatoMonedaAbreviado(7800000),
    miles: formatoMonedaAbreviado(45000),
    chico: formatoMonedaAbreviado(500),
    exactoSigueIgual: formatoMoneda(7800000),
  }));

  console.log("Resultado:", JSON.stringify({ r1, r2, r3, r4, r5, r6, r7, r8, r9 }, null, 2));

  const fallas = [];
  if (r1.estadoTrasCancelar !== "danada") fallas.push(`BUG: cancelar el aviso de herramienta dañada no debería cambiar el estado, dio ${r1.estadoTrasCancelar}`);
  if (r1.estadoTrasConfirmar !== "prestada") fallas.push(`BUG: confirmar el aviso debería pasar a "prestada", dio ${r1.estadoTrasConfirmar}`);

  if (r2.textoAntesDeEliminar !== "✓ Listo") fallas.push(`BUG en el setup del test: el botón prestado no quedó como se esperaba (${r2.textoAntesDeEliminar})`);
  if (!r2.poligonoBorrado) fallas.push("BUG en el setup del test: el polígono no se borró");
  if (r2.textoDespues !== "Guardar certificado") fallas.push(`BUG REPRODUCIDO: eliminarPoligonoEditando no devolvió el botón flotante al de abajo (Guardar certificado), quedó "${r2.textoDespues}"`);
  if (r2.displayDespues !== "flex") fallas.push("BUG: el botón flotante debería seguir visible (mostrando el de abajo), no ocultarse");

  if (!r3.abiertoAntes) fallas.push("BUG en el setup del test: el modal genérico no se abrió");
  if (!r3.cerradoDespues) fallas.push("BUG REPRODUCIDO: el overlay genérico de modales no se cierra con el evento popstate (botón atrás)");

  if (!r4.item1QuedoEnElValorReal) fallas.push("BUG REAL: se restauró un valor de borrador obsoleto (por debajo del % ya certificado realmente)");
  if (!r4.item2SeRestauroDelBorrador) fallas.push("BUG: un ítem válido del borrador no se restauró");
  if (!r4.huboAvisoDeObsoleto) fallas.push("BUG: no se avisó que algún ítem del borrador estaba desactualizado");

  if (r5.esElMismoQueClaro) fallas.push(`BUG REPRODUCIDO: .fila-separador-prestado sigue con el mismo color fijo en modo oscuro (${r5.bgEnOscuro})`);

  if (!r6.sePidioConfirmacion) fallas.push("BUG REPRODUCIDO: nexoBorrarMemoria no pide confirmación antes de borrar");
  if (!r6.siguioHabiendoUnoTrasCancelar) fallas.push("BUG: cancelar la confirmación igual borró el ítem de memoria");
  if (!r6.quedoVacioTrasConfirmar) fallas.push("BUG: confirmar no borró el ítem de memoria");

  if (r7.correlativoLiberado !== 5) fallas.push(`BUG REPRODUCIDO: bajar el N° de la minuta más alta no liberó el hueco (correlativoMinutaSiguiente debería volver a 5), dio ${r7.correlativoLiberado}`);
  if (r7.numeroFinal !== 3) fallas.push(`BUG: la minuta debería haber quedado con el N° 3, dio ${r7.numeroFinal}`);

  if (r8.millones !== "$7,8M") fallas.push(`BUG: formatoMonedaAbreviado(7800000) debería dar "$7,8M", dio "${r8.millones}"`);
  if (r8.miles !== "$45K") fallas.push(`BUG: formatoMonedaAbreviado(45000) debería dar "$45K", dio "${r8.miles}"`);
  if (r8.chico !== "$500,00") fallas.push(`BUG: un monto chico debería seguir mostrándose completo, dio "${r8.chico}"`);
  if (!/7\.800\.000,00/.test(r8.exactoSigueIgual)) fallas.push(`BUG: formatoMoneda() (el exacto, para detalle/PDF) no debería haber cambiado, dio "${r8.exactoSigueIgual}"`);

  if (r9.obraA_diasTrabajados !== 3) fallas.push(`BUG REPRODUCIDO: Informes de Asistencia ignora el filtro de obra -- días trabajados de Obra A debería ser 3, dio ${r9.obraA_diasTrabajados}`);
  if (r9.obraA_totalPresenteA !== 3) fallas.push(`BUG: Trabajador A debería tener 3 días presente en Obra A, dio ${r9.obraA_totalPresenteA}`);
  if (r9.obraA_totalPresenteB !== 0) fallas.push(`BUG REAL: filtrando por Obra A, el Trabajador B (de Obra B) sigue contando presente, dio ${r9.obraA_totalPresenteB}`);
  if (r9.obraB_diasTrabajados !== 2) fallas.push(`BUG: días trabajados de Obra B debería ser 2, dio ${r9.obraB_diasTrabajados}`);
  if (r9.todas_diasTrabajados !== 3) fallas.push(`BUG: sin filtro (Todas las obras) debería seguir sumando todo (3 días con presencia), dio ${r9.todas_diasTrabajados}`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL RESTO DEL PAQUETE OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
