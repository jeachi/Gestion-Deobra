// Pedido del usuario: "selecciono al trabajador prestado y desaparece por completo de la Carga por
// día" -- bug real, de la MISMA familia que el ya arreglado para "Transferido" (ver
// test-prestamo-de-trabajador-transferido.js), pero esta vez para un trabajador dado de BAJA.
//
// Causa real: filasParaMes() cortaba a un trabajador de BAJA, a partir del mes siguiente a su baja,
// SIN mirar si ese día puntual había quedado marcado como préstamo (reg.diasObra). Asignarlo desde
// "Agregar trabajador prestado" marcaba bien el día por dentro, pero la fila desaparecía igual al
// toque -- el chequeo de "Baja" cortaba ANTES de llegar al chequeo de más abajo que sí entiende los
// préstamos (el mismo patrón de bug que ya se encontró y arregló para "Transferido").
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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

  const resultado = await page.evaluate(() => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "VARELA";
    obras = ["VARELA", "LANUS"];
    obrasFinalizadas = [];
    categorias = ["Oficial"];
    errorCargaTrabajadores = false;
    actividadLog = [];
    filasExtra = 0;
    mesActual = "2026-10";
    quincenaActual = 1;
    asistenciaCache = { "2026-09": {}, "2026-10": {} };

    // Pedro quedó de BAJA en septiembre (mes anterior) -- en octubre ya no debería verse solo.
    trabajadores = [
      { id: "t1", nombre: "Pedro Baja", categoria: "Oficial", obra: "LANUS", estado: "Baja", fechaBaja: "2026-09-15", obs: "" },
    ];

    document.getElementById("asis-filtro-obra").innerHTML = `<option value="">Todas las obras</option><option value="VARELA">VARELA</option><option value="LANUS">LANUS</option>`;
    document.getElementById("asis-filtro-obra").value = "VARELA"; // el capataz de VARELA lo recibe prestado
    document.getElementById("sel-dia").value = "2026-10-05";
    renderVistaDia();

    // Antes de agregarlo: dado de baja, no debería verse en VARELA (nunca trabajó ahí).
    const r0_noApareceAntesDeAgregarlo = !filasParaMes("2026-10").some(f => f.id === "t1");

    // ---- 1) Lo agrego como préstamo puntual a VARELA (día 5) ----
    agregarFilaAsistencia();
    asignarTrabajadorAFila("extra_0", "t1", 5);
    const reg = asistenciaCache["2026-10"].t1;
    const r1_quedoMarcadoComoPrestamo = !!(reg.diasObra && reg.diasObra["5"] === "VARELA");

    // ---- 2) BUG REPRODUCIDO: ahora SÍ debería aparecer en la pestaña por día, filtrando VARELA ----
    const r2_apareceEnFilasParaMes = filasParaMes("2026-10").some(f => f.id === "t1");
    renderVistaDia();
    const r2_apareceEnLaListaDia = Array.from(document.querySelectorAll("#lista-dia .dia-fila-v2")).some(f => f.textContent.includes("Pedro Baja"));
    const htmlListaDia = document.getElementById("lista-dia").innerHTML;
    const r2_muestraElAvisoDePrestamo = htmlListaDia.includes("Trabajador prestado");

    // ---- 3) Tiene la "×" para poder sacarlo después ----
    const r3_tieneLaX = htmlListaDia.includes("quitarFila('t1')");

    // ---- 4) Pasado el mes del trabajito (sin ningún día marcado ese mes nuevo), vuelve a quedar
    // oculto solo, sin tocar nada a mano ----
    const r4_noApareceElMesSiguiente = !filasParaMes("2026-11").some(f => f.id === "t1");

    return {
      r0_noApareceAntesDeAgregarlo,
      r1_quedoMarcadoComoPrestamo,
      r2_apareceEnFilasParaMes, r2_apareceEnLaListaDia, r2_muestraElAvisoDePrestamo,
      r3_tieneLaX,
      r4_noApareceElMesSiguiente,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r0_noApareceAntesDeAgregarlo) fallas.push("Un trabajador de baja, sin ningún préstamo marcado, no debería verse en una obra donde nunca trabajó");
  if (!resultado.r1_quedoMarcadoComoPrestamo) fallas.push("Asignarlo a la obra del filtro activo debería marcar el día como préstamo a esa obra");
  if (!resultado.r2_apareceEnFilasParaMes) fallas.push("BUG REPRODUCIDO: un trabajador de BAJA con un préstamo puntual a otra obra debería aparecer en esa obra");
  if (!resultado.r2_apareceEnLaListaDia) fallas.push("BUG REPRODUCIDO: debería aparecer en la Carga por día (el reporte real del usuario: 'selecciono y desaparece por completo')");
  if (!resultado.r2_muestraElAvisoDePrestamo) fallas.push("Debería mostrar el aviso 'Trabajador prestado'");
  if (!resultado.r3_tieneLaX) fallas.push("BUG REPRODUCIDO: debería tener la '×' para poder sacarlo después de que termine el trabajo");
  if (!resultado.r4_noApareceElMesSiguiente) fallas.push("Pasado el mes del trabajito (sin ningún día marcado ese mes nuevo), no debería seguir apareciendo solo");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PRÉSTAMO DE UN TRABAJADOR DADO DE BAJA OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
