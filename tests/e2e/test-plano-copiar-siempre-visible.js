// Pedido del usuario: "Que el botón de copiar este siempre visible y permita copiar también una
// selección de etiqueta porque selecciono y me salta que no las copio." "Copiar pieza" vivía
// escondido adentro del cajón "Más" y, en modo Copiar, tocar una etiqueta (en vez de un área) no
// hacía nada útil -- las etiquetas tienen su propia capa de toques (badge-anotacion-tocable)
// encima del canvas, que nunca tenía una rama para ese modo, así que el toque se perdía o el
// buscador de áreas del canvas de al lado terminaba avisando "no encontré ninguna pieza ahí".
// Ahora "Copiar" es un botón fijo del riel (no hace falta abrir "Más"), copiar funciona tocando
// una etiqueta igual que tocando un área, y además se puede copiar una selección entera de
// etiquetas de una sola vez desde "Seleccionar".
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

  // ---- 1) "Copiar" está siempre visible en el riel principal, sin abrir "Más" ----
  const rielTieneCopiar = await page.evaluate(() => !!document.getElementById("btn-copiar-pieza-directo") && document.getElementById("cad-riel").contains(document.getElementById("btn-copiar-pieza-directo")));
  if (!rielTieneCopiar) throw new Error("'Copiar' no está en el riel principal (sigue escondido en otro lado)");

  const masYaNoTieneCopiar = await page.evaluate(() => {
    const drawer = document.getElementById("drawer-mas");
    return ![...drawer.querySelectorAll(".tool-card .lbl")].some(l => l.textContent.includes("Copiar"));
  });
  if (!masYaNoTieneCopiar) throw new Error("'Copiar pieza' sigue duplicada adentro de 'Más'");

  // ---- 2) Copiar un ÁREA sigue funcionando igual que antes (no se rompió nada) ----
  await page.evaluate(() => {
    poligonos = [{ nombreCompleto: "Pared - Estructura", nombreBase: "Pared", capa: "Estructura", color: "#3B82F6", patron: "solido", puntos: [[0,0],[10,0],[10,10],[0,10]], area: 100 }];
    redibujar();
  });
  const trasCopiarArea = await page.evaluate(() => {
    toggleModoCopiarPiezaDirecto();
    // Convierte el punto interno del canvas (5,5, adentro del polígono de prueba) a coordenadas de
    // pantalla, igual que hace el propio manejarTapCopiarPiezaDirecto() a la inversa -- así el toque
    // simulado cae de verdad adentro del área sin importar dónde esté posicionado el canvas.
    const canvas = document.getElementById("canvas-plano");
    const rect = canvas.getBoundingClientRect();
    const escalaX = canvas.width/rect.width, escalaY = canvas.height/rect.height;
    const clientX = rect.left + 5/escalaX, clientY = rect.top + 5/escalaY;
    manejarTapCopiarPiezaDirecto({ preventDefault(){}, clientX, clientY });
    return { cantidad: poligonos.length, modoCopiarPiezaDirecto };
  });
  if (trasCopiarArea.cantidad !== 2) throw new Error("Copiar un área dejó de funcionar: " + JSON.stringify(trasCopiarArea));
  if (trasCopiarArea.modoCopiarPiezaDirecto !== false) throw new Error("Copiar un área debería salir del modo tras copiar");

  // ---- 3) Tocar una ETIQUETA en modo Copiar también la copia (antes no hacía nada / avisaba que no) ----
  await page.evaluate(() => {
    anotacionesTexto = [{ x: 200, y: 150, valor: "1.20", tipo: "numero", unidad: "m", categoria: "Ventana", codigo: "V1" }];
    redibujar();
  });
  const trasCopiarEtiqueta = await page.evaluate(() => {
    toggleModoCopiarPiezaDirecto();
    copiarEtiquetaDesdeModoDirecto(0);
    return { cantidad: anotacionesTexto.length, modoCopiarPiezaDirecto, nueva: anotacionesTexto[1] };
  });
  if (trasCopiarEtiqueta.cantidad !== 2) throw new Error("Copiar una etiqueta no la duplicó: " + JSON.stringify(trasCopiarEtiqueta));
  if (trasCopiarEtiqueta.modoCopiarPiezaDirecto !== false) throw new Error("Copiar una etiqueta debería salir del modo Copiar");
  if (trasCopiarEtiqueta.nueva.codigo !== "V1" || trasCopiarEtiqueta.nueva.x === 200) {
    throw new Error("La copia de la etiqueta no mantuvo sus datos o no se corrió de lugar: " + JSON.stringify(trasCopiarEtiqueta.nueva));
  }

  // ---- 4) Persiste la copia de la etiqueta ----
  const guardadas = await page.evaluate(async () => {
    const r = await window.storage.get("plano_avance_textos_VARELA_pl1", true);
    return JSON.parse(r.value).length;
  });
  if (guardadas !== 2) throw new Error("La copia de la etiqueta no se guardó: " + guardadas);

  // ---- 5) Copiar en bloque desde "Seleccionar" (selección múltiple de etiquetas) ----
  await page.evaluate(() => {
    anotacionesTexto = [
      { x: 10, y: 10, valor: "1", tipo: "numero", unidad: "m", categoria: "Ventana", codigo: "V1" },
      { x: 50, y: 50, valor: "2", tipo: "numero", unidad: "m", categoria: "Puerta", codigo: "P1" },
    ];
    redibujar();
  });
  const trasSeleccionarYCopiar = await page.evaluate(() => {
    iniciarModoSeleccionMultiple();
    seleccionarTodasLasEtiquetas();
    copiarSeleccionMultiple();
    return { cantidad: anotacionesTexto.length, seleccionadas: [...anotacionesSeleccionadas], modoSeleccionMultiple };
  });
  if (trasSeleccionarYCopiar.cantidad !== 4) throw new Error("Copiar la selección completa no duplicó las 2: " + JSON.stringify(trasSeleccionarYCopiar));
  if (trasSeleccionarYCopiar.seleccionadas.length !== 2 || !trasSeleccionarYCopiar.seleccionadas.every(i => i >= 2)) {
    throw new Error("Tras copiar en bloque, la selección debería pasar a las copias nuevas: " + JSON.stringify(trasSeleccionarYCopiar));
  }
  if (trasSeleccionarYCopiar.modoSeleccionMultiple !== true) throw new Error("Copiar en bloque no debería salir del modo Seleccionar (para poder seguir operando sobre las copias)");

  // ---- 6) El botón "📋" de copiar en bloque está en la barra de selección múltiple ----
  const barraTieneCopiar = await page.evaluate(() => !!document.querySelector("#barra-seleccion-multiple button[onclick=\"copiarSeleccionMultiple()\"]"));
  if (!barraTieneCopiar) throw new Error("No está el botón de copiar en bloque en la barra de selección múltiple");

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-plano-copiar-siempre-visible");
})().catch((e) => { console.error(e); process.exit(1); });
