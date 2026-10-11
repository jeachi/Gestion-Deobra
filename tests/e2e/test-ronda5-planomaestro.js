// Ronda 5 de auditoría -- Plano de avance / Plano Maestro: 3 arreglos.
// 1) eliminarPlano() no limpiaba capasVinculadas de los pines de OTROS Planos Maestro que
//    apuntaran al plano borrado -- quedaban con un planoId muerto, mostrando "sin marcar todavía".
// 2) Renombrar una capa/actividad no actualizaba capasVinculadas -- los pines seguían buscando el
//    nombre VIEJO para siempre.
// 3) elegirTipoAmbientePin() reemplazaba el checklist entero (tildes + ítems a mano incluidos) sin
//    ninguna confirmación.
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
    obraOverridePlanoAvance = null;
    const obra = "ObraTest";

    // ---- 1) eliminarPlano() limpia capasVinculadas de OTROS Planos Maestro ----
    planosIndex = [
      { id: "planoBorrar", nombre: "Plano a borrar", fecha: "2026-01-01", tipo: "avance", obra },
      { id: "planoM1", nombre: "Maestro 1", fecha: "2026-01-01", tipo: "maestro", obra },
    ];
    contratistasIndex = [];
    planoActualId = "planoBorrar"; // simula que se está viendo/borrando este plano
    const pinesM1 = [{ id: "pin1", x: 10, y: 10, checklist: [], capasVinculadas: [
      { tipo: "capa", planoId: "planoBorrar", planoNombre: "Plano a borrar", nombreCompleto: "Estructura - Piso 1" },
      { tipo: "capa", planoId: "otroPlanoVivo", planoNombre: "Otro", nombreCompleto: "Sigue existiendo" },
    ] }];
    await window.storage.set(`plano_maestro_pines_${obra}_planoM1`, JSON.stringify(pinesM1), true);

    const fakeBtn = document.createElement("button");
    document.body.appendChild(fakeBtn);
    eliminarPlano("planoBorrar", fakeBtn); // primer toque: solo pide confirmar
    eliminarPlano("planoBorrar", fakeBtn); // segundo toque: ejecuta (async, sin await adentro)
    await new Promise(r => setTimeout(r, 300));
    const rPinesM1 = await window.storage.get(`plano_maestro_pines_${obra}_planoM1`, true);
    const pinesM1Tras = JSON.parse(rPinesM1.value);
    const r1_borroVinculoMuerto = pinesM1Tras[0].capasVinculadas.length === 1;
    const r1_conservoElVivo = pinesM1Tras[0].capasVinculadas[0].planoId === "otroPlanoVivo";

    // ---- 2) Renombrar una actividad completa actualiza capasVinculadas en otros Maestros ----
    planosIndex = [
      { id: "planoAvance2", nombre: "Plano avance", fecha: "2026-01-01", tipo: "avance", obra },
      { id: "planoM2", nombre: "Maestro 2", fecha: "2026-01-01", tipo: "maestro", obra },
    ];
    planoActualId = "planoAvance2";
    poligonos = [
      { nombreBase: "Cielorraso", capa: "Estructura", nombreCompleto: "Cielorraso - Estructura", area: 10, color: "#fff", capaId: "c1" },
    ];
    const pinesM2 = [{ id: "pin2", x: 5, y: 5, checklist: [], capasVinculadas: [
      { tipo: "capa", planoId: "planoAvance2", planoNombre: "Plano avance", nombreCompleto: "Cielorraso - Estructura" },
    ] }];
    await window.storage.set(`plano_maestro_pines_${obra}_planoM2`, JSON.stringify(pinesM2), true);
    // Estas funciones tocan canvas/DOM del editor -- no hacen falta para probar la sincronización
    // de vínculos, así que se stubbean para no arrastrar todo el setup del editor de planos.
    window.guardarPlanoAvancePoligonos = async () => {};
    window.redibujar = () => {};
    window.renderSelectorActividades = () => {};
    window.renderActividades = () => {};
    window.renderPorcentajesFlotantes = () => {};
    renombrarCapaPendiente = { nombreBase: "Cielorraso", nombreCapaActual: null };
    document.getElementById("prompt-renombrar-capa-input").value = "Cielorraso Nuevo";
    await confirmarPromptRenombrarCapa();
    const rPinesM2 = await window.storage.get(`plano_maestro_pines_${obra}_planoM2`, true);
    const pinesM2Tras = JSON.parse(rPinesM2.value);
    const r2_actualizoVinculo = pinesM2Tras[0].capasVinculadas[0].nombreCompleto === "Cielorraso Nuevo - Estructura";

    // ---- 3) elegirTipoAmbientePin pide confirmación si hay tildes o ítems custom ----
    plantillasChecklistPin = { "Baño": ["Revoque", "Pintura"] };
    pinesMaestro = [{ id: "pinChk", x: 1, y: 1, tipoAmbiente: "Baño", nombre: "Baño 101",
      checklist: [{ texto: "Revoque", hecho: true, urgente: false }, { texto: "Ítem a mano", hecho: false, urgente: false }] }];
    pinAbiertoId = "pinChk";
    let confirmLlamado = false;
    const confirmOriginal = window.confirm;
    window.confirm = (msg) => { confirmLlamado = true; return false; }; // cancela
    elegirTipoAmbientePin("Baño");
    const r3_pidioConfirmacion = confirmLlamado;
    const r3_noBorroSiCancela = pinesMaestro[0].checklist.length === 2 && pinesMaestro[0].checklist.some(c => c.texto === "Ítem a mano");
    confirmLlamado = false;
    window.confirm = () => true; // confirma
    elegirTipoAmbientePin("Baño");
    const r3_borraSiConfirma = pinesMaestro[0].checklist.length === 2 && !pinesMaestro[0].checklist.some(c => c.texto === "Ítem a mano") && !pinesMaestro[0].checklist[0].hecho;
    window.confirm = confirmOriginal;
    // Un pin SIN progreso ni custom (recién creado, plantilla igual) no debería pedir nada.
    pinesMaestro = [{ id: "pinNuevo", x: 1, y: 1, tipoAmbiente: null, nombre: "", checklist: [] }];
    pinAbiertoId = "pinNuevo";
    confirmLlamado = false;
    window.confirm = (msg) => { confirmLlamado = true; return true; };
    elegirTipoAmbientePin("Baño");
    window.confirm = confirmOriginal;
    const r3_sinConfirmacionSiVacio = !confirmLlamado;

    return { r1_borroVinculoMuerto, r1_conservoElVivo, r2_actualizoVinculo, r3_pidioConfirmacion, r3_noBorroSiCancela, r3_borraSiConfirma, r3_sinConfirmacionSiVacio };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_borroVinculoMuerto) fallas.push("BUG REPRODUCIDO: eliminarPlano() debería limpiar el vínculo muerto (planoId del plano borrado) de los pines de otros Planos Maestro");
  if (!resultado.r1_conservoElVivo) fallas.push("eliminarPlano() no debería tocar vínculos a OTROS planos que siguen existiendo");
  if (!resultado.r2_actualizoVinculo) fallas.push("BUG REPRODUCIDO: renombrar una actividad debería actualizar el nombreCompleto en capasVinculadas de los pines de otros Planos Maestro");
  if (!resultado.r3_pidioConfirmacion) fallas.push("BUG REPRODUCIDO: elegir un tipo de ambiente debería pedir confirmación si el pin ya tiene tildes o ítems a mano");
  if (!resultado.r3_noBorroSiCancela) fallas.push("Si se cancela la confirmación, el checklist no debería tocarse");
  if (!resultado.r3_borraSiConfirma) fallas.push("Si se confirma, el checklist sí debería reemplazarse por la plantilla en blanco");
  if (!resultado.r3_sinConfirmacionSiVacio) fallas.push("Un pin sin tildes ni ítems custom no debería pedir confirmación al elegir tipo de ambiente");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PLANO MAESTRO (RONDA 5) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
