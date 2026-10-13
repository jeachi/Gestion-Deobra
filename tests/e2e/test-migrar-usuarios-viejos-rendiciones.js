// Tras recuperar del incidente de datos 8 rendiciones de Caja Chica (ver conversación con el
// usuario y PR #124), el usuario reportó que después de cargarlas solo veía la rendición N°3 --
// las otras 7 quedaron con los nombres de usuario VIEJOS ("JESUS CHIMINO" en mayúsculas sin
// tilde, "Agustín Bobarin" -- capataz que ya no existe como cuenta), y el filtro "cada uno ve su
// propia caja" de renderListaRendiciones() las deja invisibles para siempre porque ningún usuario
// actual coincide textualmente (la cuenta real hoy es "Jesús chimino", con otra tilde/mayúscula,
// y "capataz1" en vez de "Agustín Bobarin"). Este botón-fantasma ya se sacó (PR #125) -- esto
// prueba la corrección silenciosa que lo reemplaza: se dispara sola al abrir Caja Chica, sin
// botón ni aviso visible, y usa el mismo criterio que ya usa quitarUsuario() al borrar una cuenta.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => d.accept());

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
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    // La cuenta real hoy: otra tilde/mayúscula que la que quedó grabada en las rendiciones viejas.
    usuarios = [{ username: "Jesús chimino", role: "admin", password: "x".repeat(64) }, { username: "capataz1", role: "capataz", permisos: {} }];
  });

  // ---- Prepara el estado: 8 rendiciones como quedaron del incidente (7 con usuario viejo, 1 en blanco) ----
  await page.evaluate(async () => {
    rendicionesIndex = [
      { id: "r3", numero: 3, usuario: "", obra: "VARELA", responsable: "JESUS CHIMINO", mes: "Julio", quincena: "1ra Quincena", saldoAnterior: 0, totalGastos: 108080, totalCaja: 100000, diferencia: -8080, cerradaManual: true },
      { id: "r8", numero: 8, usuario: "Agustín Bobarin", obra: "VARELA", responsable: "Agustín Bobarin", mes: "Junio", quincena: "1ra Quincena", saldoAnterior: 0, totalGastos: 204788.2, totalCaja: 0, diferencia: -204788.2, cerradaManual: true },
      { id: "r9", numero: 9, usuario: "JESUS CHIMINO", obra: "VARELA", responsable: "JESUS CHIMINO", mes: "Julio", quincena: "2da Quincena", saldoAnterior: 0, totalGastos: 222369, totalCaja: 100000, diferencia: -122369, cerradaManual: false },
      { id: "r10a", numero: 10, usuario: "Agustín Bobarin", obra: "VARELA", responsable: "Agustín Bobarin", mes: "Julio", quincena: "2da Quincena", saldoAnterior: 0, totalGastos: 291360.95, totalCaja: 0, diferencia: -291360.95, cerradaManual: true },
      { id: "r10b", numero: 10, usuario: "JESUS CHIMINO", obra: "VARELA", responsable: "JESUS CHIMINO", mes: "Agosto", quincena: "1ra Quincena", saldoAnterior: 0, totalGastos: 184132, totalCaja: 100000, diferencia: -84132, cerradaManual: false },
      { id: "r11", numero: 11, usuario: "JESUS CHIMINO", obra: "VARELA", responsable: "JESUS CHIMINO", mes: "Septiembre", quincena: "1ra Quincena", saldoAnterior: 0, totalGastos: 150100, totalCaja: 100000, diferencia: -50100, cerradaManual: false },
      { id: "r12", numero: 12, usuario: "JESUS CHIMINO", obra: "VARELA", responsable: "JESUS CHIMINO", mes: "Septiembre", quincena: "2da Quincena", saldoAnterior: 0, totalGastos: 239035.99, totalCaja: 100000, diferencia: -139035.99, cerradaManual: false },
      { id: "r13", numero: 13, usuario: "Agustín Bobarin", obra: "VARELA", responsable: "Agustín Bobarin", mes: "Agosto", quincena: "2da Quincena", saldoAnterior: 0, totalGastos: 868266.42, totalCaja: 0, diferencia: -868266.42, cerradaManual: false },
    ];
    await guardarRendicionesIndex();
    for (const r of rendicionesIndex) {
      rendicionesCache[r.id] = { ...r, gastos: [], fondo: [] };
      await guardarRendicionDetalle(rendicionesCache[r.id]);
    }
    ingresarComo({ username: "Jesús chimino", role: "admin", permisos: {} });
    irA("caja");
    cambiarVistaCaja("lista");
  });
  await page.waitForTimeout(200);

  const resultado = await page.evaluate(() => ({
    usuariosEnIndice: rendicionesIndex.map(r => ({ id: r.id, usuario: r.usuario })),
    textoListaMuestraTodas: [3, 8, 9, 10, 11, 12, 13].every(n => document.getElementById("lista-rendiciones").innerHTML.includes("N° " + String(n).padStart(4, "0"))),
    cantEnDom: document.querySelectorAll("#lista-rendiciones .rendicion-card").length,
  }));

  // ---- Es idempotente: tocarla de nuevo (otra visita a la lista) no duplica ni rompe nada ----
  const resultadoSegundaVez = await page.evaluate(async () => {
    const antes = rendicionesIndex.length;
    cambiarVistaCaja("nueva");
    cambiarVistaCaja("lista");
    await new Promise(r => setTimeout(r, 150));
    return { antes, despues: rendicionesIndex.length, siguenVacios: rendicionesIndex.every(r => r.usuario !== "JESUS CHIMINO" && r.usuario !== "Agustín Bobarin") };
  });

  // ---- Un Capataz (no admin) no dispara ninguna corrección ----
  const comoNoAdmin = await page.evaluate(async () => {
    rendicionesIndex = [{ id: "otra", numero: 20, usuario: "JESUS CHIMINO", obra: "VARELA", responsable: "JESUS CHIMINO", mes: "Octubre", quincena: "1ra Quincena", saldoAnterior: 0, totalGastos: 1000, totalCaja: 1000, diferencia: 0, cerradaManual: false }];
    await guardarRendicionesIndex();
    migracionUsuariosRendicionesIntentada = false;
    ingresarComo({ username: "capataz1", role: "capataz", permisos: { caja: true } });
    irA("caja");
    cambiarVistaCaja("lista");
    await new Promise(r => setTimeout(r, 150));
    return { siguioSinUsuario: rendicionesIndex.find(r => r.id === "otra").usuario === "JESUS CHIMINO" };
  });

  console.log("Resultado:", JSON.stringify({ resultado, resultadoSegundaVez, comoNoAdmin }, null, 2));

  const fallas = [];
  if (!resultado.usuariosEnIndice.every(r => r.usuario === "")) fallas.push(`BUG: alguna rendición no quedó con usuario vacío tras la corrección: ${JSON.stringify(resultado.usuariosEnIndice)}`);
  if (!resultado.textoListaMuestraTodas) fallas.push("BUG: no todas las rendiciones (N°3, 8, 9, 10x2, 11, 12, 13) aparecen en la lista del Administrador tras la corrección");
  if (resultado.cantEnDom !== 8) fallas.push(`BUG: deberían verse las 8 rendiciones en el DOM, se ven ${resultado.cantEnDom}`);

  if (resultadoSegundaVez.despues !== resultadoSegundaVez.antes) fallas.push("BUG: visitar la lista una segunda vez duplicó rendiciones -- la corrección debería ser idempotente");
  if (!resultadoSegundaVez.siguenVacios) fallas.push("BUG: visitar la lista una segunda vez revirtió o rompió la corrección ya aplicada");

  if (!comoNoAdmin.siguioSinUsuario) fallas.push("BUG DE SEGURIDAD: un Capataz (no admin) pudo disparar la corrección de usuarios de Caja Chica");

  if (errs.length) fallas.push(`error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE LA CORRECCIÓN DE USUARIOS VIEJOS EN CAJA CHICA OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
