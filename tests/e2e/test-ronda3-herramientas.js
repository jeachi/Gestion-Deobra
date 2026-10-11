// Ronda 3 de auditoría -- Herramientas: 4 arreglos.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  // Forzamos la zona horaria de Argentina (UTC-3) -- el bug de "días de atraso" mezclaba fechas
  // parseadas como UTC y como hora local, y solo se manifiesta cuando esas dos formas difieren
  // (el entorno de este contenedor corre en UTC por defecto, donde el bug no se nota).
  const page = await browser.newPage({ timezoneId: "America/Argentina/Buenos_Aires" });
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
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    errorCargaHerramientas = false;

    // ---- 1) Botones mutuamente excluyentes: no se puede "reparar" mientras está prestada, ni "prestar" mientras está en reparación ----
    herramientas = [
      { id: "hPrestada", nombre: "Taladro", cantidad: 1, obra: "ObraTest", estado: "prestada", prestamo: { tipo: "persona", persona: "Juan", fechaEnvio: "2026-01-01", fechaEntrega: "", fechaRecepcion: "" }, fechaCompra: "", condicionInicial: "usada" },
      { id: "hReparacion", nombre: "Amoladora", cantidad: 1, obra: "ObraTest", estado: "reparacion", reparacion: { fechaEnvio: "2026-01-01", motivo: "se rompió" }, fechaCompra: "", condicionInicial: "usada" },
    ];
    renderInventarioHerramientas();
    const htmlLista = document.getElementById("lista-herramientas").innerHTML;
    const r1_sinRepararEnPrestada = !/abrirModalReparacion\('hPrestada'\)/.test(htmlLista);
    const r1_sinPrestarEnReparacion = !/abrirModalPrestamo\('hReparacion'\)/.test(htmlLista);
    // Los botones "opuestos" sí deben seguir disponibles.
    const r1_prestarSigueEnPrestada = /abrirModalPrestamo\('hPrestada'\)/.test(htmlLista);
    const r1_volvioDeReparacionDisponible = /finalizarReparacionHerramienta\('hReparacion'\)/.test(htmlLista);

    // ---- 2) Días de atraso: parseo consistente (sin restar horas de más por zona horaria) ----
    // Simulamos "hoy" = 2026-03-10 y fechaEntrega = 2026-03-09 (venció ayer) -> debería dar 1 día,
    // no 0 (el bug de mezclar UTC/local podía dar Math.floor(0.875)=0 en vez de 1).
    const hoyISOOriginal = window.hoyISO;
    window.hoyISO = () => "2026-03-10";
    herramientas = [{ id: "hAtraso", nombre: "Nivel", cantidad: 1, obra: "ObraTest", estado: "prestada", prestamo: { tipo: "persona", persona: "Pedro", fechaEnvio: "2026-02-01", fechaEntrega: "2026-03-09", fechaRecepcion: "" }, fechaCompra: "", condicionInicial: "usada" }];
    renderInventarioHerramientas();
    const htmlAtraso = document.getElementById("lista-herramientas").innerHTML;
    window.hoyISO = hoyISOOriginal;
    const r2_unDiaDeAtraso = /atrasada 1 día/.test(htmlAtraso);
    const r2_noCeroDias = !/atrasada 0 días/.test(htmlAtraso);

    // ---- 3) Eliminar una herramienta prestada muestra una advertencia específica ----
    herramientas = [{ id: "hBorrar", nombre: "Sierra", cantidad: 1, obra: "ObraTest", estado: "prestada", prestamo: { tipo: "obra", obraDestino: "ObraB", fechaEnvio: "2026-01-01", fechaEntrega: "", fechaRecepcion: "" }, fechaCompra: "", condicionInicial: "usada" }];
    renderInventarioHerramientas();
    const htmlBorrar = document.getElementById("lista-herramientas").innerHTML;
    const r3_avisoEspecifico = /Sigue prestada/.test(htmlBorrar);
    await eliminarHerramienta("hBorrar");
    const actividadTrasBorrar = actividadLog[0] ? actividadLog[0].texto : "";
    const r3_actividadMencionaPrestamo = /seguía prestada a ObraB/.test(actividadTrasBorrar);

    // ---- 4) El contador de "Historial" incluye reparaciones, no solo préstamos ----
    herramientas = [{ id: "hHist", nombre: "Compresor", cantidad: 1, obra: "ObraTest", estado: "bien", historialPrestamos: [], historialReparaciones: [{ fechaEnvio: "2026-01-01", fechaVuelta: "2026-01-05", motivo: "pérdida de aceite" }], fechaCompra: "", condicionInicial: "usada" }];
    renderInventarioHerramientas();
    const htmlHist = document.getElementById("lista-herramientas").innerHTML;
    const r4_contadorIncluyeReparaciones = /Historial \(1\)/.test(htmlHist);

    return { r1_sinRepararEnPrestada, r1_sinPrestarEnReparacion, r1_prestarSigueEnPrestada, r1_volvioDeReparacionDisponible, r2_unDiaDeAtraso, r2_noCeroDias, r3_avisoEspecifico, r3_actividadMencionaPrestamo, r4_contadorIncluyeReparaciones };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_sinRepararEnPrestada) fallas.push("BUG REPRODUCIDO: no debería mostrarse 'Enviar a reparar' para una herramienta que ya está prestada");
  if (!resultado.r1_sinPrestarEnReparacion) fallas.push("BUG REPRODUCIDO: no debería mostrarse 'Prestar a otra obra' para una herramienta en reparación");
  if (!resultado.r1_prestarSigueEnPrestada) fallas.push("'Prestar a otra obra' (que sirve para registrar la devolución) debería seguir disponible mientras está prestada");
  if (!resultado.r1_volvioDeReparacionDisponible) fallas.push("'Volvió de reparación' debería seguir disponible en reparación");
  if (!resultado.r2_unDiaDeAtraso) fallas.push("BUG REPRODUCIDO: un día de atraso completo debería mostrar 'atrasada 1 día', no 0");
  if (!resultado.r2_noCeroDias) fallas.push("BUG REPRODUCIDO: no debería mostrar 'atrasada 0 días' cuando ya pasó un día completo");
  if (!resultado.r3_avisoEspecifico) fallas.push("BUG REPRODUCIDO: eliminar una herramienta prestada debería mostrar una advertencia específica");
  if (!resultado.r3_actividadMencionaPrestamo) fallas.push("El registro de actividad debería mencionar que la herramienta borrada seguía prestada");
  if (!resultado.r4_contadorIncluyeReparaciones) fallas.push("BUG REPRODUCIDO: el contador del botón Historial debería incluir las reparaciones, no solo los préstamos");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE HERRAMIENTAS (RONDA 3) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
