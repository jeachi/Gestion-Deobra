// Caso real reportado: N°0011 con diferencia -50.100 y N°0012 con diferencia -71.704 (ninguna de
// las dos "saldada" todavía -- ninguna reposición terminó de cubrir nada). Antes del fix, AMBAS se
// mostraban como "abierta/pendiente" en la lista, lo cual hace parecer que se deben $50.100 + $71.704
// por separado, cuando en realidad la N°12 YA INCLUYE el arrastre de la N°11 en su saldo anterior --
// es una sola deuda de $71.704, no dos. Solo la ÚLTIMA rendición de cada caja debería figurar como
// "pendiente"; las anteriores, aunque nadie las haya saldado todavía, deben aparecer como cerradas
// (con la leyenda "Saldada (cubierta por N° X)") porque su saldo ya no vive ahí sino en la más nueva.
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
    obraPredeterminada = "VARELA";
    obras = ["VARELA"];
    obrasFinalizadas = [];
    irA("caja");
  });

  const resultado = await page.evaluate(async () => {
    rendicionesIndex = [];
    rendicionesCache = {};
    correlativoCajaSiguiente = 11;

    document.getElementById("rc-obra").innerHTML = `<option value="VARELA">VARELA</option>`;

    async function crear(saldoAnterior, montoFondo, montoGasto) {
      cambiarVistaCaja("nueva");
      document.getElementById("rc-obra").value = "VARELA";
      document.getElementById("rc-responsable").value = "JESUS CHIMINO";
      document.getElementById("rc-saldo-anterior").value = saldoAnterior;
      rcFondo = [{ detalle: "Entrega", monto: montoFondo }];
      rcGastos = montoGasto ? [{ fecha: "2026-09-01", ticket: "", tipoCosto: "", observaciones: "Gasto", centroCosto: "", monto: montoGasto }] : [];
      await guardarRendicion();
    }

    // N°11: recibe 150.100, gasta 200.200 -> diferencia -50.100 (como en la captura).
    await crear(0, 150100, 200200);
    // N°12: arrastra -50.100, recibe 100.000, gasta 121.604 -> diferencia -71.704 (como en la captura).
    await crear(-50100, 100000, 121604);

    renderListaRendiciones();
    const html = document.getElementById("lista-rendiciones").innerHTML;

    const porNumero = {};
    rendicionesIndex.forEach(r => { porNumero[r.numero] = r; });

    return {
      html,
      once: { cerrada: estaRendicionCerrada(porNumero[11]), diferencia: porNumero[11].diferencia },
      doce: { cerrada: estaRendicionCerrada(porNumero[12]), diferencia: porNumero[12].diferencia },
    };
  });

  console.log("Resultado:", JSON.stringify({ once: resultado.once, doce: resultado.doce }, null, 2));
  console.log("Errores de página:", JSON.stringify(pageErrors));

  const fallas = [];
  if (Math.abs(resultado.once.diferencia - (-50100)) > 1) fallas.push(`La N°11 debería tener diferencia -50.100, dio ${resultado.once.diferencia}`);
  if (Math.abs(resultado.doce.diferencia - (-71704)) > 1) fallas.push(`La N°12 debería tener diferencia -71.704, dio ${resultado.doce.diferencia}`);

  if (!resultado.once.cerrada) fallas.push("BUG REPRODUCIDO: la N°11 sigue apareciendo como pendiente/abierta aunque ya no es la última rendición de la caja (su saldo ya se trasladó a la N°12)");
  if (resultado.doce.cerrada) fallas.push("La N°12 (la más reciente, con la deuda real vigente) NO debería aparecer como cerrada");

  if (!resultado.html.includes("Saldada (cubierta por N° 0012)")) fallas.push('La N°11 debería mostrar la leyenda "Saldada (cubierta por N° 0012)" en la lista');
  if (!resultado.html.includes("Diferencia -$71.704,00") && !resultado.html.includes("Diferencia -$71.704,0")) {
    // tolerante a redondeo de centavos en el formateo
    if (!/Diferencia -\$71\.704/.test(resultado.html)) fallas.push("La N°12 debería seguir mostrando su diferencia real (-$71.704) como pendiente");
  }

  if (pageErrors.length) fallas.push(`${pageErrors.length} error(es) de página sin atrapar`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE 'NO DOBLE CONTEO DE DEUDA EN CAJA CHICA' OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
