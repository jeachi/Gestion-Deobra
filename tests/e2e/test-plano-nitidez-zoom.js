// El usuario pidió que los planos se vean menos pixelados al hacer zoom. Tres cambios, todos
// apuntando a la misma causa (muy poca resolución real guardada): 1) comprimirImagenPlano() sube
// su default de 1600px/calidad 0.78 a 2000px/0.80 -- la copia que SIEMPRE existe en Firestore
// (límite duro de 1MB por documento, medido con margen real antes de subir esto, ver
// medir-tamanos-plano.js); 2) la copia "alta resolución" que se sube a Firebase Storage (sin ese
// límite de 1MB) sube de 3000px/0.88 a 3600px/0.90; 3) el render inicial de un PDF sube de escala
// 2 a escala 3, para que haya más detalle real que conservar en los dos puntos anteriores (el PDF
// es vectorial -- comprimir más fuerte un render ya pobre no devuelve nitidez que nunca se generó).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  // ---- 1) comprimirImagenPlano() sin argumentos (la copia que SIEMPRE se guarda en Firestore) ----
  const copiaSiempre = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 5000; canvas.height = 3000; // bien más grande que cualquier maxDim, para que SÍ achique
    canvas.getContext("2d").fillStyle = "#fff";
    canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = canvas.toDataURL("image/png"); });
    const { img: imgComprimida, dataUrl } = await comprimirImagenPlano(img);
    return { width: imgComprimida.width, height: imgComprimida.height, tipo: dataUrl.slice(0, 30) };
  });

  // ---- 2) La copia "alta resolución" (Storage) via guardarPlanoAvanceImagen, capturando qué dataUrl le pasa a subirImagenPlanoAStorage ----
  const copiaAlta = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 5000; canvas.height = 3000;
    canvas.getContext("2d").fillStyle = "#fff";
    canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
    const imgOriginal = new Image();
    await new Promise((resolve, reject) => { imgOriginal.onload = resolve; imgOriginal.onerror = reject; imgOriginal.src = canvas.toDataURL("image/png"); });

    let dataUrlCapturada = null;
    const originalSubir = window.subirImagenPlanoAStorage;
    window.subirImagenPlanoAStorage = async (obra, planoId, dataUrlAlta) => { dataUrlCapturada = dataUrlAlta; return "https://ejemplo.fake/plano-alta.jpg"; };
    const originalDisponible = window.storageDeArchivosDisponible;
    window.storageDeArchivosDisponible = () => true;

    obraPredeterminada = "ObraNitidez"; obras = ["ObraNitidez"]; obrasFinalizadas = [];
    claveObraPlanoAvance = () => "ObraNitidez"; // evita depender de sesión/usuario para este test puntual
    planoActualId = "plano-nitidez-test";

    await guardarPlanoAvanceImagen("data:image/jpeg;base64,x", imgOriginal);

    window.subirImagenPlanoAStorage = originalSubir;
    window.storageDeArchivosDisponible = originalDisponible;
    return dataUrlCapturada;
  });
  const imgAlta = copiaAlta ? await page.evaluate((dataUrl) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = reject;
    img.src = dataUrl;
  }), copiaAlta) : null;

  // ---- 3) Escala del render de un PDF (pdfjsLib simulado, mide qué viewport pide la app) ----
  const escalaPdf = await page.evaluate(async () => {
    let scalePedida = null;
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument: () => ({ promise: Promise.resolve({
        getPage: async () => ({
          getViewport: ({ scale }) => { scalePedida = scale; return { width: 850 * scale, height: 1100 * scale }; },
          render: () => ({ promise: Promise.resolve() }),
        }),
      }) }),
    };
    const fakeFile = { type: "application/pdf", arrayBuffer: async () => new ArrayBuffer(8) };
    await cargarImagenDesdeArchivo(fakeFile, 1);
    delete window.pdfjsLib;
    return scalePedida;
  });

  const resultado = {
    copiaSiempre,
    copiaAltaDimensiones: imgAlta ? { width: imgAlta.width, height: imgAlta.height } : null,
    escalaPdf,
  };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (copiaSiempre.width !== 2000) fallas.push(`BUG: comprimirImagenPlano() sin argumentos debería achicar a 2000px de lado más largo, dio ${copiaSiempre.width}`);
  if (!copiaSiempre.tipo.includes("image/jpeg")) fallas.push(`BUG: la copia de siempre debería seguir siendo JPEG, dio '${copiaSiempre.tipo}'`);
  if (!imgAlta) fallas.push("BUG: no se pudo capturar el dataUrl de la copia de alta resolución (¿se llamó a subirImagenPlanoAStorage?)");
  else if (imgAlta.width !== 3600) fallas.push(`BUG: la copia de alta resolución debería achicarse a 3600px de lado más largo, dio ${imgAlta.width}`);
  if (escalaPdf !== 3) fallas.push(`BUG: el render inicial de un PDF debería pedirse a escala 3, pidió escala ${escalaPdf}`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE NITIDEZ DE PLANOS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
