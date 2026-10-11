// "Todo" (ideas 1-32) pedido por el usuario tras las rondas de ideación. Primer PR del lote:
//
// 6) Vista previa de qué se va a deshacer -- mantener presionado "↩️ Deshacer" en el riel muestra
//    un toast dinámico ("↩️ Deshacer: agregar/eliminar/editar \"X\"") en vez del nombre fijo del
//    botón, y el toast final al tocarlo también lo incluye.
// 7) Aviso suave al cerrar un área sospechosamente chica (<1% de la superficie del plano) -- no
//    bloquea, solo confirma una vez.
//
// (La idea 21 -- "deshacer con gesto, pegado a Cerrar/Cancelar mientras se dibuja" -- resultó ser
// una premisa falsa: #cad-bottom-actions YA tiene un botón "↩ Deshacer" (deshacerPunto()) ahí
// mismo desde antes. No se tocó nada para esa idea.)
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
    // confirm() siempre "aceptar" salvo que el test lo pise a mano con window.__confirmResp
    window.__confirmLlamadas = [];
    window.confirm = (msg) => { window.__confirmLlamadas.push(msg); return window.__confirmResp !== false; };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  const resultado = await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });

    function imgFalsa(){ const c=document.createElement("canvas"); c.width=1000;c.height=1000; const cx=c.getContext("2d"); cx.fillStyle="#eee"; cx.fillRect(0,0,1000,1000); return c.toDataURL("image/png"); }
    const img = imgFalsa();
    const plano = { id:"plX", nombre:"Zócalos", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([plano]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${plano.id}`, img, true);
    await window.storage.set(`plano_avance_poligonos_VARELA_${plano.id}`, JSON.stringify([]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("plX", true);
    await new Promise(r=>setTimeout(r, 300));

    // ==== 7) Aviso de área sospechosamente chica ====
    toggleDrawerHerramientas("dibujar");
    document.getElementById("input-nombre-actividad-nueva").value = "Pintura";
    iniciarDibujo();
    // El canvas es de 1000x1000 -- un cuadradito de 10x10 es el 0.01% del total, bien por debajo
    // del 1% de corte.
    puntosActuales = [[10,10],[20,10],[20,20],[10,20]];
    document.getElementById("btn-cerrar").disabled = false;
    window.__confirmResp = undefined; // sin pisar nada todavía: debe preguntar y, por default, aceptar
    cerrarPoligono();
    await new Promise(r=>setTimeout(r, 50));
    const r1_pideConfirmacionPorAreaChica = window.__confirmLlamadas.some(m=>/chica/i.test(m));
    const r2_laGuardaSiSeConfirma = poligonos.some(p=>p.nombreBase==="Pintura");

    // Si se RECHAZA la confirmación, no debe guardarse
    window.__confirmLlamadas = [];
    document.getElementById("input-nombre-actividad-nueva").value = "Pintura2";
    iniciarDibujo();
    puntosActuales = [[10,10],[20,10],[20,20],[10,20]];
    document.getElementById("btn-cerrar").disabled = false;
    window.__confirmResp = false;
    cerrarPoligono();
    await new Promise(r=>setTimeout(r, 50));
    const r3_noLaGuardaSiSeRechaza = !poligonos.some(p=>p.nombreBase==="Pintura2");

    // Un área NORMAL (la mitad del plano) no debe disparar ningún aviso
    window.__confirmLlamadas = [];
    window.__confirmResp = undefined;
    document.getElementById("input-nombre-actividad-nueva").value = "Durlock";
    iniciarDibujo();
    puntosActuales = [[0,0],[1000,0],[1000,500],[0,500]];
    document.getElementById("btn-cerrar").disabled = false;
    cerrarPoligono();
    await new Promise(r=>setTimeout(r, 50));
    const r4_noAvisaConAreaNormal = window.__confirmLlamadas.length===0 && poligonos.some(p=>p.nombreBase==="Durlock");

    // ==== 6) Vista previa de qué se va a deshacer ====
    // El último cierre fue agregar "Durlock" -- deshacerGeneral() debería poder describirlo ANTES
    // de tocarlo.
    const r5_describeAgregar = describirProximoDeshacer().includes("Durlock") && /agregar/.test(describirProximoDeshacer());
    const toastAntes = (document.getElementById("toast")||{}).textContent || "";
    deshacerGeneral();
    await new Promise(r=>setTimeout(r, 50));
    const toastDespues = (document.getElementById("toast")||{}).textContent || "";
    const r6_elToastFinalIncluyeLaDescripcion = /Durlock/.test(toastDespues) && /[Dd]eshecho/.test(toastDespues);

    // Deshacer la pieza chica de Pintura ahora -- debe describir "eliminar" (al deshacer un
    // agregado, el estado post-deshacer tiene MENOS piezas que el que había antes de deshacer, así
    // que describirProximoDeshacer() compara contra la próxima foto del historial)
    const descPrevia = describirProximoDeshacer();
    const r7_elSiguienteTambienSeDescribeAntesDeTocar = !!descPrevia && /Pintura/.test(descPrevia);

    return {
      r1_pideConfirmacionPorAreaChica, r2_laGuardaSiSeConfirma, r3_noLaGuardaSiSeRechaza,
      r4_noAvisaConAreaNormal, r5_describeAgregar, r6_elToastFinalIncluyeLaDescripcion,
      r7_elSiguienteTambienSeDescribeAntesDeTocar,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_pideConfirmacionPorAreaChica) fallas.push("BUG REPRODUCIDO: cerrar un área <1% del plano no pide confirmación");
  if (!resultado.r2_laGuardaSiSeConfirma) fallas.push("BUG REPRODUCIDO: confirmar el aviso de área chica no la guarda igual");
  if (!resultado.r3_noLaGuardaSiSeRechaza) fallas.push("BUG REPRODUCIDO: rechazar el aviso de área chica la guarda de todos modos");
  if (!resultado.r4_noAvisaConAreaNormal) fallas.push("REGRESIÓN: un área normal (50% del plano) dispara el aviso o no se guarda");
  if (!resultado.r5_describeAgregar) fallas.push("BUG REPRODUCIDO: describirProximoDeshacer() no describe agregar una pieza nueva");
  if (!resultado.r6_elToastFinalIncluyeLaDescripcion) fallas.push("BUG REPRODUCIDO: el toast de \"Deshecho\" no incluye qué se deshizo");
  if (!resultado.r7_elSiguienteTambienSeDescribeAntesDeTocar) fallas.push("BUG REPRODUCIDO: tras deshacer una vez, el próximo deshacer no se puede describir de antemano");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE DESHACER + AVISO DE ÁREA CHICA OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
