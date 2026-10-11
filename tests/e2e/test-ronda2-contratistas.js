// Ronda 2 de auditoría -- Contratistas/Certificados: 6 arreglos.
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

    // ---- 1) Saldo pendiente negativo (sobrepago) debe marcarse "negativa", no "ok" ----
    const cSaldoNeg = {
      id: "cSaldo", nombre: "Contratista Saldo", obra: "ObraTest", montoContrato: 100000, anticipoMonto: 0, m2Total: null,
      items: [{ id: "i1", nombre: "Item 1", pctIncidencia: 100, m2: null, planoId: null, capaId: null }],
      certificados: [{ numero: 1, nombre: "CERTIFICADO 1", fecha: "2026-01-01", avances: { i1: 1.5 }, anotacion: "" }], // 150% cargado -> sobrepago
    };
    contratistasCache[cSaldoNeg.id] = cSaldoNeg;
    contratistaAbiertoId = cSaldoNeg.id;
    renderDetalleContratista(cSaldoNeg);
    const htmlDetalle = document.getElementById("view-detallecontratista") ? document.getElementById("view-detallecontratista").innerHTML : (document.getElementById("card-detalle-contratista") || document.body).innerHTML;
    const r1_marcadoNegativa = /rc-diferencia negativa/.test(htmlDetalle);
    const r1_noMarcadoOk = !/rc-diferencia ok"[^>]*>Saldo pendiente/.test(htmlDetalle);

    // ---- 2) Editar un contratista no debe borrar la "proyeccion" ya calculada ----
    contratistasIndex = [{ id: "cProy", nombre: "Contratista Proy", obra: "ObraTest", montoContrato: 100000, anticipoMonto: 0, m2Total: null, totalPagado: 0, saldoPendiente: 100000, pctConAnticipo: 0, ultimoCertNumero: 1, proyeccion: { terminado: false, diasHabilesFaltantes: 5, fechaProbableISO: "2026-06-01T00:00:00.000Z" } }];
    contratistasCache["cProy"] = { id: "cProy", nombre: "Contratista Proy", obra: "ObraTest", montoContrato: 100000, anticipoMonto: 0, m2Total: null, items: [{ id: "i1", nombre: "Item 1", pctIncidencia: 100, m2: null, planoId: null, capaId: null }], certificados: [{ numero: 1, fecha: "2026-01-01", avances: { i1: 0.3 }, anotacion: "" }] };
    contratistaEditandoId = "cProy";
    document.getElementById("cc-nombre").value = "Contratista Proy (editado)";
    document.getElementById("cc-obra").value = "ObraTest";
    document.getElementById("cc-monto").value = "100000";
    document.getElementById("cc-anticipo").value = "0";
    document.getElementById("cc-m2total").value = "";
    ccItems = [{ id: "i1", nombre: "Item 1", pctIncidencia: "100", m2: "" }];
    await guardarContratista();
    const r2_proyeccionSobrevive = !!(contratistasIndex.find(x => x.id === "cProy") || {}).proyeccion;

    // ---- 3) eliminarPlano() limpia item.planoId de los contratistas que lo usaban ----
    const planoId = "planoBorrado";
    contratistasIndex.push({ id: "cPlano", nombre: "Contratista Plano", obra: "ObraTest", montoContrato: 50000, anticipoMonto: 0, m2Total: null, totalPagado: 0, saldoPendiente: 50000, pctConAnticipo: 0, ultimoCertNumero: 0 });
    const cPlano = { id: "cPlano", nombre: "Contratista Plano", obra: "ObraTest", montoContrato: 50000, anticipoMonto: 0, items: [{ id: "ip1", nombre: "Item con plano", pctIncidencia: 100, planoId: planoId, capaId: null }], certificados: [{ numero: 1, fecha: "2026-01-01", avances: { ip1: 0.5 }, anotacion: "", planoId: planoId }] };
    contratistasCache["cPlano"] = cPlano;
    await window.storage.set("cert_contratista_cPlano", JSON.stringify(cPlano), true);
    planosIndex = [{ id: planoId, nombre: "Plano a borrar", obra: "ObraTest", contratistaId: null, contratistaNombre: null }];
    claveObraPlanoAvance = () => "ObraTest";
    planoActualId = null;
    await new Promise(resolve => {
      const fakeBtn = document.createElement("button");
      eliminarPlano(planoId, fakeBtn);
      // confirmarDobleToque dispara la acción real recién al "segundo toque" -- lo llamamos de nuevo.
      setTimeout(async () => { eliminarPlano(planoId, fakeBtn); await new Promise(r => setTimeout(r, 50)); resolve(); }, 20);
    });
    const contratistaTrasPlanoRaw = await window.storage.get("cert_contratista_cPlano", true);
    const contratistaTrasPlano = JSON.parse(contratistaTrasPlanoRaw.value);
    const r3_planoIdLimpio = contratistaTrasPlano.items[0].planoId === null;
    // Un certificado ya guardado puede tener su PROPIO planoId (independiente del ítem) -- también
    // debe quedar limpio, si no reeditarlo vuelve a escribir el id muerto en cada guardado.
    const r3b_certPlanoIdLimpio = contratistaTrasPlano.certificados[0].planoId === null;

    // ---- 4) eliminarContratista() desvincula los planos que lo tenían como "vinculado" ----
    contratistasIndex.push({ id: "cAEliminar", nombre: "Contratista a eliminar", obra: "ObraTest", montoContrato: 10000, anticipoMonto: 0, m2Total: null, totalPagado: 0, saldoPendiente: 10000, pctConAnticipo: 0, ultimoCertNumero: 0 });
    await window.storage.set("cert_contratista_cAEliminar", JSON.stringify({ id: "cAEliminar", certificados: [] }), true);
    planosIndex.push({ id: "planoVinculado", nombre: "Plano vinculado", obra: "ObraTest", contratistaId: "cAEliminar", contratistaNombre: "Contratista a eliminar" });
    contratistaAbiertoId = "cAEliminar";
    await eliminarContratista();
    const r4_planoDesvinculado = planosIndex.find(p => p.id === "planoVinculado").contratistaId === null;

    // ---- 5) Editar un certificado y cambiar de plano borra el hito en el plano VIEJO ----
    const obraCert = "ObraTest";
    const cCert = {
      id: "cCert", nombre: "Contratista Cert", obra: obraCert, montoContrato: 200000, anticipoMonto: 0,
      items: [{ id: "ic1", nombre: "Item cert", pctIncidencia: 100, planoId: null, capaId: null }],
      certificados: [{ numero: 1, nombre: "CERTIFICADO 1", fecha: "2026-01-01", avances: { ic1: 0.3 }, anotacion: "", planoId: "planoViejo" }],
    };
    contratistasCache["cCert"] = cCert;
    contratistasIndex.push({ id: "cCert", nombre: "Contratista Cert", obra: obraCert, montoContrato: 200000, anticipoMonto: 0, m2Total: null, totalPagado: 0, saldoPendiente: 200000, pctConAnticipo: 0, ultimoCertNumero: 1 });
    await window.storage.set(`plano_avance_snapshots_${obraCert}_planoViejo`, JSON.stringify([{ id: "s1", fecha: "2026-01-01", etiqueta: "Certificado N° 1", tipo: "certificado", claveUnica: "cert_cCert_1", porcentajes: [] }]), true);
    contratistaParaCertificarId = "cCert";
    certificadoEditandoIndex = 0;
    certFormItems = [{ itemId: "ic1", nombre: "Item cert", pctAnterior: 0, pctAcumulado: 0.3, montoItem: 200000 }];
    certFormPlanoIdUsado = "planoNuevo"; // se cambió de plano al editar
    certFormPlanoImagenSnapshot = null;
    document.getElementById("cf-fecha").value = "2026-01-15";
    document.getElementById("cf-anotacion").value = "";
    await guardarCertificadoConfirmado();
    const snapViejoRaw = await window.storage.get(`plano_avance_snapshots_${obraCert}_planoViejo`, true);
    const snapViejo = JSON.parse(snapViejoRaw.value);
    const r5_hitoViejoBorrado = !snapViejo.some(s => s.claveUnica === "cert_cCert_1");

    // ---- 6) Fecha fuera de orden HACIA ADELANTE (editar el N°1 con una fecha posterior al N°2) ----
    const cOrden = {
      id: "cOrden", nombre: "Contratista Orden", obra: "ObraTest", montoContrato: 100000, anticipoMonto: 0,
      items: [{ id: "io1", nombre: "Item orden", pctIncidencia: 100 }],
      certificados: [
        { numero: 1, fecha: "2026-01-01", avances: { io1: 0.2 }, anotacion: "" },
        { numero: 2, fecha: "2026-02-01", avances: { io1: 0.5 }, anotacion: "" },
      ],
    };
    contratistasCache["cOrden"] = cOrden;
    contratistaParaCertificarId = "cOrden";
    certificadoEditandoIndex = 0; // se edita el N°1
    certFormItems = [{ itemId: "io1", nombre: "Item orden", pctAnterior: 0, pctAcumulado: 0.2, montoItem: 100000 }];
    document.getElementById("cf-fecha").value = "2026-04-15"; // posterior al N°2 (2026-02-01)
    const fakeBtnOrden = document.createElement("button");
    fakeBtnOrden.textContent = "Guardar";
    guardarCertificado(fakeBtnOrden);
    const r6_pidioConfirmacion = fakeBtnOrden.dataset.confirmando === "1";
    const r6_noGuardoTodavia = cOrden.certificados[0].fecha === "2026-01-01"; // no se tocó sin confirmar

    return {
      r1_marcadoNegativa, r1_noMarcadoOk,
      r2_proyeccionSobrevive,
      r3_planoIdLimpio, r3b_certPlanoIdLimpio,
      r4_planoDesvinculado,
      r5_hitoViejoBorrado,
      r6_pidioConfirmacion, r6_noGuardoTodavia,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_marcadoNegativa) fallas.push("BUG REPRODUCIDO: un saldo pendiente negativo (sobrepago) debería marcarse con la clase 'negativa'");
  if (!resultado.r1_noMarcadoOk) fallas.push("BUG REPRODUCIDO: un saldo pendiente negativo no debería marcarse como 'ok'");
  if (!resultado.r2_proyeccionSobrevive) fallas.push("BUG REPRODUCIDO: editar un contratista no debería borrar su 'proyeccion' ya calculada");
  if (!resultado.r3_planoIdLimpio) fallas.push("BUG REPRODUCIDO: eliminarPlano() debería limpiar planoId de los ítems de contrato que lo usaban");
  if (!resultado.r3b_certPlanoIdLimpio) fallas.push("BUG REPRODUCIDO: eliminarPlano() debería limpiar planoId también en los CERTIFICADOS ya guardados que lo usaban (no solo en los ítems de contrato)");
  if (!resultado.r4_planoDesvinculado) fallas.push("BUG REPRODUCIDO: eliminarContratista() debería desvincular los planos que lo tenían como 'vinculado'");
  if (!resultado.r5_hitoViejoBorrado) fallas.push("BUG REPRODUCIDO: editar un certificado y cambiar de plano debería borrar el hito en el plano viejo");
  if (!resultado.r6_pidioConfirmacion) fallas.push("BUG REPRODUCIDO: una fecha fuera de orden HACIA ADELANTE (contra el certificado siguiente) debería pedir confirmación");
  if (!resultado.r6_noGuardoTodavia) fallas.push("No debería haberse guardado el cambio de fecha sin la confirmación");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CONTRATISTAS/CERTIFICADOS (RONDA 2) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
