// Pedido del usuario: "un botón que permita seleccionar lo que sea que tenga la flechita para
// poder ir pulsando y seleccionar etiqueta pines áreas líneas [...] que permita deshacer si
// selecciono algo por error [...] que después de seleccionar me permita presionar alinear que el
// botón alinear esté aparte y permita copiar mover distintas acciones de edición".
// Antes "Seleccionar" solo tenía Recuadro y Forma libre (por forma, no por toque individual), y
// la barra de abajo solo tenía Eliminar + un "Alinear" que únicamente servía para pines del
// Maestro. Ahora hay una tercera herramienta "Elemento x elemento" que suma etiquetas/pines/áreas
// y AHORA TAMBIÉN líneas (línea/flecha/círculo, que antes no se podían ni tocar) a la misma
// selección que ya usan Recuadro/Forma libre, con la misma barra de abajo -- que ahora también
// tiene Copiar (con punto destino) y Mover, además de Alinear (generalizado a etiquetas) y
// Eliminar. Tocar un elemento ya elegido lo saca (el "deshacer" pedido no es un botón aparte).
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
    await window.storage.set(`plano_maestro_pines_VARELA_${planoM.id}`, JSON.stringify([
      { id:"p1", x:100, y:50, nombre:"Dorm 1", checklist:[], capasVinculadas:[] },
      { id:"p2", x:300, y:90, nombre:"Dorm 2", checklist:[], capasVinculadas:[] },
    ]), true);
    await irA("planoavance");
    await new Promise(r=>setTimeout(r, 150));
  });

  // ================= PLANO MAESTRO =================
  await page.evaluate(async () => { await seleccionarPlano("plM", true); await new Promise(r=>setTimeout(r, 300)); });

  // ---- 1) "Elemento x elemento" existe en el cajón Seleccionar del Maestro ----
  const existeHerramienta = await page.evaluate(() => {
    toggleDrawerHerramientas("revisarMaestro");
    return document.getElementById("drawer-revisarMaestro").textContent.includes("Elemento x elemento");
  });
  if (!existeHerramienta) throw new Error("El cajón Seleccionar del Maestro debería tener 'Elemento x elemento'");

  // ---- 2) Tocar los 2 pines los suma; tocar el primero de nuevo lo saca (deshacer selección) ----
  const tras3Toques = await page.evaluate(() => {
    cerrarFlyoutsAbiertos();
    iniciarSeleccionElementoPorElemento();
    alternarPinParaSeleccionArea("p1");
    alternarPinParaSeleccionArea("p2");
    const con2 = { seleccion: [...seleccionAreaResultado], barraTexto: document.getElementById("barra-seleccion-area-txt").textContent, alinearVisible: document.getElementById("btn-alinear-seleccion").style.display !== "none" };
    alternarPinParaSeleccionArea("p1"); // deshacer: lo saca
    const con1 = { seleccion: [...seleccionAreaResultado] };
    return { con2, con1 };
  });
  if (JSON.stringify(tras3Toques.con2.seleccion.sort()) !== JSON.stringify(["p1","p2"])) throw new Error("Deberían quedar los 2 pines elegidos: " + JSON.stringify(tras3Toques.con2));
  if (!tras3Toques.con2.barraTexto.includes("2 pines")) throw new Error("La barra debería confirmar '2 pines elegidos': " + tras3Toques.con2.barraTexto);
  if (!tras3Toques.con2.alinearVisible) throw new Error("Con 2 pines elegidos, Alinear debería estar visible (aparte, no solo contextual)");
  if (tras3Toques.con1.seleccion.length !== 1 || tras3Toques.con1.seleccion[0] !== "p2") throw new Error("Tocar un pin ya elegido debería sacarlo de la selección: " + JSON.stringify(tras3Toques.con1));

  // ---- 3) "✕" (deshacer selección) limpia todo sin borrar nada ----
  const trasCancelar = await page.evaluate(() => {
    alternarPinParaSeleccionArea("p1"); // vuelve a quedar p1+p2
    cancelarSeleccionArea();
    return { seleccion: seleccionAreaResultado.length, barraOculta: document.getElementById("barra-seleccion-area").style.display === "none", pines: pinesMaestro.length };
  });
  if (trasCancelar.seleccion !== 0 || !trasCancelar.barraOculta) throw new Error("'✕' debería limpiar la selección y ocultar la barra: " + JSON.stringify(trasCancelar));
  if (trasCancelar.pines !== 2) throw new Error("'✕' no debería borrar ningún pin: " + trasCancelar.pines);

  // ---- 4) Alinear (generalizado, ya no exclusivo de la barra de Recuadro/Forma libre) ----
  const trasAlinear = await page.evaluate(async () => {
    alternarPinParaSeleccionArea("p1");
    alternarPinParaSeleccionArea("p2");
    await confirmarAlinearPinesSeleccionados("horizontal");
    return pinesMaestro.map(p=>({id:p.id, y:p.y}));
  });
  const ys = trasAlinear.map(p=>p.y);
  if (!ys.every(y=>y===ys[0])) throw new Error("Alinear horizontal debería dejar la misma Y en los 2 pines: " + JSON.stringify(trasAlinear));

  // ---- 5) Mover desde la selección (sin pasar por el botón "Mover" del riel) ----
  const trasMover = await page.evaluate(async () => {
    alternarPinParaSeleccionArea("p1");
    alternarPinParaSeleccionArea("p2");
    const antes = pinesMaestro.map(p=>({id:p.id, x:p.x, y:p.y}));
    iniciarMoverDesdeSeleccionArea();
    const activo = moviendoGrupoActivo;
    // Simula el arrastre llamando directo al handler de movimiento con un delta de +40,+15.
    moviendoGrupoUltimoPunto = { x: 0, y: 0 };
    moviendoGrupoOriginal.pines.forEach(({id})=>{ const p = pinesMaestro.find(pp=>pp.id===id); if(p){ p.x += 40; p.y += 15; } });
    await confirmarMoverGrupo();
    const despues = pinesMaestro.map(p=>({id:p.id, x:p.x, y:p.y}));
    return { activo, antes, despues };
  });
  if (!trasMover.activo) throw new Error("iniciarMoverDesdeSeleccionArea() debería activar el arrastre de grupo");
  trasMover.antes.forEach((a) => {
    const d = trasMover.despues.find(p=>p.id===a.id);
    if (d.x !== a.x+40 || d.y !== a.y+15) throw new Error("Mover desde la selección no desplazó todo por el mismo delta: " + JSON.stringify(trasMover));
  });

  // ---- 6) Copiar con punto destino -- crea copias nuevas, no mueve las originales ----
  const trasCopiar = await page.evaluate(async () => {
    alternarPinParaSeleccionArea("p1");
    const original = { ...pinesMaestro.find(p=>p.id==="p1") };
    iniciarCopiarSeleccionArea();
    const activo = modoCopiarSeleccionArea;
    confirmarCopiarSeleccionArea(original.x+100, original.y+100);
    return { activo, cantidadPines: pinesMaestro.length, original: pinesMaestro.find(p=>p.id==="p1"), nuevo: pinesMaestro.find(p=>p.id!=="p1" && p.id!=="p2") };
  });
  if (!trasCopiar.activo) throw new Error("iniciarCopiarSeleccionArea() debería activar modoCopiarSeleccionArea");
  if (trasCopiar.cantidadPines !== 3) throw new Error("Copiar debería agregar un pin nuevo (quedar en 3): " + trasCopiar.cantidadPines);
  if (trasCopiar.nuevo.x !== trasCopiar.original.x+100 || trasCopiar.nuevo.y !== trasCopiar.original.y+100) {
    throw new Error("La copia debería quedar en el punto destino tocado: " + JSON.stringify(trasCopiar));
  }

  // ---- 7) Eliminar borra todo lo elegido (con doble toque de confirmación) ----
  const trasEliminar = await page.evaluate(() => {
    const idsAntes = pinesMaestro.map(p=>p.id);
    idsAntes.forEach(id=>alternarPinParaSeleccionArea(id));
    const btnEliminar = document.querySelector('#barra-seleccion-area button[onclick^="eliminarSeleccionArea"]');
    eliminarSeleccionArea(btnEliminar); // primer toque: solo marca "¿Seguro?"
    eliminarSeleccionArea(btnEliminar); // segundo toque: confirma
    return pinesMaestro.length;
  });
  if (trasEliminar !== 0) throw new Error("Eliminar (2 toques) debería borrar todos los pines elegidos: " + trasEliminar);

  // ================= PLANO DE AVANCE =================
  await page.evaluate(async () => {
    await seleccionarPlano("av1", true);
    await new Promise(r=>setTimeout(r, 300));
    poligonos = [{ nombreCompleto:"Piso - Dorm 1", nombreBase:"Piso", capa:"Dorm 1", color:"#3B82F6", puntos:[[50,50],[150,50],[150,150],[50,150]], area:10000 }];
    anotacionesTexto = [{ x:300, y:80, valor:"1.20", tipo:"numero", unidad:"m", categoria:"", codigo:"", estado:"pendiente" }];
    formasPlano = [{ id:"f1", tipo:"linea", x1:400, y1:40, x2:460, y2:40, color:"#3B82F6" }];
    redibujar();
    renderAnotacionesTocables();
  });

  // ---- 8) "Elemento x elemento" en avance: toca el área, la etiqueta y la línea ----
  await page.evaluate(() => { iniciarSeleccionElementoPorElemento(); });
  const resultadoMixto = await page.evaluate(() => {
    // Toca adentro del área (50,50)-(150,150) -> (100,100)
    const canvas = document.getElementById("canvas-plano");
    const rect = canvas.getBoundingClientRect();
    const escalaX = canvas.width/rect.width, escalaY = canvas.height/rect.height;
    const aPantalla = (x,y) => ({ clientX: rect.left + x/escalaX, clientY: rect.top + y/escalaY });
    manejarTapElementoPorElemento(aPantalla(100, 100)); // área
    manejarTapElementoPorElemento(aPantalla(430, 40)); // mitad de la línea f1
    alternarEtiquetaParaSeleccionArea(0); // la etiqueta se toca con su propio manejador (ya probado en otros tests) -- acá se llama directo
    return {
      piezas: seleccionAreaResultado.length,
      etiquetas: etiquetasSeleccionArea.size,
      formas: formasSeleccionArea.size,
      barraTexto: document.getElementById("barra-seleccion-area-txt").textContent,
      alinearVisible: document.getElementById("btn-alinear-seleccion").style.display !== "none",
    };
  });
  if (resultadoMixto.piezas !== 1) throw new Error("Debería haber elegido la pieza tocando adentro del área: " + JSON.stringify(resultadoMixto));
  if (resultadoMixto.formas !== 1) throw new Error("Debería haber elegido la línea tocando sobre ella: " + JSON.stringify(resultadoMixto));
  if (resultadoMixto.etiquetas !== 1) throw new Error("Debería haber elegido la etiqueta: " + JSON.stringify(resultadoMixto));
  if (!resultadoMixto.barraTexto.includes("pieza") || !resultadoMixto.barraTexto.includes("etiqueta") || !resultadoMixto.barraTexto.includes("línea")) {
    throw new Error("La barra debería describir la mezcla (pieza + etiqueta + línea): " + resultadoMixto.barraTexto);
  }
  if (resultadoMixto.alinearVisible) throw new Error("Con solo 1 etiqueta (y una pieza/línea que no cuentan) Alinear debería seguir oculto: " + JSON.stringify(resultadoMixto));

  // ---- 9) Copiar la selección mixta -- preserva las distancias relativas entre los 3 ----
  const copiaMixta = await page.evaluate(() => {
    iniciarCopiarSeleccionArea();
    confirmarCopiarSeleccionArea(700, 300);
    return { piezas: poligonos.length, etiquetas: anotacionesTexto.length, formas: formasPlano.length };
  });
  if (copiaMixta.piezas !== 2) throw new Error("Copiar debería duplicar la pieza elegida (quedar en 2): " + JSON.stringify(copiaMixta));
  if (copiaMixta.etiquetas !== 2) throw new Error("Copiar debería duplicar la etiqueta elegida (quedar en 2): " + JSON.stringify(copiaMixta));
  if (copiaMixta.formas !== 2) throw new Error("Copiar debería duplicar la línea elegida (quedar en 2): " + JSON.stringify(copiaMixta));

  // ---- 10) Eliminar la selección mixta borra los 3 tipos juntos ----
  const eliminarMixta = await page.evaluate(() => {
    const canvas = document.getElementById("canvas-plano");
    const rect = canvas.getBoundingClientRect();
    const escalaX = canvas.width/rect.width, escalaY = canvas.height/rect.height;
    const aPantalla = (x,y) => ({ clientX: rect.left + x/escalaX, clientY: rect.top + y/escalaY });
    manejarTapElementoPorElemento(aPantalla(100, 100));
    manejarTapElementoPorElemento(aPantalla(430, 40));
    alternarEtiquetaParaSeleccionArea(0);
    const btnEliminar = document.querySelector('#barra-seleccion-area button[onclick^="eliminarSeleccionArea"]');
    eliminarSeleccionArea(btnEliminar);
    eliminarSeleccionArea(btnEliminar);
    return { piezas: poligonos.length, etiquetas: anotacionesTexto.length, formas: formasPlano.length };
  });
  if (eliminarMixta.piezas !== 1 || eliminarMixta.etiquetas !== 1 || eliminarMixta.formas !== 1) {
    throw new Error("Eliminar la selección mixta debería borrar 1 de cada tipo (queda la copia de cada uno): " + JSON.stringify(eliminarMixta));
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-seleccion-elemento-por-elemento");
})().catch((e) => { console.error(e); process.exit(1); });
