// Pedido del usuario (caso real, bug importante): "Daniel Mesa fue transferido a obra Lanús pero
// viene 2 días a hacer un trabajo a Varela -- cuando lo agregué no salió en la pestaña por día ni
// sale el botón de x para eliminar, [debería aparecer] luego de la quincena que termine el trabajo
// o [poder] ocultarlo".
//
// Causa real: filasParaMes() tenía DOS chequeos de exclusión en cascada. El de "Transferido" corre
// PRIMERO y no sabía nada de los préstamos (reg.diasObra) -- si la obra del filtro activo no era ni
// la vieja del trabajador ni la nueva (post-transferencia), lo cortaba ahí mismo, ANTES de llegar al
// chequeo de más abajo que sí entiende los préstamos. Resultado: el préstamo quedaba guardado en
// asistenciaCache (con diasObra correctamente marcado) pero invisible en cualquier vista -- no
// aparecía la fila, ni el aviso "Trabajador prestado", ni la "×" para sacarlo después de la quincena.
//
// Este caso es distinto del que ya se arregló antes (alguien ACTIVO de otra obra, prestado) porque
// acá el trabajador está en estado "Transferido" (no "Activo"), lo que dispara el primer chequeo que
// no conocía los préstamos.
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

  const resultado = await page.evaluate(() => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "Varela";
    obras = ["Varela", "Lanús"];
    obrasFinalizadas = [];
    categorias = ["Oficial"];
    errorCargaTrabajadores = false;
    actividadLog = [];
    filasExtra = 0;
    mesActual = "2026-03";
    quincenaActual = 1;
    asistenciaCache = { "2026-02": {}, "2026-03": {} };

    // Daniel fue transferido a Lanús en enero -- ya no es de Varela desde entonces.
    trabajadores = [
      { id: "d1", nombre: "Daniel Mesa", categoria: "Oficial", obra: "Lanús", estado: "Transferido", fechaBaja: "", fechaTransferido: "2026-01-15", obs: "" },
    ];

    document.getElementById("asis-filtro-obra").innerHTML = `<option value="">Todas las obras</option><option value="Varela">Varela</option><option value="Lanús">Lanús</option>`;
    document.getElementById("asis-filtro-obra").value = "Varela"; // el capataz de Varela lo recibe dos días
    document.getElementById("sel-dia").value = "2026-03-10";
    renderVistaDia();

    // Antes de agregarlo: filtrando por Varela, Daniel (transferido a Lanús) no debería verse --
    // esto confirma que el chequeo de "Transferido" sigue funcionando para el caso normal.
    const r0_noApareceAntesDeAgregarlo = !filasParaMes("2026-03").some(f => f.id === "d1");

    // ---- 1) Lo agrego como préstamo puntual a Varela (día 10) ----
    agregarFilaAsistencia();
    asignarTrabajadorAFila("extra_0", "d1", 10);
    const reg = asistenciaCache["2026-03"].d1;
    const r1_quedoMarcadoComoPrestamoAVarela = !!(reg.diasObra && reg.diasObra["10"] === "Varela");
    const r1_laObraDeBaseSigueSiendoLanus = reg.obra === "Lanús";

    // ---- 2) BUG REPRODUCIDO: ahora SÍ debería aparecer en la pestaña por día, filtrando Varela ----
    const r2_apareceEnFilasParaMes = filasParaMes("2026-03").some(f => f.id === "d1");
    renderVistaDia();
    const htmlListaDia = document.getElementById("lista-dia").innerHTML;
    // OJO: "Daniel Mesa" como texto suelto también aparece en el <datalist> compartido de
    // sugerencias (lista TODOS los nombres, estén o no visibles) -- por eso se busca puntualmente
    // una fila (.dia-fila-v2) con su nombre, no cualquier mención en el HTML entero.
    const r2_apareceEnLaListaDia = Array.from(document.querySelectorAll("#lista-dia .dia-fila-v2")).some(f => f.textContent.includes("Daniel Mesa"));
    const r2_muestraElAvisoDePrestamo = htmlListaDia.includes("Trabajador prestado");

    // ---- 3) Tiene la "×" para poder sacarlo después de que termine el trabajo ----
    const r3_tieneLaX = htmlListaDia.includes("quitarFila('d1')");

    // ---- 4) El segundo día de trabajo (12) también se puede marcar, sin tocar el día 10 ----
    document.getElementById("sel-dia").value = "2026-03-12";
    renderVistaDia();
    agregarFilaAsistencia();
    asignarTrabajadorAFila("extra_0", "d1", 12);
    const regTrasSegundoDia = asistenciaCache["2026-03"].d1;
    const r4_diaDiezSigueMarcado = regTrasSegundoDia.diasObra["10"] === "Varela";
    const r4_diaDoceQuedoMarcado = regTrasSegundoDia.diasObra["12"] === "Varela";

    // ---- 5) Pasada la quincena/mes del trabajito (abril, sin ningún día marcado), Daniel deja de
    // aparecer solo otra vez en Varela -- ni hace falta tocar nada a mano ----
    const r5_noApareceElMesSiguiente = !filasParaMes("2026-04").some(f => f.id === "d1");

    // ---- 6) El capataz de la obra NUEVA (Lanús) lo sigue viendo sin problema, como siempre ----
    document.getElementById("asis-filtro-obra").value = "Lanús";
    const r6_loVeQuienLoRecibioDeVerdad = filasParaMes("2026-03").some(f => f.id === "d1");

    return {
      r0_noApareceAntesDeAgregarlo,
      r1_quedoMarcadoComoPrestamoAVarela, r1_laObraDeBaseSigueSiendoLanus,
      r2_apareceEnFilasParaMes, r2_apareceEnLaListaDia, r2_muestraElAvisoDePrestamo,
      r3_tieneLaX,
      r4_diaDiezSigueMarcado, r4_diaDoceQuedoMarcado,
      r5_noApareceElMesSiguiente,
      r6_loVeQuienLoRecibioDeVerdad,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r0_noApareceAntesDeAgregarlo) fallas.push("Un transferido, sin ningún préstamo marcado, no debería verse en la obra que ya no es la suya");
  if (!resultado.r1_quedoMarcadoComoPrestamoAVarela) fallas.push("Asignarlo a la obra del filtro activo debería marcar el día como préstamo a esa obra");
  if (!resultado.r1_laObraDeBaseSigueSiendoLanus) fallas.push("La obra de base (post-transferencia) no debería pisarse -- debería seguir siendo Lanús");
  if (!resultado.r2_apareceEnFilasParaMes) fallas.push("BUG REPRODUCIDO: un trabajador TRANSFERIDO con un préstamo puntual a otra obra debería aparecer en esa obra");
  if (!resultado.r2_apareceEnLaListaDia) fallas.push("BUG REPRODUCIDO: debería aparecer en la Carga por día");
  if (!resultado.r2_muestraElAvisoDePrestamo) fallas.push("Debería mostrar el aviso 'Trabajador prestado'");
  if (!resultado.r3_tieneLaX) fallas.push("BUG REPRODUCIDO: debería tener la '×' para poder sacarlo después de que termine el trabajo");
  if (!resultado.r4_diaDiezSigueMarcado) fallas.push("Marcar un segundo día de préstamo no debería borrar la marca del primero");
  if (!resultado.r4_diaDoceQuedoMarcado) fallas.push("El segundo día de trabajo también debería quedar marcado");
  if (!resultado.r5_noApareceElMesSiguiente) fallas.push("Pasado el mes del trabajito (sin ningún día marcado ese mes nuevo), no debería seguir apareciendo solo");
  if (!resultado.r6_loVeQuienLoRecibioDeVerdad) fallas.push("El capataz de la obra a la que fue transferido de verdad (Lanús) debería seguir viéndolo sin problema");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PRÉSTAMO DE UN TRABAJADOR TRANSFERIDO OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
