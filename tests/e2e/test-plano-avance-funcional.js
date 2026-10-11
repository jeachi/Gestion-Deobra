// Auditoría funcional pedida por el usuario sobre el editor interno de Plano de avance / Maestro.
// 4 bugs reales encontrados y arreglados:
//
// 1) irA() -- el camino MÁS común para cambiar de módulo (tocar la barra de navegación de abajo)
//    no avisaba si había un área del plano a medio dibujar/editar sin guardar. Solo el botón/gesto
//    "atrás" del celular (popstate) tenía ese aviso. Tocar "Certificados" mientras se dibujaba una
//    pared perdía el trabajo en silencio.
// 2) seleccionarPlano()/volverASelectorPlanos() no reseteaban modoColocarReferencia,
//    modoAnclaTextoPlano, modoCinta ni calibracionActiva al cambiar de plano -- iniciarColocarPunto()
//    revisa esos modos ANTES que nada, así que el primer toque en el plano NUEVO quedaba
//    secuestrado por la herramienta vieja del plano anterior, sin ningún aviso de por qué "dejó de
//    andar". Calibrar a medio hacer además dejaba un listener "pointerdown" pegado para siempre al
//    <canvas> (se reutiliza entre planos).
// 3) La selección múltiple de etiquetas (modoSeleccionMultiple) tampoco se cerraba al cambiar de
//    plano -- sus índices guardados apuntaban al array de ANOTACIONES DEL PLANO VIEJO; si se
//    cambiaba de plano y se tocaba "Eliminar seleccionadas", borraba lo que hubiera en esas
//    posiciones en el plano NUEVO, no lo que el usuario había elegido.
// 4) "Recargar" en el aviso de edición concurrente no tenía el mismo resguardo que el botón ✕ y el
//    "atrás": pisaba un área sin guardar sin preguntar nada.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  // Simula al usuario tocando "Cancelar" en el confirm() nativo -- así se puede comprobar que el
  // aviso REALMENTE frena la acción (si en vez de esto se aceptara, no se podría distinguir "no
  // avisó nada" de "avisó pero el usuario igual confirmó salir").
  page.on("dialog", async (d) => { await d.dismiss(); });

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
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });

    function imgFalsa(){ const c=document.createElement("canvas"); c.width=800;c.height=600; const cx=c.getContext("2d"); cx.fillStyle="#eee"; cx.fillRect(0,0,800,600); return c.toDataURL("image/png"); }
    const img = imgFalsa();
    const planoA = { id:"plA", nombre:"Plano A", fecha:hoyISO() };
    const planoB = { id:"plB", nombre:"Plano B", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([planoA, planoB]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoA.id}`, img, true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoB.id}`, img, true);
    await window.storage.set(`plano_avance_textos_VARELA_${planoA.id}`, JSON.stringify([
      {x:100,y:100,tipo:"numero",texto:"1"}, {x:200,y:100,tipo:"numero",texto:"2"}
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));

    // ---- 1) irA() avisa si hay un área sin cerrar antes de cambiar de módulo ----
    await seleccionarPlano("plA");
    await new Promise(r=>setTimeout(r, 300));
    dibujando = true; // simula un área a medio dibujar
    irA("dashboard");
    await new Promise(r=>setTimeout(r, 50));
    const r1_avisaAntesDeCambiarDeModulo = vistaActualNexo === "planoavance"; // si avisó y se confirmó "accept" (cancelar), se queda en plano
    dibujando = false; // limpio para lo que sigue

    // ---- 2) Cambiar de plano apaga los modos "trampa" del plano anterior ----
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("plA");
    await new Promise(r=>setTimeout(r, 200));
    modoColocarReferencia = true;
    modoAnclaTextoPlano = true;
    modoCinta = true;
    calibracionActiva = true;
    document.getElementById("canvas-plano").addEventListener("pointerdown", capturarPuntoCalibracion);
    await seleccionarPlano("plB");
    await new Promise(r=>setTimeout(r, 300));
    const r2_apagaModosTrampaAlCambiarDePlano =
      modoColocarReferencia===false && modoAnclaTextoPlano===false && modoCinta===false && calibracionActiva===false;

    // ---- 3) La selección múltiple de etiquetas se cierra al cambiar de plano (no quedan índices
    // del plano viejo apuntando al array del plano nuevo) ----
    await seleccionarPlano("plA");
    await new Promise(r=>setTimeout(r, 200));
    iniciarModoSeleccionMultiple();
    anotacionesSeleccionadas.add(0);
    await seleccionarPlano("plB");
    await new Promise(r=>setTimeout(r, 200));
    const r3_cierraSeleccionMultipleAlCambiarDePlano = modoSeleccionMultiple===false && anotacionesSeleccionadas.size===0;

    // ---- 4) "Recargar" del aviso de edición concurrente también avisa si hay algo sin guardar ----
    await seleccionarPlano("plA");
    await new Promise(r=>setTimeout(r, 200));
    indiceEditando = 0; // simula una edición en curso
    recargarPlanoPorEdicionConcurrente();
    await new Promise(r=>setTimeout(r, 50));
    const r4_recargarAvisaSiHayAlgoSinGuardar = indiceEditando === 0; // si avisó y se confirmó "accept" (no recargar), sigue en edición
    indiceEditando = null;

    return { r1_avisaAntesDeCambiarDeModulo, r2_apagaModosTrampaAlCambiarDePlano, r3_cierraSeleccionMultipleAlCambiarDePlano, r4_recargarAvisaSiHayAlgoSinGuardar };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_avisaAntesDeCambiarDeModulo) fallas.push("BUG REPRODUCIDO: tocar otra pestaña de la barra de abajo no avisa si hay un área del plano sin guardar, y la pierde en silencio");
  if (!resultado.r2_apagaModosTrampaAlCambiarDePlano) fallas.push("BUG REPRODUCIDO: cambiar de plano deja prendido un modo de herramienta del plano anterior (referencia/texto/cinta/calibración), secuestrando el próximo toque");
  if (!resultado.r3_cierraSeleccionMultipleAlCambiarDePlano) fallas.push("BUG REPRODUCIDO: la selección múltiple de etiquetas sigue activa después de cambiar de plano, con índices del plano viejo");
  if (!resultado.r4_recargarAvisaSiHayAlgoSinGuardar) fallas.push("BUG REPRODUCIDO: 'Recargar' en el aviso de edición concurrente pisa una edición en curso sin avisar");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS FUNCIONALES DE PLANO DE AVANCE OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
