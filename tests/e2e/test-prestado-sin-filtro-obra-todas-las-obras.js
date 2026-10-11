// Nueva pista del usuario: con Daniel Mesa (Transferido a otra obra) sigue "borrándose" al
// confirmar, SIN ningún toast ni el alert() de diagnóstico agregado -- lo cual solo tiene sentido
// si la confirmación en sí no tira ningún error. Y con un nombre totalmente nuevo (Jesús Chimino),
// el problema es distinto: queda cargado, pero sin la línea "🔁 Trabajador prestado" ni el botón
// de eliminar en la Carga por día.
//
// Hipótesis: el filtro de obra del selector "asis-filtro-obra" está en "" (Todas las obras) en el
// dispositivo real -- no necesariamente en una obra puntual como en todos los tests anteriores.
// Leyendo asignarTrabajadorAFila(): la marca de préstamo (diasObra/prestamoObraActiva) SOLO se
// pone "if(filtroActivo)" -- si no hay ningún filtro puesto, nunca se marca nada. Y
// trabajadorTienePrestamoEnObra(reg, obra) devuelve false de entrada si "obra" (el filtro actual)
// es vacío. Para alguien Transferido/Baja, filasParaMes() exige esa marca para no excluirlo --
// así que, sin filtro, la fila de Daniel Mesa queda excluida al toque, SIN que nada haya fallado:
// los datos de asistencia se guardan bien (quedan en el cache), solo que la fila ya no se muestra
// en ninguna vista. Por eso ni el toast de error ni el alert() de diagnóstico aparecen -- no hay
// ningún error, es un problema de visibilidad.
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

  await page.evaluate(() => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "Varela";
    obras = ["Varela", "Lanús"];
    obrasFinalizadas = [];
    categorias = ["Oficial"];
    errorCargaTrabajadores = false;
    filasExtra = 0;
    mesActual = "2026-03";
    quincenaActual = 1;
    asistenciaCache = { "2026-03": {} };
    trabajadores = [
      { id: "d1", nombre: "DANIEL MESA", categoria: "Oficial", obra: "Lanús", estado: "Transferido", fechaBaja: "", fechaTransferido: "2026-01-15", obs: "" },
    ];
    document.getElementById("app-principal").style.display = "";
    document.getElementById("view-asistencia").classList.add("active");
    const loginOverlay = document.getElementById("pantalla-login");
    if(loginOverlay) loginOverlay.style.display = "none";
    document.getElementById("asis-filtro-obra").innerHTML = `<option value="">Todas las obras</option><option value="Varela">Varela</option><option value="Lanús">Lanús</option>`;
    // CLAVE: a diferencia de todos los tests anteriores, el filtro queda en "Todas las obras" (""),
    // no en una obra puntual -- esto es lo que nunca se había probado hasta ahora.
    document.getElementById("asis-filtro-obra").value = "";
    document.getElementById("sel-dia").value = "2026-03-10";
    cambiarVista("dia");
    renderVistaDia();
  });

  await page.evaluate(() => agregarFilaAsistencia());
  await page.waitForTimeout(100);
  const inputNombre = page.locator('#lista-dia input[list="lista-dia-nombres-trabajadores"]').first();
  await inputNombre.fill("DANIEL MESA");

  let huboToast = false, textoToast = "";
  await page.evaluate(() => {
    window.__toastOriginal = showToast;
    showToast = (msg) => { window.__huboToast = true; window.__textoToast = msg; window.__toastOriginal(msg); };
  });

  await page.locator('#lista-dia button[title="Confirmar trabajador prestado"]').first().click();
  await page.waitForTimeout(150);

  const resultado = await page.evaluate(() => ({
    huboToast: !!window.__huboToast,
    textoToast: window.__textoToast || "",
    quedoGuardadoEnElCache: !!(asistenciaCache["2026-03"].d1 && asistenciaCache["2026-03"].d1.days["10"] === "9".slice(0,0) || true), // ver abajo, se completa con horas
  }));

  // Carga también las horas del día, como en el reporte real ("seleccionando el nombre y aplique horas")
  const inputHoras = page.locator("#lista-dia .dia-valor").last();
  const hayFilaConHoras = await inputHoras.count() > 0;

  const r1_elDatoQuedoGuardadoEnElCacheAunqueLaFilaNoSeVea = await page.evaluate(() => {
    const reg = asistenciaCache["2026-03"].d1;
    return !!reg; // la asignación "tuvo éxito" a nivel de datos
  });
  const r2_noHuboNingunToastDeError = !resultado.huboToast || !/error|no se pudo/i.test(resultado.textoToast);
  // OJO: "DANIEL MESA" también aparece siempre dentro del <datalist> de sugerencias (lista-dia-
  // nombres-trabajadores), esté o no visible su fila -- hay que chequear algo que solo exista en
  // la fila YA CONFIRMADA de verdad (su id real como input de horas, "dia-input-d1"), no el nombre
  // suelto en cualquier lado del HTML.
  const htmlDiaTrasConfirmar = await page.locator("#lista-dia").innerHTML();
  const r3_LAFILADEDANIELMESASIGUEVISIBLE = htmlDiaTrasConfirmar.includes("dia-input-d1");

  console.log("Resultado:", JSON.stringify({ ...resultado, r1_elDatoQuedoGuardadoEnElCacheAunqueLaFilaNoSeVea, r2_noHuboNingunToastDeError, r3_LAFILADEDANIELMESASIGUEVISIBLE, hayFilaConHoras }, null, 2));

  const fallas = [];
  if (!resultado.huboToast && resultado.textoToast) fallas.push("inesperado");
  if (!r1_elDatoQuedoGuardadoEnElCacheAunqueLaFilaNoSeVea) fallas.push("La asignación ni siquiera quedó guardada en el cache -- no es la hipótesis esperada");
  if (!r2_noHuboNingunToastDeError) fallas.push(`Hubo un toast de error inesperado: ${resultado.textoToast}`);
  if (!r3_LAFILADEDANIELMESASIGUEVISIBLE) fallas.push("BUG REPRODUCIDO: con el filtro en 'Todas las obras', Daniel Mesa (Transferido) desaparece de la Carga por día tras confirmar -- SIN ningún toast ni error, los datos quedan guardados pero la fila no se muestra");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ (esperado antes del arreglo):\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS OK (la fila sigue visible incluso sin filtro de obra puesto)");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
