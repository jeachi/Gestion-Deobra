// cargarAsistenciaMes() devuelve el cache en memoria tal cual si ya existe -- no vuelve a leer de
// window.storage salvo que el cache de ese mes esté vacío. Eso significa que, dentro de la MISMA
// sesión del navegador, cambiar de día/quincena/pestaña no fuerza ninguna relectura real. Pero el
// capataz en la obra sí cierra y abre la app, pierde señal y reconecta, etc. -- ahí SÍ se vuelve a
// leer de verdad desde el storage guardado. Este test confirma que un préstamo recién confirmado,
// guardado de verdad (guardarAsistenciaMes, que serializa a JSON) y vuelto a leer de cero
// (borrando el cache en memoria y llamando cargarAsistenciaMes(), como al volver a abrir la app)
// sigue marcado como préstamo y la fila sigue apareciendo bajo el mismo filtro de obra.
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
    const almacen = {};
    window.firebase = {
      initializeApp() {},
      firestore() {
        return {
          collection() {
            return {
              doc(id) {
                return {
                  async get() { return { exists: id in almacen, data: () => almacen[id] }; },
                  async set(v) { almacen[id] = v; },
                  async delete() { delete almacen[id]; },
                };
              },
              async get() { return { docs: [] }; },
            };
          },
        };
      },
      auth() { return { signInAnonymously: () => Promise.resolve() }; },
    };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  const resultado = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraA";
    obras = ["ObraA", "ObraB"];
    obrasFinalizadas = [];
    categorias = ["Oficial"];
    errorCargaTrabajadores = false;
    filasExtra = 0;
    mesActual = "2026-03";
    quincenaActual = 1;
    asistenciaCache = { "2026-03": {} };
    trabajadores = [
      { id: "t1", nombre: "Marco Ruiz", categoria: "Oficial", obra: "ObraB", estado: "Activo", fechaBaja: "", obs: "" },
    ];
    document.getElementById("asis-filtro-obra").innerHTML = `<option value="">Todas las obras</option><option value="ObraA">ObraA</option><option value="ObraB">ObraB</option>`;
    document.getElementById("asis-filtro-obra").value = "ObraA";
    document.getElementById("sel-dia").value = "2026-03-15";

    agregarFilaAsistencia();
    const filaExtraId = Object.keys(asistenciaCache["2026-03"]).find(k => k.startsWith("extra_"));
    await confirmarNombreFilaPrestado({ value: "Marco Ruiz" }, filaExtraId, 15);
    setDia("t1", 15, "9");

    const regAntes = asistenciaCache["2026-03"].t1;
    const r1_quedaMarcadoAntesDeGuardar = !!(regAntes && (regAntes.prestamoObraActiva === "ObraA" || (regAntes.diasObra && regAntes.diasObra["15"] === "ObraA")));

    const guardadoOk = await guardarAsistenciaMes("2026-03");

    // Simula volver a abrir la app: se borra el cache en memoria del mes y se vuelve a pedir --
    // cargarAsistenciaMes() ahora SÍ tiene que leer de verdad de window.storage.
    delete asistenciaCache["2026-03"];
    delete mesesConErrorDeCarga["2026-03"];
    await cargarAsistenciaMes("2026-03");

    const regDespues = asistenciaCache["2026-03"].t1;
    const r2_sobreviveElRoundTripDeGuardado = !!(regDespues && (regDespues.prestamoObraActiva === "ObraA" || (regDespues.diasObra && regDespues.diasObra["15"] === "ObraA")));
    const r3_lasHorasSobreviven = !!(regDespues && regDespues.days && regDespues.days["15"] === "9");

    const filasTrasRecarga = filasParaMes("2026-03");
    const r4_laFilaSigueApareciendoTrasRecargar = filasTrasRecarga.some(f => f.id === "t1");

    return { guardadoOk, r1_quedaMarcadoAntesDeGuardar, r2_sobreviveElRoundTripDeGuardado, r3_lasHorasSobreviven, r4_laFilaSigueApareciendoTrasRecargar };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_quedaMarcadoAntesDeGuardar) fallas.push("El préstamo debería quedar marcado antes de guardar (esto ya lo probamos antes)");
  if (!resultado.r2_sobreviveElRoundTripDeGuardado) fallas.push("BUG REPRODUCIDO: la marca de préstamo se pierde al guardar y volver a leer de storage (como al reabrir la app)");
  if (!resultado.r3_lasHorasSobreviven) fallas.push("Las horas cargadas deberían sobrevivir el guardado/recarga");
  if (!resultado.r4_laFilaSigueApareciendoTrasRecargar) fallas.push("BUG REPRODUCIDO: la fila del trabajador prestado desaparece después de reabrir la app (recargar desde storage)");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE SUPERVIVENCIA TRAS GUARDAR/RECARGAR OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
