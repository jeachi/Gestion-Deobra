// Ronda 4 de auditoría -- Configuración: 2 arreglos.
// 1) importarRespaldo() escribía directo a Firestore pero nunca actualizaba las variables JS en
//    memoria, y solo avisaba con un texto chico "recargá la página" -- si alguien seguía
//    trabajando sin recargar, el primer guardado posterior de cualquier catálogo deshacía la
//    restauración en silencio. Ahora se fuerza una recarga automática.
// 2) agregarEquivalencia() no evitaba duplicados: una equivalencia "corregida" agregando una nueva
//    entrada dejaba la vieja (incorrecta) todavía activa, porque buscarEquivalencia() usa .find()
//    (la primera coincidencia). Ahora actualiza la existente en vez de agregar una duplicada.
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

    // ---- 1) importarRespaldo() fuerza una recarga automática tras restaurar ----
    let recargoLlamado = false;
    const recargarOriginal = window.recargarTrasRestaurarRespaldo;
    window.recargarTrasRestaurarRespaldo = () => { recargoLlamado = true; };
    const confirmOriginal = window.confirm;
    window.confirm = () => true; // simula que el usuario aceptó el diálogo de confirmación

    // "password" es obligatorio en cualquier usuario real (todas las altas lo piden) -- ronda 7
    // agregó una validación en importarRespaldo() que rechaza (a propósito) un "usuarios" sin forma
    // de usuario real, así que el objeto de prueba tiene que tener uno para seguir representando un
    // respaldo válido.
    const paquete = { datos: { usuarios: JSON.stringify([{ username: "admin", role: "admin", password: "x".repeat(64) }]) } };
    const blob = new Blob([JSON.stringify(paquete)], { type: "application/json" });
    const file = new File([blob], "respaldo.json", { type: "application/json" });
    // input.files no se puede asignar directo -- se simula con un objeto liviano equivalente.
    const inputFalso = { files: [file], value: "" };
    await new Promise((resolve) => {
      // importarRespaldo() usa FileReader.onload de forma asíncrona, y la recarga real se agenda
      // con un setTimeout(...,1200) para que la persona alcance a ver el aviso -- esperamos más que eso.
      importarRespaldo(inputFalso);
      setTimeout(resolve, 1800);
    });
    window.confirm = confirmOriginal;
    const r1_forzoRecarga = recargoLlamado;
    window.recargarTrasRestaurarRespaldo = recargarOriginal;

    // ---- 2) agregarEquivalencia() actualiza en vez de duplicar ----
    equivalenciasMateriales = [{ material: "Cemento", unidadGrande: "PALLET", cantChica: 40, unidadChica: "BOLSA" }];
    document.getElementById("eq-material").value = "Cemento";
    document.getElementById("eq-un-grande").value = "PALLET";
    document.getElementById("eq-cant-chica").value = "42"; // corrigiendo el valor incorrecto (40 -> 42)
    document.getElementById("eq-un-chica").value = "BOLSA";
    await agregarEquivalencia();
    const r2_noDuplico = equivalenciasMateriales.length === 1;
    const r2_actualizoValor = equivalenciasMateriales[0].cantChica === 42;
    const buscada = buscarEquivalencia("Cemento", "PALLET");
    const r2_buscarDevuelveElValorNuevo = buscada && buscada.cantChica === 42;

    return { r1_forzoRecarga, r2_noDuplico, r2_actualizoValor, r2_buscarDevuelveElValorNuevo };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_forzoRecarga) fallas.push("BUG REPRODUCIDO: importarRespaldo() debería forzar una recarga automática de la página tras restaurar, no depender de que el usuario recargue a mano");
  if (!resultado.r2_noDuplico) fallas.push("BUG REPRODUCIDO: agregarEquivalencia() no debería duplicar una equivalencia ya existente para el mismo material+unidad grande");
  if (!resultado.r2_actualizoValor) fallas.push("agregarEquivalencia() debería actualizar el valor de la equivalencia existente");
  if (!resultado.r2_buscarDevuelveElValorNuevo) fallas.push("BUG REPRODUCIDO: buscarEquivalencia() seguía devolviendo el valor viejo/incorrecto porque quedaba una entrada duplicada antes que la corregida");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CONFIGURACIÓN (RONDA 4) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
