// Octavo PR del lote "Todo" (ideas 3, 18, 29):
//
// 3)  Aviso descartable, UNA sola vez por plano, cuando se abre uno sin escala calibrada.
// 18) Al calibrar, si hay OTROS planos de la obra ya calibrados, se ofrece copiar su escala en
//     vez de tener que medir dos puntos a mano de nuevo.
// 29) Si otro plano con la MISMA foto quedó calibrado con una escala MUY distinta, avisa (no
//     bloquea) al confirmar la calibración.
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

    function imgFalsa(seed){ const c=document.createElement("canvas"); c.width=200;c.height=200; const cx=c.getContext("2d"); cx.fillStyle=seed; cx.fillRect(0,0,200,200); return c.toDataURL("image/png"); }
    const imgA = imgFalsa("#aaaaaa"); // única -- A no comparte foto con nadie
    const imgCompartida = imgFalsa("#bbbbbb"); // C y D comparten EXACTAMENTE esta misma foto

    const planoA = { id:"plA", nombre:"Plano A (ya calibrado)", fecha:hoyISO() };
    const planoB = { id:"plB", nombre:"Plano B (nuevo, sin calibrar)", fecha:hoyISO() };
    const planoC = { id:"plC", nombre:"Plano C (misma foto que D)", fecha:hoyISO() };
    const planoD = { id:"plD", nombre:"Plano D (misma foto que C, calibrado)", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([planoA, planoB, planoC, planoD]), true);
    for(const [p,img] of [[planoA,imgA],[planoB,imgA],[planoC,imgCompartida],[planoD,imgCompartida]]){
      await window.storage.set(`plano_avance_imagen_VARELA_${p.id}`, img, true);
      await window.storage.set(`plano_avance_poligonos_VARELA_${p.id}`, JSON.stringify([]), true);
    }
    await window.storage.set("plano_avance_calibracion_VARELA_plA", JSON.stringify({metrosPorPixel: 0.05}), true);
    await window.storage.set("plano_avance_calibracion_VARELA_plD", JSON.stringify({metrosPorPixel: 0.02}), true); // bien distinta de lo que se va a calibrar en C

    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));

    // ==== 3) Aviso de falta de calibración, una sola vez ====
    localStorage.removeItem("plano_aviso_calibrar_plB");
    document.getElementById("toast").textContent = "";
    await seleccionarPlano("plB", true);
    await new Promise(r=>setTimeout(r, 300));
    const r1_avisaLaPrimeraVez = /escala calibrada/i.test(document.getElementById("toast").textContent);

    volverASelectorPlanos();
    document.getElementById("toast").textContent = "";
    await seleccionarPlano("plB", true);
    await new Promise(r=>setTimeout(r, 300));
    const r2_noAvisaDeNuevoLaSegundaVez = document.getElementById("toast").textContent === "";

    // ==== 18) Usar la escala de otro plano ====
    // plB no comparte foto con nadie calibrado salvo plA (misma imgA) -- debería ofrecer copiarla.
    await iniciarCalibracionEscala();
    await new Promise(r=>setTimeout(r, 50));
    const cuerpoPrompt = document.getElementById("prompt-generico-cuerpo").innerHTML;
    const r3_ofreceUsarLaEscalaDeOtroPlanoCalibrado = /Plano A \(ya calibrado\)/.test(cuerpoPrompt) && /0\.05/.test(cuerpoPrompt.replace(",", "."));
    usarEscalaDeOtroPlano(0.05);
    await new Promise(r=>setTimeout(r, 50));
    const r4_copiaLaEscalaElegida = metrosPorPixelPlano === 0.05;
    const rCalibB = JSON.parse((await window.storage.get("plano_avance_calibracion_VARELA_plB", true)).value);
    const r5_quedaGuardada = rCalibB.metrosPorPixel === 0.05;

    // Si NO hay ningún otro plano calibrado, debería ir derecho al modo manual (sin mostrar prompt)
    await seleccionarPlano("plA", true); // plA ya está calibrado, pero es el ÚNICO calibrado de la obra además de sí mismo
    await new Promise(r=>setTimeout(r, 300));
    // Se "descalibra" a propósito para esta prueba puntual (no afecta nada más del test)
    await window.storage.delete("plano_avance_calibracion_VARELA_plB", true);
    const otrosCalibradosParaA = await planosCalibradosDeLaObra(); // debería ver a plD (misma obra, calibrado) -- no a plB ni a sí mismo
    const r6_noSeCuentaASiMismo = !otrosCalibradosParaA.some(o=>o.id==="plA");

    // ==== 29) Aviso si dos planos con la misma foto quedan con escalas distintas ====
    await seleccionarPlano("plC", true);
    await new Promise(r=>setTimeout(r, 300));
    document.getElementById("toast").textContent = "";
    iniciarCalibracionEscalaManual();
    calibracionPuntos = [[0,0],[100,0]]; // 100px de distancia
    abrirPromptDistanciaReal(100);
    document.getElementById("calib-metros-reales").value = "8"; // 8m/100px = 0.08 m/px -- MUY distinto de los 0.02 de plD (misma foto)
    await confirmarCalibracionEscala(100);
    await new Promise(r=>setTimeout(r, 100));
    const r7_avisaPorLaEscalaDistintaEnLaMismaFoto = /MISMA foto/.test(document.getElementById("toast").textContent)
      && document.getElementById("toast").textContent.includes("Plano D");

    // Con una escala PARECIDA (dentro del 5%) a la de la misma foto, no debería avisar nada.
    document.getElementById("toast").textContent = "";
    iniciarCalibracionEscalaManual();
    calibracionPuntos = [[0,0],[100,0]];
    abrirPromptDistanciaReal(100);
    document.getElementById("calib-metros-reales").value = "2.01"; // 0.0201 m/px, ~0.5% de diferencia contra los 0.02 de plD
    await confirmarCalibracionEscala(100);
    await new Promise(r=>setTimeout(r, 100));
    const r8_noAvisaConEscalaParecida = !/MISMA foto/.test(document.getElementById("toast").textContent)
      && /Escala guardada/.test(document.getElementById("toast").textContent);

    return {
      r1_avisaLaPrimeraVez, r2_noAvisaDeNuevoLaSegundaVez,
      r3_ofreceUsarLaEscalaDeOtroPlanoCalibrado, r4_copiaLaEscalaElegida, r5_quedaGuardada,
      r6_noSeCuentaASiMismo, r7_avisaPorLaEscalaDistintaEnLaMismaFoto, r8_noAvisaConEscalaParecida,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_avisaLaPrimeraVez) fallas.push("BUG REPRODUCIDO: abrir un plano sin calibrar no avisa nada");
  if (!resultado.r2_noAvisaDeNuevoLaSegundaVez) fallas.push("BUG REPRODUCIDO: el aviso de falta de calibración se repite en cada entrada (debería ser una sola vez)");
  if (!resultado.r3_ofreceUsarLaEscalaDeOtroPlanoCalibrado) fallas.push("BUG REPRODUCIDO: no se ofrece copiar la escala de otro plano ya calibrado de la obra");
  if (!resultado.r4_copiaLaEscalaElegida) fallas.push("BUG REPRODUCIDO: elegir \"usar la escala de otro plano\" no la copia");
  if (!resultado.r5_quedaGuardada) fallas.push("BUG REPRODUCIDO: la escala copiada no queda guardada en storage");
  if (!resultado.r6_noSeCuentaASiMismo) fallas.push("BUG REPRODUCIDO: la lista de planos calibrados de la obra se incluye a sí misma");
  if (!resultado.r7_avisaPorLaEscalaDistintaEnLaMismaFoto) fallas.push("BUG REPRODUCIDO: no avisa cuando otro plano con la MISMA foto quedó calibrado muy distinto");
  if (!resultado.r8_noAvisaConEscalaParecida) fallas.push("REGRESIÓN: avisa de diferencia de escala aunque esté dentro del margen (~5%)");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CALIBRACIÓN DE ESCALA OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
