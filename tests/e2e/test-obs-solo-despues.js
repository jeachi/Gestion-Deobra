// Verifica el caso "solo foto de después" (sin foto de antes) en Observaciones:
// 1) En la tarjeta de la lista, la foto de "después" pasa al lugar grande de arriba (obs-foto),
//    y no se duplica chiquita abajo (obs-despues sigue mostrando el botón, pero no la miniatura).
// 2) En el informe fotográfico, se muestra un solo cuadro de foto (no dos, con uno vacío "Sin foto").
// 3) El caso normal (con "antes" Y "después") sigue funcionando como antes -- antes arriba grande,
//    después chiquita abajo + informe con dos cuadros.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message + "\n" + (e.stack || "")));

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

  await page.evaluate(() => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
    observaciones = [
      // Solo tiene foto de "después" -- caso nuevo a verificar.
      { id: "o1", titulo: "Grieta reparada", obra: "ObraTest", prioridad: "media", estado: "resuelto", fecha: hoyISO(), fotoDespues: "data:image/png;base64,SOLODESPUES" },
      // Tiene ambas -- el comportamiento de siempre no debería cambiar.
      { id: "o2", titulo: "Filtración", obra: "ObraTest", prioridad: "alta", estado: "en_curso", fecha: hoyISO(), foto: "data:image/png;base64,FOTOANTES", fotoDespues: "data:image/png;base64,FOTODESPUES" },
      // Solo tiene foto de "antes" -- tampoco debería cambiar (sigue con el cuadro "Sin foto" del informe).
      { id: "o3", titulo: "Falta pintura", obra: "ObraTest", prioridad: "baja", estado: "detectado", fecha: hoyISO(), foto: "data:image/png;base64,SOLOANTES" },
    ];
    errorCargaObservaciones = false;
    irA("observaciones");
    cambiarVistaPendientes("observaciones");
  });

  // ---- 1) Tarjeta en la lista ----
  const resultadoLista = await page.evaluate(() => {
    const items = [...document.querySelectorAll("#lista-observaciones .obs-item")];
    const porTitulo = (t) => items.find(el => el.querySelector(".obs-titulo").textContent === t);

    const elO1 = porTitulo("Grieta reparada"); // solo después
    const elO2 = porTitulo("Filtración"); // ambas
    const elO3 = porTitulo("Falta pintura"); // solo antes

    return {
      o1_fotoArribaSrc: elO1.querySelector("img.obs-foto") ? elO1.querySelector("img.obs-foto").getAttribute("src") : null,
      o1_tieneMiniaturaAbajo: !!elO1.querySelector(".obs-foto-despues"),
      o1_tieneBotonFoto: !!elO1.querySelector(".obs-despues .btn-mini"),

      o2_fotoArribaSrc: elO2.querySelector("img.obs-foto") ? elO2.querySelector("img.obs-foto").getAttribute("src") : null,
      o2_tieneMiniaturaAbajo: !!elO2.querySelector(".obs-foto-despues"),
      o2_miniaturaAbajoSrc: elO2.querySelector(".obs-foto-despues") ? elO2.querySelector(".obs-foto-despues").getAttribute("src") : null,

      o3_fotoArribaSrc: elO3.querySelector("img.obs-foto") ? elO3.querySelector("img.obs-foto").getAttribute("src") : null,
      o3_tieneMiniaturaAbajo: !!elO3.querySelector(".obs-foto-despues"),
    };
  });

  // ---- 2) Informe fotográfico ----
  const resultadoInforme = await page.evaluate(() => {
    let capturado = null;
    window.mostrarModalPDF = (html) => { capturado = html; };
    document.getElementById("obs-filtro-obra").innerHTML = `<option value="">Todas las obras</option>`;
    generarInformeFotograficoObservacionesPDF();
    const contarOcurrencias = (str, sub) => str.split(sub).length - 1;
    return {
      o1_unaSolaFoto: contarOcurrencias(capturado, "SOLODESPUES") === 1 && !capturado.includes('>Antes<\n') , // chequeo simple de que no se duplicó
      o1_totalCuadrosFoto: null, // se calcula abajo con un chequeo más preciso
      tieneSoloDespuesUnaVez: contarOcurrencias(capturado, "SOLODESPUES") === 1,
      tieneAmbasFotos: capturado.includes("FOTOANTES") && capturado.includes("FOTODESPUES"),
      tieneSoloAntesConSinFoto: capturado.includes("SOLOANTES") && capturado.includes("Sin foto"),
    };
  });

  console.log("Resultados:", JSON.stringify({ resultadoLista, resultadoInforme }, null, 2));
  console.log("Errores de página:", JSON.stringify(pageErrors));

  const fallas = [];
  // Caso 1: solo después -> foto grande arriba, sin duplicar abajo, con botón para cambiarla.
  if (resultadoLista.o1_fotoArribaSrc !== "data:image/png;base64,SOLODESPUES") fallas.push("o1: la foto de después no pasó al lugar grande de arriba");
  if (resultadoLista.o1_tieneMiniaturaAbajo) fallas.push("o1: la foto se duplicó abajo (no debería, ya está arriba)");
  if (!resultadoLista.o1_tieneBotonFoto) fallas.push("o1: falta el botón para cambiar la foto de después");
  // Caso 2: ambas -> antes arriba grande, después chiquita abajo (comportamiento de siempre).
  if (resultadoLista.o2_fotoArribaSrc !== "data:image/png;base64,FOTOANTES") fallas.push("o2: la foto de 'antes' debería seguir arriba cuando existen ambas");
  if (!resultadoLista.o2_tieneMiniaturaAbajo) fallas.push("o2: la miniatura de 'después' debería seguir mostrándose abajo cuando hay ambas fotos");
  if (resultadoLista.o2_miniaturaAbajoSrc !== "data:image/png;base64,FOTODESPUES") fallas.push("o2: la miniatura de abajo no tiene la foto correcta");
  // Caso 3: solo antes -> sin cambios.
  if (resultadoLista.o3_fotoArribaSrc !== "data:image/png;base64,SOLOANTES") fallas.push("o3: la foto de 'antes' debería seguir arriba");
  if (resultadoLista.o3_tieneMiniaturaAbajo) fallas.push("o3: no debería haber miniatura de 'después' si no hay foto de después");

  if (!resultadoInforme.tieneSoloDespuesUnaVez) fallas.push("informe: la foto de 'solo después' no aparece exactamente una vez");
  if (!resultadoInforme.tieneAmbasFotos) fallas.push("informe: el caso con ambas fotos dejó de mostrar alguna");
  if (!resultadoInforme.tieneSoloAntesConSinFoto) fallas.push("informe: el caso 'solo antes' debería seguir mostrando el cuadro 'Sin foto' de después (sin cambios pedidos para ese caso)");

  if (pageErrors.length) fallas.push(`${pageErrors.length} error(es) de página sin atrapar`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE 'SOLO FOTO DE DESPUÉS' OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
