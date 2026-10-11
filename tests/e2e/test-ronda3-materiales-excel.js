// Ronda 3 de auditoría -- Materiales recibidos y Excel de Presupuesto: 2 arreglos.
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
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];

    // ==================== 1) Excel Presupuesto: subtotal de rubro en "$ Acumulado" ====================
    presupuestoItems = [
      { id: "i1", rubro: "1", rubroNombre: "Rubro Uno", nombre: "Item 1", unidad: "m2", cantidad: 10, precioUnitario: 100, precioBase: 1000, precioConCoef: 1000, pctIncidencia: 50,
        historialMeses: [{ n: 1, anterior: 0.5, enElMes: 0.2, acumulado: 0.7, monto: 200 }] },
      { id: "i2", rubro: "1", rubroNombre: "Rubro Uno", nombre: "Item 2", unidad: "m2", cantidad: 5, precioUnitario: 400, precioBase: 2000, precioConCoef: 2000, pctIncidencia: 50,
        historialMeses: [{ n: 1, anterior: 0.1, enElMes: 0.1, acumulado: 0.2, monto: 200 }] },
    ];
    // Solo se elige "$ Acumulado" (no "$ Este mes") -- el bug sumaba SIEMPRE el monto del mes
    // (200+200=400) para el subtotal del rubro, en vez del acumulado real (700+400=1100).
    columnasReportePresupuesto = ["monto_acumulado"];

    let aoaCapturado = null;
    window.XLSX = {
      utils: {
        aoa_to_sheet: (aoa) => { aoaCapturado = aoa; return {}; },
        encode_cell: () => "A1",
        book_new: () => ({}),
        book_append_sheet: () => {},
      },
      writeFile: () => {},
    };
    exportarTodosLosMesesExcel();
    // Fila 0 y 1 son encabezados, fila 2 es el subtotal del rubro (único rubro acá).
    const filaRubro = aoaCapturado[2];
    const colMontoAcum = filaRubro.length - 1; // única columna de mes elegida, al final de la fila
    const r1_subtotalCorrecto = filaRubro[colMontoAcum] === 1100;
    const r1_subtotalViejoBug = filaRubro[colMontoAcum] === 400;

    // ==================== 2) Materiales recibidos: filtra por fecha de ENTREGA, no del pedido ====================
    const pedidoViejo = {
      id: "pViejo", numero: 10, obra: "ObraTest", rubro: "Materiales", tipo: "material",
      fecha: "2026-01-05", // el pedido se cargó en enero
      ingreso: { fecha: "" }, adjuntos: [],
      items: [{ desc: "Cemento", cant: "50", un: "bolsas", imagen: null, entregado: 0 }],
    };
    pedidosCache = { pViejo: pedidoViejo };
    pedidosIndex = [{ id: "pViejo", numero: 10, obra: "ObraTest", rubro: "Materiales", estado: "Pendiente", fecha: "2026-01-05", tipo: "material" }];
    await window.storage.set("pedido_pViejo", JSON.stringify(pedidoViejo), true);
    pedidoAbiertoId = "pViejo";
    // La entrega recién se registra en SEPTIEMBRE (meses después de cargado el pedido).
    actualizarEntrega(0, "50");
    const hoyISOOriginal = window.hoyISO;
    window.hoyISO = () => "2026-09-15";
    await guardarEntrega();
    window.hoyISO = hoyISOOriginal;

    document.getElementById("rec-filtro-obra").value = "";
    document.getElementById("rec-filtro-periodo").value = "mes";
    // Simulamos que "hoy" (para el filtro "Este mes") es septiembre -- el pedido es de enero, pero
    // la entrega se registró en septiembre: debería contar en el reporte de septiembre.
    const mesHoyISOOriginal = window.mesHoyISO;
    window.mesHoyISO = () => "2026-09";
    const recibidosSeptiembre = await calcularMaterialesRecibidos();
    window.mesHoyISO = mesHoyISOOriginal;
    const r2_cuentaEnMesDeEntrega = recibidosSeptiembre.some(m => m.desc === "Cemento" && m.total === 50);

    return { r1_subtotalCorrecto, r1_subtotalViejoBug, r2_cuentaEnMesDeEntrega, filaRubroDebug: filaRubro };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_subtotalCorrecto) fallas.push(`BUG REPRODUCIDO: el subtotal de rubro en "$ Acumulado" debería dar 1100 (0.7*1000 + 0.2*2000), no el monto del mes -- fila: ${JSON.stringify(resultado.filaRubroDebug)}`);
  if (resultado.r1_subtotalViejoBug) fallas.push("BUG REPRODUCIDO: el subtotal de rubro sigue sumando el monto DEL MES (400) en vez del acumulado");
  if (!resultado.r2_cuentaEnMesDeEntrega) fallas.push("BUG REPRODUCIDO: 'Materiales recibidos' debería contar la entrega en el mes en que se REGISTRÓ, no en el mes del pedido");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE MATERIALES RECIBIDOS Y EXCEL (RONDA 3) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
