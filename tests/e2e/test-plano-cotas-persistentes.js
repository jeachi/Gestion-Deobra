// Bug reportado por el usuario: "Los botones para aceptar en el plano revísalos ejemplo cotas y
// desaher no funcionan y no se queda la cota visible." La Cinta métrica/Cotas vivía solo en
// memoria (puntosCinta) y se dibujaba apenas mientras modoCinta seguía activo -- el botón
// "✓ Cerrar" de la barra compartida nunca tuvo una acción para Cotas (quedaba deshabilitado todo
// el tiempo) y "Deshacer" no la cubría porque nunca pasaba por el historial. Ahora Cotas se acepta
// con ese mismo botón ("✓ Aceptar"), queda persistida (cotasPlano) y es cubierta por
// Deshacer/Rehacer, igual que polígonos y cuadros de texto.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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

  await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });

    function imgFalsa(){ const c=document.createElement("canvas"); c.width=800;c.height=600; const cx=c.getContext("2d"); cx.fillStyle="#eee"; cx.fillRect(0,0,800,600); return c.toDataURL("image/png"); }
    const plano = { id:"pl1", nombre:"Plano 1", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([plano]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${plano.id}`, imgFalsa(), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
    await seleccionarPlano("pl1");
    await new Promise(r=>setTimeout(r, 300));
    entrarAEditarPlano();
    await new Promise(r=>setTimeout(r, 200));
  });

  // ---- 1) El botón "✓ Cerrar" se habilita como "Aceptar" al tocar 2+ puntos ----
  const enCurso = await page.evaluate(() => {
    iniciarCintaMetrica();
    confirmarPuntoCinta(10, 10);
    const disabledConUnPunto = document.getElementById("btn-cerrar").disabled;
    confirmarPuntoCinta(50, 10);
    return {
      disabledConUnPunto,
      disabledConDosPuntos: document.getElementById("btn-cerrar").disabled,
      label: document.getElementById("btn-cerrar-lbl").textContent,
    };
  });
  if (!enCurso.disabledConUnPunto) throw new Error("El botón debería seguir deshabilitado con un solo punto");
  if (enCurso.disabledConDosPuntos) throw new Error("El botón 'Aceptar' debería habilitarse con 2 puntos puestos");
  if (enCurso.label !== "Aceptar") throw new Error("La etiqueta del botón debería decir 'Aceptar' durante Cotas: " + enCurso.label);

  // ---- 2) Aceptar (el mismo botón ✓ Cerrar/Aceptar) persiste la cota y queda visible ----
  const trasAceptar = await page.evaluate(() => {
    document.getElementById("btn-cerrar").onclick ? null : null; // noop: solo documenta que se usa el mismo flujo
    terminarCinta();
    return { cotasPlano, modoCinta, puntosCinta, dibujando };
  });
  if (trasAceptar.cotasPlano.length !== 1) throw new Error("No quedó ninguna cota persistida tras aceptar: " + JSON.stringify(trasAceptar));
  if (trasAceptar.modoCinta !== false || trasAceptar.puntosCinta.length !== 0 || trasAceptar.dibujando !== false) {
    throw new Error("No salió limpio del modo Cotas tras aceptar: " + JSON.stringify(trasAceptar));
  }

  // ---- 3) Persiste en window.storage bajo la clave por plano ----
  const guardada = await page.evaluate(async () => {
    const r = await window.storage.get("plano_avance_cotas_VARELA_pl1", true);
    return JSON.parse(r.value);
  });
  if (guardada.length !== 1) throw new Error("La cota no se guardó en storage: " + JSON.stringify(guardada));

  // ---- 4) Sigue visible después de volver a entrar al plano (no era un overlay transitorio) ----
  const trasReabrir = await page.evaluate(async () => {
    await seleccionarPlano("pl1");
    await new Promise(r=>setTimeout(r, 300));
    entrarAEditarPlano();
    await new Promise(r=>setTimeout(r, 150));
    return cotasPlano.length;
  });
  if (trasReabrir !== 1) throw new Error("La cota no sigue visible al reabrir el plano: " + trasReabrir);

  // ---- 5) "Deshacer" ahora sí cubre Cotas: una segunda cota recién aceptada se puede deshacer ----
  await page.evaluate(() => {
    iniciarCintaMetrica();
    confirmarPuntoCinta(0, 0);
    confirmarPuntoCinta(30, 40); // 3-4-5 => 50px
    terminarCinta();
  });
  const antesDeshacer = await page.evaluate(() => cotasPlano.length);
  if (antesDeshacer !== 2) throw new Error("No se agregó la segunda cota: " + antesDeshacer);
  await page.evaluate(() => deshacerGeneral());
  const trasDeshacer = await page.evaluate(() => cotasPlano.length);
  if (trasDeshacer !== 1) throw new Error("'Deshacer' no quitó la cota recién aceptada: " + trasDeshacer);
  const persistidoTrasDeshacer = await page.evaluate(async () => {
    const r = await window.storage.get("plano_avance_cotas_VARELA_pl1", true);
    return JSON.parse(r.value).length;
  });
  if (persistidoTrasDeshacer !== 1) throw new Error("'Deshacer' no guardó el estado corregido de Cotas: " + persistidoTrasDeshacer);

  // ---- 6) "Rehacer" la recupera ----
  await page.evaluate(() => rehacerGeneral());
  const trasRehacer = await page.evaluate(() => cotasPlano.length);
  if (trasRehacer !== 2) throw new Error("'Rehacer' no devolvió la cota: " + trasRehacer);

  // ---- 7) "Gestionar cotas" lista las cotas y permite borrar una sola ----
  await page.evaluate(() => abrirGestionCotas());
  const listaAntes = await page.evaluate(() => document.querySelectorAll("#lista-cotas-plano > div").length);
  if (listaAntes !== 2) throw new Error("La gestión de cotas no lista las 2 creadas: " + listaAntes);
  await page.evaluate(() => borrarCota(0));
  const trasBorrarUna = await page.evaluate(() => cotasPlano.length);
  if (trasBorrarUna !== 1) throw new Error("borrarCota no quitó solo una: " + trasBorrarUna);

  // ---- 8) Cancelar a mitad de camino no persiste nada (distinto de Aceptar) ----
  const trasCancelar = await page.evaluate(() => {
    iniciarCintaMetrica();
    confirmarPuntoCinta(5, 5);
    cancelarDibujo();
    return { modoCinta, dibujando, cantidadCotas: cotasPlano.length };
  });
  if (trasCancelar.modoCinta !== false || trasCancelar.dibujando !== false) throw new Error("Cancelar no salió limpio del modo Cotas: " + JSON.stringify(trasCancelar));
  if (trasCancelar.cantidadCotas !== 1) throw new Error("Cancelar a mitad de camino no debería crear una cota nueva: " + JSON.stringify(trasCancelar));

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-cotas-persistentes");
})().catch((e) => { console.error(e); process.exit(1); });
