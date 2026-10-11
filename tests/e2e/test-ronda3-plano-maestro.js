// Ronda 3 de auditoría -- Plano Maestro: 3 arreglos.
// 1) duplicarPlano() perdía tipo:"maestro" y todos los pines al duplicar un Plano Maestro.
// 2) duplicarPlano() copiaba los polígonos con los MISMOS capaId que el original.
// 3) Los cachés de "otros planos" del Plano Maestro nunca se invalidaban al guardar un plano.
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
    const obra = "ObraTest";
    claveObraPlanoAvance = () => obra;

    // ---- 1 y 2) Duplicar un Plano Maestro conserva tipo+pines, y regenera los capaId ----
    const idOriginal = "planoMaestroOriginal";
    planosIndex = [{ id: idOriginal, nombre: "Maestro Obra", fecha: "2026-01-01", contratistaId: null, contratistaNombre: null, tipo: "maestro", miniatura: null }];
    await window.storage.set(`plano_avance_imagen_${obra}_${idOriginal}`, "data:image/png;base64,xxx", true);
    const poligonosOriginales = [
      { nombreBase: "Estructura", capa: "Piso 1", nombreCompleto: "Estructura - Piso 1", area: 50, capaId: "capaX" },
      { nombreBase: "Estructura", capa: "Piso 1", nombreCompleto: "Estructura - Piso 1", area: 30, capaId: "capaX" },
    ];
    await window.storage.set(`plano_avance_poligonos_${obra}_${idOriginal}`, JSON.stringify(poligonosOriginales), true);
    const pinesOriginales = [{ id: "pin1", x: 10, y: 10, checklist: [{ texto: "Revisar", hecho: false }], capasVinculadas: [] }];
    await window.storage.set(`plano_maestro_pines_${obra}_${idOriginal}`, JSON.stringify(pinesOriginales), true);

    await duplicarPlano(idOriginal);
    const copia = planosIndex.find(p => p.id !== idOriginal);
    const r1_conservaTipoMaestro = !!copia && copia.tipo === "maestro";

    let pinesCopia = [];
    try{
      const rPinesCopia = copia ? await window.storage.get(`plano_maestro_pines_${obra}_${copia.id}`, true) : null;
      pinesCopia = rPinesCopia && rPinesCopia.value ? JSON.parse(rPinesCopia.value) : [];
    }catch(e){ pinesCopia = []; } // el código viejo ni siquiera creaba esta clave para la copia
    const r1_copioPines = pinesCopia.length === 1 && pinesCopia[0].id === "pin1";

    const rPoligonosCopia = copia ? await window.storage.get(`plano_avance_poligonos_${obra}_${copia.id}`, true) : null;
    const poligonosCopia = rPoligonosCopia && rPoligonosCopia.value ? JSON.parse(rPoligonosCopia.value) : [];
    const r2_capaIdRegenerado = poligonosCopia.length === 2 && poligonosCopia[0].capaId !== "capaX" && poligonosCopia[0].capaId === poligonosCopia[1].capaId;

    // ---- 3) Guardar un plano invalida los cachés de "otros planos" del Plano Maestro ----
    cachePoligonosOtrosPlanos["algunaClaveVieja"] = [{ dato: "viejo" }];
    cacheEstadosOtrosPlanos["algunaClaveVieja"] = { estado: "viejo" };
    cacheAnotacionesOtrosPlanos["algunaClaveVieja"] = [{ texto: "vieja" }];
    planoActualId = "planoCualquiera";
    poligonos = [];
    await guardarPlanoAvancePoligonos();
    const r3_cachesInvalidados = Object.keys(cachePoligonosOtrosPlanos).length === 0 &&
      Object.keys(cacheEstadosOtrosPlanos).length === 0 &&
      Object.keys(cacheAnotacionesOtrosPlanos).length === 0;

    return { r1_conservaTipoMaestro, r1_copioPines, r2_capaIdRegenerado, r3_cachesInvalidados };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_conservaTipoMaestro) fallas.push("BUG REPRODUCIDO: duplicar un Plano Maestro debería conservar tipo:'maestro' en la copia");
  if (!resultado.r1_copioPines) fallas.push("BUG REPRODUCIDO: duplicar un Plano Maestro debería copiar también sus pines");
  if (!resultado.r2_capaIdRegenerado) fallas.push("BUG REPRODUCIDO: duplicar un plano debería regenerar los capaId de sus polígonos, no copiar los mismos");
  if (!resultado.r3_cachesInvalidados) fallas.push("BUG REPRODUCIDO: guardar un plano debería invalidar los cachés de 'otros planos' del Plano Maestro");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE PLANO MAESTRO (RONDA 3) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
