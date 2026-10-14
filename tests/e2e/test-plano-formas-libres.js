// Pedido del usuario: tener herramientas de dibujo libre (línea, flecha, círculo) visibles en
// el cajón "Dibujar" del Plano de avance -- no existían antes (ver commit de Anotaciones/Cotas,
// donde se confirmó que "Recorrido lineal" es seguimiento de % de avance, no una línea libre).
// Se agrega un subgrupo "Dibujo libre" con Línea/Flecha/Círculo + "Gestionar" para borrarlas.
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

  // ---- 1) Las herramientas están visibles en "Dibujar" (no escondidas en otro lado) ----
  await page.evaluate(() => toggleDrawerHerramientas("dibujar"));
  const dibujoLibre = await page.evaluate(() => {
    const drawer = document.getElementById("drawer-dibujar");
    const labels = [...drawer.querySelectorAll(".tool-card .lbl")].map((l) => l.textContent);
    return labels;
  });
  if (!dibujoLibre.includes("Línea") || !dibujoLibre.includes("Flecha") || !dibujoLibre.includes("Círculo") || !dibujoLibre.includes("Gestionar")) {
    throw new Error("No están Línea/Flecha/Círculo/Gestionar en el cajón Dibujar: " + JSON.stringify(dibujoLibre));
  }

  // ---- 2) Dibujar una línea (2 toques) la persiste con las coordenadas correctas ----
  const lineaCreada = await page.evaluate(() => {
    iniciarFormaPlano("linea");
    confirmarPuntoFormaPlano(10, 20);
    confirmarPuntoFormaPlano(100, 200);
    return { formasPlano, modoFormaPlano, dibujando };
  });
  if (lineaCreada.formasPlano.length !== 1) throw new Error("No se creó la línea: " + JSON.stringify(lineaCreada));
  const linea = lineaCreada.formasPlano[0];
  if (linea.tipo !== "linea" || linea.x1 !== 10 || linea.y1 !== 20 || linea.x2 !== 100 || linea.y2 !== 200) {
    throw new Error("Coordenadas de la línea incorrectas: " + JSON.stringify(linea));
  }
  if (lineaCreada.modoFormaPlano !== null || lineaCreada.dibujando !== false) throw new Error("No salió del modo dibujo tras terminar la línea: " + JSON.stringify(lineaCreada));

  // ---- 3) Flecha y círculo también se crean con su tipo correcto ----
  await page.evaluate(() => {
    iniciarFormaPlano("flecha");
    confirmarPuntoFormaPlano(0, 0);
    confirmarPuntoFormaPlano(50, 0);
    iniciarFormaPlano("circulo");
    confirmarPuntoFormaPlano(300, 300);
    confirmarPuntoFormaPlano(350, 300);
  });
  const tiposCreados = await page.evaluate(() => formasPlano.map((f) => f.tipo));
  if (JSON.stringify(tiposCreados) !== JSON.stringify(["linea", "flecha", "circulo"])) {
    throw new Error("No se crearon los 3 tipos esperados: " + JSON.stringify(tiposCreados));
  }

  // ---- 4) Persisten en window.storage bajo la clave por plano ----
  const guardadas = await page.evaluate(async () => {
    const r = await window.storage.get("plano_avance_formas_VARELA_pl1", true);
    return JSON.parse(r.value).length;
  });
  if (guardadas !== 3) throw new Error("No se guardaron las 3 formas en storage: " + guardadas);

  // ---- 5) Cancelar a mitad de un dibujo no rompe nada y no deja un modo colgado ----
  const trasCancelar = await page.evaluate(() => {
    iniciarFormaPlano("linea");
    confirmarPuntoFormaPlano(5, 5); // primer punto puesto, falta el segundo
    cancelarDibujo();
    return { modoFormaPlano, dibujando, cantidadFormas: formasPlano.length };
  });
  if (trasCancelar.modoFormaPlano !== null || trasCancelar.dibujando !== false) throw new Error("Cancelar no salió limpio del modo: " + JSON.stringify(trasCancelar));
  if (trasCancelar.cantidadFormas !== 3) throw new Error("Cancelar a mitad de camino no debería crear una forma nueva: " + JSON.stringify(trasCancelar));

  // ---- 6) "Gestionar" lista las formas y permite borrar una sola ----
  await page.evaluate(() => abrirGestionFormasPlano());
  const listaAntes = await page.evaluate(() => document.querySelectorAll("#lista-formas-plano > div").length);
  if (listaAntes !== 3) throw new Error("La gestión de formas no lista las 3 creadas: " + listaAntes);
  await page.evaluate(() => borrarFormaPlano(0));
  const trasBorrarUna = await page.evaluate(() => formasPlano.length);
  if (trasBorrarUna !== 2) throw new Error("borrarFormaPlano no quitó solo una: " + trasBorrarUna);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-formas-libres");
})().catch((e) => { console.error(e); process.exit(1); });
