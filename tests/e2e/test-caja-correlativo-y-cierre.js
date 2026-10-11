// Dos bugs reportados en Caja Chica:
// 1) Si se borra la última rendición cargada por error, el correlativo queda "quemado" y la
//    próxima salta un número (hizo la 14 en vez de la 13). Además no se podía corregir a mano el
//    N° de una rendición ya creada.
// 2) Una rendición con diferencia negativa (ej: la 12) no se cerraba aunque una reposición
//    posterior ya cubriera el saldo pendiente -- sobre todo si había MÁS DE UNA rendición abierta
//    seguida (12 y 13 sin cerrar, recién la 14 las cubre): el arrastre de un solo salto no
//    alcanzaba para cerrar las dos de una vez.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
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
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    irA("caja");
  });

  // ---- Escenario 1: borrar la última rendición recicla el correlativo ----
  const resultado1 = await page.evaluate(async () => {
    rendicionesIndex = [];
    rendicionesCache = {};
    correlativoCajaSiguiente = 1;

    // Cargamos la N°1 con datos mínimos válidos.
    document.getElementById("rc-obra").innerHTML = `<option value="ObraTest">ObraTest</option>`;
    cambiarVistaCaja("nueva");
    document.getElementById("rc-obra").value = "ObraTest";
    document.getElementById("rc-responsable").value = "Juan";
    await guardarRendicion();

    const numeroAntesDeBorrar = correlativoCajaSiguiente; // debería ser 2
    const idCreada = rendicionesIndex[0].id;
    rendicionAbiertoId = idCreada;
    await eliminarRendicion();
    const numeroDespuesDeBorrar = correlativoCajaSiguiente;

    // Creamos una nueva -- debería volver a ser la N°1, no saltar a la N°2.
    cambiarVistaCaja("nueva");
    document.getElementById("rc-obra").value = "ObraTest";
    document.getElementById("rc-responsable").value = "Juan";
    await guardarRendicion();
    const numeroDeLaNueva = rendicionesIndex[0].numero;

    return { numeroAntesDeBorrar, numeroDespuesDeBorrar, numeroDeLaNueva };
  });

  // ---- Escenario 2: editar el N° a mano de una rendición existente ----
  const resultado2 = await page.evaluate(async () => {
    const id = rendicionesIndex[0].id;
    await editarRendicion(id);
    document.getElementById("rc-numero-editar").value = "99";
    await guardarRendicion();
    return { numeroTrasEditar: rendicionesCache[id].numero, numeroEnIndice: rendicionesIndex.find(r=>r.id===id).numero, correlativoSiguienteTrasEditar: correlativoCajaSiguiente };
  });

  // ---- Escenario 3: cadena de cierre con más de un eslabón (12, 13 abiertas -> 14 las cubre) ----
  const resultado3 = await page.evaluate(async () => {
    rendicionesIndex = [];
    rendicionesCache = {};
    correlativoCajaSiguiente = 12;

    async function crear(numeroEsperado, saldoAnteriorForzado, montoFondo) {
      cambiarVistaCaja("nueva");
      document.getElementById("rc-obra").value = "ObraTest";
      document.getElementById("rc-responsable").value = "Pedro";
      document.getElementById("rc-saldo-anterior").value = saldoAnteriorForzado;
      rcFondo = [{ detalle: "Entrega", monto: montoFondo }];
      rcGastos = [];
      await guardarRendicion();
    }

    // N°12: recibe 100, gasta 600 -> diferencia -500 (queda abierta, a favor del responsable).
    await crear(12, 0, 100);
    // Re-guardamos la N°12 con el gasto real (edición inmediata tras crearla) -- editarRendicion
    // recarga rcGastos/rcFondo desde lo ya guardado, así que el gasto se agrega DESPUÉS de eso.
    await editarRendicion(rendicionesIndex[0].id);
    document.getElementById("rc-saldo-anterior").value = 0;
    rcFondo = [{ detalle: "Entrega", monto: 100 }];
    rcGastos = [{ fecha: "2026-01-01", ticket: "", tipoCosto: "", observaciones: "Gasto grande", centroCosto: "", monto: 600 }];
    await guardarRendicion();

    // N°13: no le dan nada, sigue en contra -> diferencia sigue negativa (-500).
    await crear(13, -500, 0);

    // N°14: le dan 500 de más -> cubre todo el arrastre y cierra en positivo.
    await crear(14, -500, 500);

    const porNumero = {};
    rendicionesIndex.forEach(r => { porNumero[r.numero] = r; });
    return {
      doce: { diferencia: porNumero[12].diferencia, saldadaPor: porNumero[12].saldadaPor },
      trece: { diferencia: porNumero[13].diferencia, saldadaPor: porNumero[13].saldadaPor },
      catorce: { diferencia: porNumero[14].diferencia, saldadaPor: porNumero[14].saldadaPor },
    };
  });

  console.log("Escenario 1 (recicla correlativo al borrar):", JSON.stringify(resultado1, null, 2));
  console.log("Escenario 2 (editar N° a mano):", JSON.stringify(resultado2, null, 2));
  console.log("Escenario 3 (cadena de cierre de varios eslabones):", JSON.stringify(resultado3, null, 2));
  console.log("Errores de página:", JSON.stringify(pageErrors));

  const fallas = [];
  if (resultado1.numeroAntesDeBorrar !== 2) fallas.push(`Tras crear la N°1, el correlativo debería quedar en 2, dio ${resultado1.numeroAntesDeBorrar}`);
  if (resultado1.numeroDespuesDeBorrar !== 1) fallas.push(`BUG: tras borrar la última rendición (N°1), el correlativo debería volver a 1, quedó en ${resultado1.numeroDespuesDeBorrar}`);
  if (resultado1.numeroDeLaNueva !== 1) fallas.push(`BUG REPRODUCIDO: la siguiente rendición debería reusar el N°1 (no saltear), pero salió N°${resultado1.numeroDeLaNueva}`);

  if (resultado2.numeroTrasEditar !== 99) fallas.push(`No se pudo corregir a mano el N° de una rendición existente (quedó en ${resultado2.numeroTrasEditar})`);
  if (resultado2.numeroEnIndice !== 99) fallas.push("El índice de rendiciones no reflejó el N° corregido a mano");
  if (resultado2.correlativoSiguienteTrasEditar <= 99) fallas.push("Tras poner a mano un N° por encima del correlativo actual, el próximo automático debería correrse para no chocar");

  if (Math.abs((resultado3.doce.diferencia||0) - (-500)) > 1) fallas.push(`La N°12 debería tener diferencia -500, dio ${resultado3.doce.diferencia}`);
  if (!resultado3.doce.saldadaPor) fallas.push("BUG REPRODUCIDO: la N°12 quedó sin cerrar aunque la N°14 ya cubrió el saldo pendiente (arrastre de un solo salto no alcanzó)");
  if (!resultado3.trece.saldadaPor) fallas.push("La N°13 debería haber quedado saldada por la N°14");
  if (resultado3.catorce.saldadaPor) fallas.push("La N°14 no debería estar 'saldada' por nadie (es la que cierra en positivo)");

  if (pageErrors.length) fallas.push(`${pageErrors.length} error(es) de página sin atrapar`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CAJA CHICA (CORRELATIVO Y CIERRE EN CADENA) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
