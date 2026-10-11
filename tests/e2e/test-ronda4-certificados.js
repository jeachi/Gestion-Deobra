// Ronda 4 de auditoría -- Certificados/Dashboard: 3 arreglos.
// 1) actualizarFilaCertForm no clampaba pctAcumulado a [0,1] (un tipeo de más -> % > 100%, saldo negativo).
// 2) Los m² ejecutados (Dashboard, lista, detalle) usaban pctConAnticipo (financiero) en vez de
//    pctSinAnticipo (físico) -- un contratista con anticipo pero SIN certificados mostraba m² ejecutados.
// 3) El widget "Avance de contratistas" del Dashboard no truncaba su lista, a diferencia del resto.
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

    // ---- 1) actualizarFilaCertForm clampa a [0,1] ----
    certFormItems = [{ itemId: "it1", nombre: "Item 1", pctIncidencia: 100, montoItem: 1000, pctAnterior: 0, pctAcumulado: 0 }];
    // Simulamos el DOM mínimo que actualizarValoresFilaCertForm necesita tocar.
    document.body.insertAdjacentHTML("beforeend", `
      <span id="cf-periodo-0"></span><span id="cf-acum-0"></span><span id="cf-saldo-0"></span>
      <input id="cf-input-0"><span id="cf-aviso-0" style="display:none;"></span>
    `);
    actualizarFilaCertForm(0, "150"); // tipeo de más: "150" en vez de "15,0"
    const r1_clampeadoA1 = certFormItems[0].pctAcumulado === 1;

    actualizarFilaCertForm(0, "-20"); // tipeo raro: negativo
    const r1_clampeadoA0 = certFormItems[0].pctAcumulado === 0;

    // ---- 2) m² ejecutados usa pctSinAnticipo, no pctConAnticipo ----
    // Contratista con 30% de anticipo pagado pero CERO certificados cargados todavía.
    const c = {
      id: "cUno", nombre: "Contratista Uno", obra: "ObraTest",
      montoContrato: 10000000, anticipoMonto: 3000000, m2Total: 500,
      items: [{ id: "it1", nombre: "Item único", pctIncidencia: 100 }],
      certificados: [], // sin certificados todavía
    };
    const r = calcularCertificadosDetallados(c);
    const r2_pctConAnticipoEs30 = Math.abs(r.pctConAnticipo - 0.30) < 0.001;
    const r2_pctSinAnticipoEs0 = r.pctSinAnticipo === 0;

    contratistasIndex = [{ id: c.id, nombre: c.nombre, obra: c.obra, montoContrato: c.montoContrato, anticipoMonto: c.anticipoMonto,
      m2Total: c.m2Total, totalPagado: r.totalPagado, saldoPendiente: r.saldoPendiente,
      pctConAnticipo: r.pctConAnticipo, pctSinAnticipo: r.pctSinAnticipo, ultimoCertNumero: 0 }];
    document.getElementById("cert-buscar").value = "";
    renderListaContratistas();
    const htmlLista = document.getElementById("lista-contratistas").innerHTML;
    const r2_listaNoMuestra150m2 = !htmlLista.includes("150 m² de 500");
    const r2_listaMuestra0m2 = htmlLista.includes("0 m² de 500");

    dashboardObraFiltro = "";
    renderDashboard();
    const htmlDash = document.getElementById("dash-contratistas").innerHTML;
    const r2_dashNoMuestra150m2 = !htmlDash.includes("150 m²</div>");
    const r2_dashMuestra0m2 = htmlDash.includes("0 m²</div>");

    // ---- 3) El Dashboard trunca la lista de contratistas activos a 5, con un "+N más" ----
    contratistasIndex = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`, nombre: `Contratista ${i}`, obra: "ObraTest", montoContrato: 1000000, anticipoMonto: 0,
      m2Total: 0, totalPagado: 0, saldoPendiente: 1000000, pctConAnticipo: 0.1, pctSinAnticipo: 0.1, ultimoCertNumero: 1,
    }));
    renderDashboard();
    const htmlDash8 = document.getElementById("dash-contratistas").innerHTML;
    const cantidadBloques = (htmlDash8.match(/dash-contratista-bloque/g) || []).length;
    const r3_truncaA5 = cantidadBloques === 5;
    const r3_muestraAvisoMas = /\+3 contratistas más/.test(htmlDash8);

    return { r1_clampeadoA1, r1_clampeadoA0, r2_pctConAnticipoEs30, r2_pctSinAnticipoEs0, r2_listaNoMuestra150m2, r2_listaMuestra0m2, r2_dashNoMuestra150m2, r2_dashMuestra0m2, r3_truncaA5, r3_muestraAvisoMas };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_clampeadoA1) fallas.push("BUG REPRODUCIDO: actualizarFilaCertForm debería clampar un valor > 100 a pctAcumulado=1");
  if (!resultado.r1_clampeadoA0) fallas.push("BUG REPRODUCIDO: actualizarFilaCertForm debería clampar un valor negativo a pctAcumulado=0");
  if (!resultado.r2_pctConAnticipoEs30) fallas.push("calcularCertificadosDetallados: pctConAnticipo debería dar 0.30 con el anticipo cargado");
  if (!resultado.r2_pctSinAnticipoEs0) fallas.push("calcularCertificadosDetallados: pctSinAnticipo debería dar 0 sin certificados cargados");
  if (!resultado.r2_listaNoMuestra150m2) fallas.push("BUG REPRODUCIDO: la lista de contratistas no debería mostrar m² ejecutados por el % del anticipo (150 m²) sin certificados");
  if (!resultado.r2_listaMuestra0m2) fallas.push("La lista debería mostrar 0 m² ejecutados (físico) cuando no hay certificados, aunque haya anticipo");
  if (!resultado.r2_dashNoMuestra150m2) fallas.push("BUG REPRODUCIDO: el widget del Dashboard no debería mostrar 150 m² ejecutados por el % del anticipo sin certificados");
  if (!resultado.r2_dashMuestra0m2) fallas.push("El widget del Dashboard debería mostrar 0 m² ejecutados (físico) cuando no hay certificados");
  if (!resultado.r3_truncaA5) fallas.push("BUG REPRODUCIDO: el widget de Avance de contratistas del Dashboard debería truncar a 5, como el resto del Dashboard");
  if (!resultado.r3_muestraAvisoMas) fallas.push("Debería mostrarse un aviso '+3 contratistas más' cuando se trunca la lista");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CERTIFICADOS/DASHBOARD (RONDA 4) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
