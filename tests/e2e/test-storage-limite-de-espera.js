// Pedido del usuario: "la app está lenta y salta que no hay señal cuando tengo full señal en el
// móvil". Causa real: window.storage.get/set/delete/list llamaban directo a Firestore SIN ningún
// límite de tiempo propio -- con una conexión de datos lenta/degradada (algo distinto de "sin
// señal de antena": el teléfono puede mostrar todas las rayitas y aun así tener un camino lento o
// cortado hasta los servidores de Google), el SDK de Firestore podía quedarse esperando una
// respuesta mucho tiempo antes de rendirse solo -- de ahí la sensación de "lentitud", y recién
// DESPUÉS de ese rato largo caía al aviso de "sin conexión".
//
// El arreglo agrega un límite de tiempo (conLimiteDeEspera, 10s) a las 4 operaciones -- así
// cualquier pedido colgado se da por perdido rápido y cae al mecanismo que ya existía (caché local
// de lectura para get/list, cola de reintento para set), en vez de dejar a la persona esperando.
//
// Este test simula justo ese escenario: un Firestore falso cuyo .get()/.set() NUNCA resuelve (un
// cuelgue real, no un rechazo rápido) y confirma que la app no se queda esperando para siempre.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.addInitScript(() => {
    // El arranque de la app hace sus propias lecturas de Firestore ANTES de que el test llegue a
    // tocar nada (obras, categorías, trabajadores, etc.) -- esas tienen que resolver rápido, como
    // en cualquier otro test, para no confundir "la app arrancó lenta porque la mockeamos mal" con
    // el bug real que se está probando. Solo la clave puntual del test ("gdo_test_limite_espera")
    // simula el cuelgue real (una promesa que nunca resuelve ni rechaza).
    const CLAVE_QUE_CUELGA = "gdo_test_limite_espera";
    const fakeDocs = {};
    function fakeDocRef(id) {
      return {
        async get() {
          if (id === CLAVE_QUE_CUELGA) return new Promise(() => {});
          const d = fakeDocs[id];
          return { exists: !!d, data: () => d };
        },
        async set(v) {
          if (id === CLAVE_QUE_CUELGA) return new Promise(() => {});
          fakeDocs[id] = v;
        },
        async delete() { delete fakeDocs[id]; },
      };
    }
    const fakeDb = {
      collection() {
        return {
          doc: (id) => fakeDocRef(id),
          async get() { return { docs: Object.keys(fakeDocs).map((id) => ({ id, data: () => fakeDocs[id] })) }; },
        };
      },
    };
    window.firebase = {
      initializeApp() {},
      firestore() { return fakeDb; },
      auth() { return { signInAnonymously: () => Promise.resolve() }; },
    };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  const resultado = await page.evaluate(async () => {
    const clave = "gdo_test_limite_espera";
    // Se precarga la copia local de lectura (como si ya se hubiera leído esta clave con éxito
    // alguna vez, antes de que la conexión se degradara) para poder confirmar la caída a caché.
    localStorage.setItem("gdo_cache_" + clave, JSON.stringify({ hola: "mundo" }));

    const inicioGet = Date.now();
    let getTiroError = false, getCayoACache = false, valorGet = null;
    try {
      const r = await window.storage.get(clave);
      getCayoACache = r.desdeCache === true;
      valorGet = r.value;
    } catch (e) {
      getTiroError = true;
    }
    const duracionGetMs = Date.now() - inicioGet;

    const inicioSet = Date.now();
    let setQuedoPendiente = false;
    const r2 = await window.storage.set(clave, JSON.stringify({ chau: "mundo" }));
    setQuedoPendiente = r2.pendiente === true;
    const duracionSetMs = Date.now() - inicioSet;

    return { duracionGetMs, getTiroError, getCayoACache, valorGet, duracionSetMs, setQuedoPendiente };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  // Con el cuelgue simulado (que nunca resuelve), get() debería caer a la caché local -- rápido,
  // no después de esperar para siempre. Se da un margen generoso (20s) sobre el límite real (10s)
  // para no depender de la velocidad exacta de esta máquina, pero muy por debajo de "para siempre".
  if (resultado.duracionGetMs > 20000) fallas.push(`BUG REPRODUCIDO: get() se quedó esperando ${resultado.duracionGetMs}ms (sin límite de tiempo propio) en vez de rendirse rápido`);
  if (!resultado.getCayoACache) fallas.push("Con el pedido real colgado, get() debería caer a la copia local guardada (desdeCache:true)");
  if (resultado.valorGet !== JSON.stringify({ hola: "mundo" })) fallas.push("El valor devuelto desde la caché no es el esperado");
  if (resultado.duracionSetMs > 20000) fallas.push(`BUG REPRODUCIDO: set() se quedó esperando ${resultado.duracionSetMs}ms (sin límite de tiempo propio) en vez de rendirse rápido`);
  if (!resultado.setQuedoPendiente) fallas.push("Con el pedido real colgado, set() debería caer a la cola de reintento (pendiente:true) en vez de colgarse");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log(`\nTODOS LOS CHEQUEOS DEL LÍMITE DE ESPERA DE FIRESTORE OK (get: ${resultado.duracionGetMs}ms, set: ${resultado.duracionSetMs}ms)`);
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
