// Pedido del usuario: "una cuadrícula estilo Revit -- líneas de ejes que se intersectan y
// permitan colocar pines o etiquetas, con un botón de colocación en lote, que se pueda borrar la
// rejilla después y agregar más líneas con la misma distancia, para los 2 tipos de plano."
// Investigado cómo funciona en Revit: las líneas de grilla se numeran solas (columnas 1,2,3 /
// filas A,B,C), se ponen una por vez tipeando la distancia a la siguiente (requiere escala
// calibrada -- por eso el Maestro ahora también tiene el botón "Escala"), y sus cruces
// identifican un punto preciso (ej. "A1") para ubicar un elemento ahí.
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
    const planoAv = { id:"av1", nombre:"Avance", fecha:hoyISO() };
    const planoM = { id:"plM", nombre:"Maestro", tipo:"maestro", fecha:hoyISO() };
    await window.storage.set("planos_avance_index_VARELA", JSON.stringify([planoAv, planoM]), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoAv.id}`, imgFalsa(), true);
    await window.storage.set(`plano_avance_imagen_VARELA_${planoM.id}`, imgFalsa(), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
  });

  // ---- 1) Sin escala calibrada, "Rejilla" avisa y no arranca ----
  const sinEscala = await page.evaluate(async () => {
    await seleccionarPlano("av1", true);
    await new Promise(r=>setTimeout(r, 300));
    iniciarRejilla();
    return { modoColumnas: modoRejillaColumnas, rejillaEnCurso };
  });
  if (sinEscala.modoColumnas || sinEscala.rejillaEnCurso) throw new Error("Sin escala calibrada, Rejilla no debería arrancar: " + JSON.stringify(sinEscala));

  // ---- 2) Calibrar la escala a mano (100px = 1m, para que las cuentas sean redondas) ----
  await page.evaluate(async () => {
    metrosPorPixelPlano = 0.01; // 1px = 1cm -> 100px = 1m
    await guardarCalibracionPlano();
  });

  // ---- 3) Armar una rejilla de 2 columnas x 2 filas en el plano de AVANCE ----
  const rejillaAvance = await page.evaluate(async () => {
    iniciarRejilla();
    const arranco = modoRejillaColumnas;
    manejarTapRejillaColumna(100, 50); // columna "1" en x=100
    document.getElementById("rejilla-distancia").value = "2"; // 2m = 200px
    confirmarSiguienteLineaRejilla("v"); // columna "2" en x=300
    iniciarRejillaFilas();
    manejarTapRejillaFila(0, 80); // fila "A" en y=80
    document.getElementById("rejilla-distancia").value = "3"; // 3m = 300px
    confirmarSiguienteLineaRejilla("h"); // fila "B" en y=380
    terminarRejilla();
    await new Promise(r=>setTimeout(r, 50));
    const lineas = lineasReferencia.map(l=>({orientacion:l.orientacion, pos:l.pos, nombre:l.nombre}));
    const r = await window.storage.get("plano_avance_ejes_VARELA_av1", true);
    return { arranco, lineas, persistido: r && r.value ? JSON.parse(r.value).length : 0 };
  });
  if (!rejillaAvance.arranco) throw new Error("Con escala calibrada, Rejilla debería arrancar y esperar el primer toque");
  if (rejillaAvance.lineas.length !== 4) throw new Error("Deberían quedar 4 líneas (2 columnas + 2 filas): " + JSON.stringify(rejillaAvance.lineas));
  const nombres = rejillaAvance.lineas.map(l=>l.nombre).sort();
  if (JSON.stringify(nombres) !== JSON.stringify(["1","2","A","B"])) throw new Error("Numeración esperada 1,2 (columnas) y A,B (filas): " + JSON.stringify(nombres));
  const columna2 = rejillaAvance.lineas.find(l=>l.nombre==="2");
  if (Math.abs(columna2.pos - 300) > 1) throw new Error("La columna 2 debería quedar a 200px (2m) de la columna 1: " + columna2.pos);
  const filaB = rejillaAvance.lineas.find(l=>l.nombre==="B");
  if (Math.abs(filaB.pos - 380) > 1) throw new Error("La fila B debería quedar a 300px (3m) de la fila A: " + filaB.pos);
  if (rejillaAvance.persistido !== 4) throw new Error("La rejilla debería quedar persistida en storage: " + rejillaAvance.persistido);

  // ---- 4) "Colocar en cada cruce" (avance) pide categoría y crea 4 etiquetas nombradas por cruce ----
  const grupoId = await page.evaluate(() => lineasReferencia[0].grupoId);
  const etiquetasCreadas = await page.evaluate(async (grupoId) => {
    abrirColocarEnRejilla(grupoId);
    const textoSelector = document.getElementById("foto-avance-cuerpo") ? null : document.querySelector(".generic-prompt-overlay, #prompt-generico-overlay");
    confirmarEtiquetasEnRejilla("Ventana");
    await new Promise(r=>setTimeout(r, 50));
    return anotacionesTexto.map(a=>({ubicacion:a.ubicacion, categoria:a.categoria, codigo:a.codigo}));
  }, grupoId);
  if (etiquetasCreadas.length !== 4) throw new Error("Deberían crearse 4 etiquetas, una por cruce: " + JSON.stringify(etiquetasCreadas));
  const ubicaciones = etiquetasCreadas.map(e=>e.ubicacion).sort();
  if (JSON.stringify(ubicaciones) !== JSON.stringify(["A1","A2","B1","B2"])) throw new Error("Las etiquetas deberían nombrarse por su cruce (fila+columna): " + JSON.stringify(ubicaciones));
  if (!etiquetasCreadas.every(e=>e.categoria==="Ventana" && /^V\d+$/.test(e.codigo))) throw new Error("Las etiquetas deberían tener la categoría elegida y un código V1,V2...: " + JSON.stringify(etiquetasCreadas));

  // ---- 5) Correr "Colocar en cada cruce" de nuevo no duplica (ya hay una etiqueta en cada cruce) ----
  const sinDuplicar = await page.evaluate(async (grupoId) => {
    abrirColocarEnRejilla(grupoId);
    confirmarEtiquetasEnRejilla("Ventana");
    await new Promise(r=>setTimeout(r, 50));
    return anotacionesTexto.length;
  }, grupoId);
  if (sinDuplicar !== 4) throw new Error("No debería duplicar etiquetas ya puestas en cada cruce: " + sinDuplicar);

  // ---- 6) "Agregar una columna más" repite la misma distancia (array/copy estilo Revit) ----
  const columnaExtra = await page.evaluate((grupoId) => {
    agregarLineaRejillaExtra(grupoId, "v");
    const columnas = lineasReferencia.filter(l=>l.grupoId===grupoId && l.orientacion==="v").sort((a,b)=>a.pos-b.pos);
    return columnas.map(c=>({pos:c.pos, nombre:c.nombre}));
  }, grupoId);
  if (columnaExtra.length !== 3) throw new Error("Debería haber 3 columnas tras agregar una más: " + JSON.stringify(columnaExtra));
  if (columnaExtra[2].nombre !== "3") throw new Error("La columna agregada debería numerarse '3': " + JSON.stringify(columnaExtra));
  if (Math.abs(columnaExtra[2].pos - columnaExtra[1].pos - 200) > 1) throw new Error("La columna agregada debería repetir la misma distancia (200px) que las anteriores: " + JSON.stringify(columnaExtra));

  // ---- 7) Borrar la rejilla completa no toca las etiquetas ya creadas ----
  const trasBorrarRejilla = await page.evaluate((grupoId) => {
    borrarGrupoLineasReferencia(grupoId);
    return { lineas: lineasReferencia.filter(l=>l.grupoId===grupoId).length, etiquetas: anotacionesTexto.length };
  }, grupoId);
  if (trasBorrarRejilla.lineas !== 0) throw new Error("Borrar la rejilla debería sacar todas sus líneas: " + trasBorrarRejilla.lineas);
  if (trasBorrarRejilla.etiquetas !== 4) throw new Error("Borrar la rejilla NO debería tocar las etiquetas ya creadas: " + trasBorrarRejilla.etiquetas);

  // ---- 8) El Plano Maestro ahora también tiene Escala y Rejilla, y "en cada cruce" crea PINES ----
  const maestro = await page.evaluate(async () => {
    await seleccionarPlano("plM", true);
    await new Promise(r=>setTimeout(r, 300));
    const btnAlinear = document.getElementById("btn-drawer-medir-maestro");
    const tieneEscalaYRejilla = document.getElementById("drawer-medirMaestro").textContent;
    metrosPorPixelPlano = 0.01;
    await guardarCalibracionPlano();
    iniciarRejilla();
    manejarTapRejillaColumna(100, 50);
    document.getElementById("rejilla-distancia").value = "2";
    confirmarSiguienteLineaRejilla("v");
    iniciarRejillaFilas();
    manejarTapRejillaFila(0, 80);
    document.getElementById("rejilla-distancia").value = "2";
    confirmarSiguienteLineaRejilla("h");
    terminarRejilla();
    const gId = lineasReferencia[0].grupoId;
    abrirColocarEnRejilla(gId);
    const overlayConfirmPines = document.getElementById("prompt-generico-overlay") ? document.getElementById("prompt-generico-overlay").textContent : "";
    confirmarPinesEnRejilla();
    await new Promise(r=>setTimeout(r, 50));
    return {
      existeBtnAlinear: !!btnAlinear,
      tieneEscalaYRejilla,
      overlayConfirmPines,
      pines: pinesMaestro.map(p=>p.nombre),
    };
  });
  if (!maestro.existeBtnAlinear) throw new Error("El Plano Maestro debería tener un botón 'ALINEAR' en el riel");
  if (!maestro.tieneEscalaYRejilla.includes("Escala") || !maestro.tieneEscalaYRejilla.includes("Rejilla")) {
    throw new Error("El cajón 'Alinear y calibrar' del Maestro debería tener Escala y Rejilla: " + maestro.tieneEscalaYRejilla);
  }
  if (maestro.pines.length !== 4) throw new Error("Deberían crearse 4 pines, uno por cruce, en el Maestro: " + JSON.stringify(maestro.pines));
  if (JSON.stringify(maestro.pines.sort()) !== JSON.stringify(["A1","A2","B1","B2"])) throw new Error("Los pines deberían nombrarse por su cruce: " + JSON.stringify(maestro.pines));

  // ---- 9) Fix de bug real: cancelarDibujo() ya no borra toda la rejilla del Maestro ----
  const trasCancelar = await page.evaluate(() => {
    toggleModoAgregarPin(); // activa un modo cualquiera que termine en cancelarDibujo()
    cancelarDibujo();
    return lineasReferencia.length;
  });
  if (trasCancelar !== 4) throw new Error("cancelarDibujo() no debería borrar los ejes/rejilla del plano: " + trasCancelar);

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-rejilla");
})().catch((e) => { console.error(e); process.exit(1); });
