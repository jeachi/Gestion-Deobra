// Evolución de Plano de avance pedida por el usuario (propuesta 3 del mockup, aprobada): semáforo
// de pendientes en los pines del Plano Maestro. Cada pin YA se coloreaba según su checklist
// (colorEstadoPinMaestro, preexistente) pero no había ningún resumen agregado -- había que tocar
// pin por pin para saber cuántos tenían algo urgente. Ahora el encabezado del editor (el mismo
// renglón que antes solo decía "N pin(es)") muestra el conteo por estado, y se mantiene al día
// solo con agregar/mover pines o tocar un ítem de su checklist (ambos ya llamaban a
// renderPinesMaestro(), que ahora también refresca este renglón).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });

    function imgFalsa(){ const c=document.createElement("canvas"); c.width=800;c.height=600; const cx=c.getContext("2d"); cx.fillStyle="#eee"; cx.fillRect(0,0,800,600); return c.toDataURL("image/png"); }
    const img = imgFalsa();
    const planoM = { id:"plM", nombre:"Plano Maestro General", tipo:"maestro", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([planoM]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoM.id}`, img, true);
    const pines = [
      { id:"p1", x:150, y:150, nombre:"Dorm 1", checklist:[{texto:"Pintura", hecho:false, urgente:true}] },
      { id:"p2", x:500, y:200, nombre:"Cocina", checklist:[{texto:"Mesada", hecho:false, urgente:false}] },
      { id:"p3", x:300, y:450, nombre:"Baño", checklist:[{texto:"Grifería", hecho:true, urgente:false}] },
    ];
    await window.storage.set(`plano_maestro_pines_VARELA_${planoM.id}`, JSON.stringify(pines), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));

    // entra directo al editor (como ya hace, por ejemplo, abrir un plano vinculado desde Certificados)
    await seleccionarPlano("plM", true);
    await new Promise(r=>setTimeout(r, 400));

    const textoSubtitulo = document.getElementById("cad-tipo-actividad").textContent;
    const r1_muestraLosTresEstados = textoSubtitulo.includes("1") && /🔴/.test(textoSubtitulo) && /🟠/.test(textoSubtitulo) && /🟢/.test(textoSubtitulo);

    // Tocar el pin urgente para abrir su checklist, marcarlo "hecho" -- el semáforo tiene que
    // pasar de 1 urgente a 0 urgentes sin tener que volver a elegir el plano.
    pinAbiertoId = "p1";
    toggleChecklistItemPin(0);
    await new Promise(r=>setTimeout(r, 100));
    const textoActualizado = document.getElementById("cad-tipo-actividad").textContent;
    const r2_seActualizaAlResolverUnPendiente = textoActualizado.includes("🔴 0");

    return { r1_muestraLosTresEstados, r2_seActualizaAlResolverUnPendiente };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_muestraLosTresEstados) fallas.push("BUG REPRODUCIDO: el encabezado del editor del Maestro no muestra el semáforo agregado (urgentes/pendientes/al día)");
  if (!resultado.r2_seActualizaAlResolverUnPendiente) fallas.push("BUG REPRODUCIDO: el semáforo del encabezado no se actualiza al resolver un pendiente del checklist");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL SEMÁFORO DEL MAESTRO OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
