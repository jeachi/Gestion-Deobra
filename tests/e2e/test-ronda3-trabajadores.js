// Ronda 3 de auditoría -- Trabajadores: 4 arreglos.
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

  const resultado = await page.evaluate(async () => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    categorias = ["Oficial", "Ayudante"];
    errorCargaTrabajadores = false;

    // ---- 1) Reactivar (Baja -> Activo) limpia fechaBaja ----
    trabajadores = [{ id: "t1", nombre: "Juan Pérez", categoria: "Oficial", obra: "ObraTest", estado: "Baja", fechaBaja: "2026-03-15", obs: "" }];
    actualizarTrabajador("t1", "estado", "Activo");
    const r1_fechaBajaLimpia = trabajadores[0].fechaBaja === "";

    // ---- 2) Alta con nombre duplicado pide confirmación en vez de crear un legajo nuevo directo ----
    trabajadores = [{ id: "tExistente", nombre: "Carlos Gómez", categoria: "Oficial", obra: "ObraTest", estado: "Baja", fechaBaja: "2026-02-01", obs: "" }];
    document.getElementById("nt-nombre").value = "Carlos Gómez";
    document.getElementById("nt-categoria").innerHTML = `<option value="Oficial">Oficial</option>`;
    document.getElementById("nt-categoria").value = "Oficial";
    document.getElementById("nt-obra").innerHTML = `<option value="ObraTest">ObraTest</option>`;
    document.getElementById("nt-obra").value = "ObraTest";
    const fakeBtn = document.createElement("button");
    await agregarTrabajador(fakeBtn);
    const r2_pidioConfirmacion = fakeBtn.dataset.confirmando === "1";
    const r2_noCreoTodavia = trabajadores.length === 1;
    // Confirmando de nuevo (segundo toque) sí debe crear el nuevo trabajador.
    await agregarTrabajador(fakeBtn);
    const r2_creaTrasConfirmar = trabajadores.length === 2;

    // ---- 3) Borrar una categoría en uso no deja el <select> de esa fila en blanco ----
    trabajadores = [{ id: "tCat", nombre: "Ana Ruiz", categoria: "Capataz Especial", obra: "ObraTest", estado: "Activo", fechaBaja: "", obs: "" }];
    categorias = ["Oficial", "Ayudante"]; // "Capataz Especial" ya no está en el catálogo
    renderTrabajadores();
    const selectCategoria = document.querySelector("#tbody-trabajadores select");
    const r3_categoriaVisible = selectCategoria && selectCategoria.value === "Capataz Especial";

    // ---- 4) Vista Día usa la obra guardada de la fila/mes (reg.obra), no la obra actual del trabajador, para la lluvia ----
    mesActual = "2026-04";
    trabajadores = [{ id: "tLluvia", nombre: "Pedro López", categoria: "Oficial", obra: "ObraNueva", estado: "Activo", fechaBaja: "", obs: "" }];
    asistenciaCache[mesActual] = { tLluvia: { obra: "ObraVieja", days: {}, notaQ1: "", notaQ2: "" } };
    climaRegistros = [{ id: "c1", obra: "ObraVieja", fecha: "2026-04-10", seTrabajo: "no" }];
    document.getElementById("sel-dia").value = "2026-04-10";
    renderVistaDia();
    const htmlDia = document.getElementById("lista-dia").innerHTML;
    const r4_avisoLluviaConObraDeLaFila = htmlDia.includes("🌧️ Lluvia (Clima)");

    return { r1_fechaBajaLimpia, r2_pidioConfirmacion, r2_noCreoTodavia, r2_creaTrasConfirmar, r3_categoriaVisible, r4_avisoLluviaConObraDeLaFila };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_fechaBajaLimpia) fallas.push("BUG REPRODUCIDO: reactivar un trabajador (Baja -> Activo) debería limpiar fechaBaja");
  if (!resultado.r2_pidioConfirmacion) fallas.push("BUG REPRODUCIDO: agregar un trabajador con un nombre ya existente debería pedir confirmación");
  if (!resultado.r2_noCreoTodavia) fallas.push("No debería haberse creado el trabajador nuevo sin confirmar");
  if (!resultado.r2_creaTrasConfirmar) fallas.push("Tras confirmar (segundo toque), sí debería crearse el trabajador nuevo");
  if (!resultado.r3_categoriaVisible) fallas.push("BUG REPRODUCIDO: una categoría borrada del catálogo pero en uso debería seguir visible en el <select> de esa fila");
  if (!resultado.r4_avisoLluviaConObraDeLaFila) fallas.push("BUG REPRODUCIDO: el aviso de lluvia en Vista Día debería usar la obra guardada de esa fila/mes, no la obra actual del trabajador");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE TRABAJADORES (RONDA 3) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
