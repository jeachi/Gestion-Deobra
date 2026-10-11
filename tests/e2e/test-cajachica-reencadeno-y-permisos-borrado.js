// Pedido del usuario (auditoría), 2 hallazgos de Caja Chica + 1 de permisos:
// 1) quitarUsuario() reasignaba las rendiciones del capataz borrado al Administrador pero nunca
//    reencadenaba saldoAnterior/totalCaja/diferencia -- quedaban mezcladas en la cadena del Admin
//    con un saldo calculado contra una cadena vieja que ya no existe.
// 2) eliminarRendicion() reencadena las rendiciones POSTERIORES a la borrada, pero si se borra la
//    MÁS VIEJA de una caja, la que pasa a ser primera queda con un saldoAnterior huérfano (nada la
//    recalcula nunca). El fix lo reinicia a $0 y avisa para que se revise a mano.
// 3) eliminarPresupuestoObra/eliminarContratista/eliminarCertificado/eliminarMinuta/eliminarRemito
//    se podían ejecutar con solo el permiso de módulo, sin exigir rol admin (a diferencia de
//    Pedidos/Herramientas/Recordatorios/Observaciones).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());

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

  // ---- 1) quitarUsuario reencadena las rendiciones migradas al Admin ----
  const r1 = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    usuarios = [
      { username: "admin", role: "admin" },
      { username: "capataz1", role: "capataz", permisos: {} },
    ];
    obraPredeterminada = "ObraTest"; obras = ["ObraTest"]; obrasFinalizadas = [];

    // El Admin ya tiene una rendición N°1 (diferencia 80000). El capataz1 tiene la N°2, con un
    // saldoAnterior que NO tiene nada que ver con la cadena del Admin (está cargada aparte, en su
    // propia caja). Al borrar a capataz1, su rendición pasa a "usuario:''" (cadena del Admin) y
    // ahora SÍ tiene que reencadenarse contra la N°1.
    const rAdmin = { id: "rAdmin", numero: 1, usuario: "", obra: "ObraTest", responsable: "Juan", mes: "Enero", quincena: "1ra Quincena", semana: "",
      saldoAnterior: 0, gastos: [], fondo: [{ detalle: "Reposición", monto: 80000 }],
      totalGastos: 0, totalCaja: 80000, diferencia: 80000, cerradaManual: false, saldadaPor: null };
    const rCapataz = { id: "rCapataz", numero: 2, usuario: "capataz1", obra: "ObraTest", responsable: "Pedro", mes: "Enero", quincena: "2da Quincena", semana: "",
      saldoAnterior: 5000, gastos: [], fondo: [{ detalle: "Reposición", monto: 10000 }], // saldoAnterior viejo, de SU PROPIA caja (ya borrada)
      totalGastos: 0, totalCaja: 15000, diferencia: 15000, cerradaManual: false, saldadaPor: null };
    rendicionesCache = { rAdmin: { ...rAdmin }, rCapataz: { ...rCapataz } };
    rendicionesIndex = [
      { id: "rAdmin", numero: 1, usuario: "", obra: "ObraTest", responsable: "Juan", totalGastos: 0, totalCaja: 80000, diferencia: 80000, cerradaManual: false, saldadaPor: null },
      { id: "rCapataz", numero: 2, usuario: "capataz1", obra: "ObraTest", responsable: "Pedro", totalGastos: 0, totalCaja: 15000, diferencia: 15000, cerradaManual: false, saldadaPor: null },
    ];

    await quitarUsuario("capataz1");

    const detalleMigrada = await cargarRendicionDetalle("rCapataz");
    return {
      usuarioQuedoVacio: detalleMigrada.usuario === "",
      saldoAnteriorReencadenado: detalleMigrada.saldoAnterior, // debería ser 80000 (la diferencia de rAdmin), no 5000
      totalCajaReencadenado: detalleMigrada.totalCaja, // 80000+10000
      diferenciaReencadenada: detalleMigrada.diferencia, // 90000-0
      indiceActualizado: rendicionesIndex.find(r => r.id === "rCapataz").diferencia,
    };
  });

  // ---- 2) eliminarRendicion: borrar la MÁS VIEJA de una caja reinicia el saldoAnterior de la nueva primera ----
  const r2 = await page.evaluate(async () => {
    const rViejaUno = { id: "v1", numero: 1, usuario: "admin", obra: "ObraTest", responsable: "Juan", mes: "Enero", quincena: "1ra Quincena", semana: "",
      saldoAnterior: 0, gastos: [], fondo: [{ detalle: "Reposición", monto: 50000 }],
      totalGastos: 0, totalCaja: 50000, diferencia: 50000, cerradaManual: false, saldadaPor: null };
    const rViejaDos = { id: "v2", numero: 2, usuario: "admin", obra: "ObraTest", responsable: "Juan", mes: "Enero", quincena: "2da Quincena", semana: "",
      saldoAnterior: 50000, gastos: [], fondo: [{ detalle: "Reposición", monto: 20000 }], // encadenado contra v1
      totalGastos: 0, totalCaja: 70000, diferencia: 70000, cerradaManual: false, saldadaPor: null };
    rendicionesCache = { v1: { ...rViejaUno }, v2: { ...rViejaDos } };
    rendicionesIndex = [
      { id: "v1", numero: 1, usuario: "admin", obra: "ObraTest", responsable: "Juan", totalGastos: 0, totalCaja: 50000, diferencia: 50000, cerradaManual: false, saldadaPor: null },
      { id: "v2", numero: 2, usuario: "admin", obra: "ObraTest", responsable: "Juan", totalGastos: 0, totalCaja: 70000, diferencia: 70000, cerradaManual: false, saldadaPor: null },
    ];
    correlativoCajaSiguiente = 3;
    rendicionAbiertoId = "v1"; // se borra la N°1, la MÁS VIEJA de la caja

    const toasts = [];
    const toastOriginal = window.showToast;
    window.showToast = (msg) => { toasts.push(msg); };
    await eliminarRendicion();
    window.showToast = toastOriginal;

    const detalleNuevaPrimera = await cargarRendicionDetalle("v2");
    return {
      saldoAnteriorNuevaPrimera: detalleNuevaPrimera.saldoAnterior, // debería quedar en 0, no 50000 (huérfano)
      totalCajaNuevaPrimera: detalleNuevaPrimera.totalCaja, // 0+20000
      diferenciaNuevaPrimera: detalleNuevaPrimera.diferencia,
      huboAvisoDeRevision: toasts.some(t => /saldo anterior/i.test(t) && /revisalo/i.test(t)),
    };
  });

  // ---- 3) Permisos: las 5 funciones exigen rol admin ----
  const r3 = await page.evaluate(async () => {
    sesionActual = { username: "capataz1", role: "capataz", permisos: { presupuesto: true, certificados: true, minutas: true, remitos: true } };
    const toasts = [];
    const toastOriginal = window.showToast;
    window.showToast = (msg) => { toasts.push(msg); };

    presupuestoItems = [{ rubro: 1, rubroNombre: "R", nombre: "Item", precioConCoef: 100 }];
    await eliminarPresupuestoObra();
    const presupuestoSigueIntacto = presupuestoItems.length === 1;

    contratistasIndex = [{ id: "c1", nombre: "Contratista X" }];
    contratistaAbiertoId = "c1";
    await eliminarContratista();
    const contratistaSigueIntacto = contratistasIndex.length === 1;

    contratistasCache = { c1: { id: "c1", nombre: "Contratista X", certificados: [{ numero: 1 }] } };
    await eliminarCertificado("c1", 0);
    const certificadoSigueIntacto = contratistasCache.c1.certificados.length === 1;

    minutasIndex = [{ id: "m1", numero: 1, obra: "ObraTest" }];
    await eliminarMinuta("m1");
    const minutaSigueIntacta = minutasIndex.length === 1;

    remitosIndex = [{ id: "r1", numero: 1, obra: "ObraTest" }];
    await eliminarRemito("r1");
    const remitoSigueIntacto = remitosIndex.length === 1;

    window.showToast = toastOriginal;
    const todosLosToastsSonDeSoloAdmin = toasts.length === 5 && toasts.every(t => /solo.*Administrador/i.test(t));
    return { presupuestoSigueIntacto, contratistaSigueIntacto, certificadoSigueIntacto, minutaSigueIntacta, remitoSigueIntacto, todosLosToastsSonDeSoloAdmin, cantidadToasts: toasts.length };
  });

  console.log("Resultado:", JSON.stringify({ r1, r2, r3 }, null, 2));

  const fallas = [];
  if (!r1.usuarioQuedoVacio) fallas.push("BUG: quitarUsuario no reasignó la rendición migrada al Administrador");
  if (r1.saldoAnteriorReencadenado !== 80000) fallas.push(`BUG REAL: quitarUsuario no reencadenó el saldoAnterior de la rendición migrada -- debería ser 80000 (la diferencia del Admin), dio ${r1.saldoAnteriorReencadenado}`);
  if (r1.totalCajaReencadenado !== 90000) fallas.push(`BUG: totalCaja debería ser 90000 (80000+10000 de fondo), dio ${r1.totalCajaReencadenado}`);
  if (r1.diferenciaReencadenada !== 90000) fallas.push(`BUG: diferencia debería ser 90000, dio ${r1.diferenciaReencadenada}`);
  if (r1.indiceActualizado !== 90000) fallas.push(`BUG: el índice (rendicionesIndex) no quedó sincronizado con el detalle, dio ${r1.indiceActualizado}`);

  if (r2.saldoAnteriorNuevaPrimera !== 0) fallas.push(`BUG REPRODUCIDO: al borrar la rendición más vieja, la que pasa a ser primera quedó con un saldoAnterior huérfano (${r2.saldoAnteriorNuevaPrimera}) en vez de reiniciarse a 0`);
  if (r2.totalCajaNuevaPrimera !== 20000) fallas.push(`BUG: totalCaja de la nueva primera debería ser 20000 (0+20000 de fondo), dio ${r2.totalCajaNuevaPrimera}`);
  if (r2.diferenciaNuevaPrimera !== 20000) fallas.push(`BUG: diferencia de la nueva primera debería ser 20000, dio ${r2.diferenciaNuevaPrimera}`);
  if (!r2.huboAvisoDeRevision) fallas.push("BUG: no se avisó al usuario que el saldo anterior de la nueva primera rendición se reinició y hay que revisarlo");

  if (!r3.presupuestoSigueIntacto) fallas.push("BUG REAL: un capataz con permiso de módulo (sin ser admin) pudo borrar el presupuesto de la obra");
  if (!r3.contratistaSigueIntacto) fallas.push("BUG REAL: un capataz con permiso de módulo pudo borrar un contratista");
  if (!r3.certificadoSigueIntacto) fallas.push("BUG REAL: un capataz con permiso de módulo pudo borrar un certificado");
  if (!r3.minutaSigueIntacta) fallas.push("BUG REAL: un capataz con permiso de módulo pudo borrar una minuta");
  if (!r3.remitoSigueIntacto) fallas.push("BUG REAL: un capataz con permiso de módulo pudo borrar un remito");
  if (!r3.todosLosToastsSonDeSoloAdmin) fallas.push(`BUG: no todos los intentos avisaron "solo del Administrador" (${r3.cantidadToasts} toasts)`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CAJA CHICA (REENCADENO) Y PERMISOS DE BORRADO OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
