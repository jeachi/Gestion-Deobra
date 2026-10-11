// Ronda 7 de auditoría: cadena de bugs encontrada en la gestión de usuarios/login/respaldo de
// Configuración.
//
// BUG -- cargarUsuarios() vaciaba "usuarios" a [] ante CUALQUIER error de lectura, no solo cuando
// genuinamente no existe el documento todavía. Si el valor guardado en Firestore quedaba dañado
// (por ejemplo por una restauración de respaldo cortada a la mitad), la próxima carga lo tomaba
// como "recién instalado" y mostrarPantallaLogin() mostraba el formulario de "crear cuenta admin"
// a CUALQUIERA que abriera la app en ese momento -- creando esa cuenta se PISABA en el servidor el
// documento real de usuarios con uno de un solo usuario nuevo, perdiendo las cuentas existentes.
//
// BUG -- importarRespaldo() no validaba el contenido de la clave "usuarios" antes de escribirla, ni
// revisaba si alguna escritura quedó solo en la cola offline (mostraba "Restaurado ✓" igual).
//
// BUG -- ni crearCuentaAdmin() ni agregarUsuario() exigían un mínimo de longitud de contraseña.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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
    const alertas = [];
    window.alert = (m) => alertas.push(String(m));
    window.confirm = () => true;

    // ---- 1) cargarUsuarios() con un valor CORRUPTO (no parseable) no debería vaciar "usuarios" ----
    const usuariosRealesDeAntes = [{username:"admin", password:"x".repeat(64), role:"admin"}];
    usuarios = [...usuariosRealesDeAntes];
    window.storage.get = async (key) => {
      if (key === "usuarios") return { key, value: "{esto no es JSON válido" };
      throw new Error("Clave no encontrada: " + key);
    };
    await cargarUsuarios();
    const r1_noVacioUsuariosConValorCorrupto = usuarios.length === 1 && usuarios[0].username === "admin";
    const r1_marcoError = errorCargaUsuarios === true;

    // ---- 2) mostrarPantallaLogin() con el error marcado debería bloquear el login, NO ofrecer "crear admin" ----
    mostrarPantallaLogin();
    const r2_muestraBloqueDeError = document.getElementById("login-error-carga").style.display === "block";
    const r2_noMuestraCrearAdmin = document.getElementById("login-crear-admin").style.display !== "block";
    const r2_noMuestraLoginNormal = document.getElementById("login-normal").style.display !== "block";

    // ---- 3) crearCuentaAdmin() debería negarse si ya hay usuarios reales en memoria ----
    document.getElementById("admin-user").value = "intruso";
    document.getElementById("admin-pass").value = "123456";
    document.getElementById("admin-pass2").value = "123456";
    const usuariosAntesDeIntento = usuarios.length;
    await crearCuentaAdmin();
    const r3_noCreoAdminEncimaDeUsuariosReales = usuarios.length === usuariosAntesDeIntento;

    // ---- 4) Ahora sí, primera vez de verdad (sin usuarios, sin error) -- contraseña corta se rechaza ----
    usuarios = [];
    errorCargaUsuarios = false;
    document.getElementById("admin-pass").value = "123";
    document.getElementById("admin-pass2").value = "123";
    await crearCuentaAdmin();
    const r4_rechazoPasswordCorta = usuarios.length === 0;
    document.getElementById("admin-pass").value = "123456";
    document.getElementById("admin-pass2").value = "123456";
    await crearCuentaAdmin();
    const r4_aceptoPasswordDeSeisOMas = usuarios.length === 1 && usuarios[0].username === "intruso";

    // ---- 5) agregarUsuario() también exige mínimo de contraseña ----
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    document.getElementById("nu-user").value = "capataz2";
    document.getElementById("nu-pass").value = "ab";
    await agregarUsuario();
    const r5_rechazoPasswordCortaCapataz = !usuarios.some(u=>u.username==="capataz2");

    // ---- 6) importarRespaldo(): clave "usuarios" con JSON inválido -> no debería escribir NADA ----
    let huboEscrituras = false;
    window.storage.set = async (k,v) => { huboEscrituras = true; return {key:k, value:v, pendiente:false}; };
    const paqueteConUsuariosCorruptos = { datos: { usuarios: "{esto tampoco es JSON valido", obras: JSON.stringify(["VARELA"]) } };
    const inputFalso1 = { files: [new File([JSON.stringify(paqueteConUsuariosCorruptos)], "r.json", {type:"application/json"})], value:"" };
    alertas.length = 0;
    await importarRespaldo(inputFalso1);
    await new Promise(r=>setTimeout(r, 300)); // FileReader es asíncrono
    const r6_noEscribioNadaConUsuariosCorruptos = !huboEscrituras;
    const r6_avisoDelProblema = alertas.some(a=>/usuarios/i.test(a));

    // ---- 7) importarRespaldo(): clave "usuarios" como array VACÍO -> tampoco debería aceptarse ----
    huboEscrituras = false;
    const paqueteConUsuariosVacio = { datos: { usuarios: "[]", obras: JSON.stringify(["VARELA"]) } };
    const inputFalso2 = { files: [new File([JSON.stringify(paqueteConUsuariosVacio)], "r.json", {type:"application/json"})], value:"" };
    alertas.length = 0;
    await importarRespaldo(inputFalso2);
    await new Promise(r=>setTimeout(r, 300));
    const r7_noEscribioNadaConUsuariosVacio = !huboEscrituras;

    // ---- 8) importarRespaldo(): respaldo válido, pero el guardado queda "pendiente" (sin conexión)
    // -- no debería decir "Restaurado ✓" ni programar el reload ----
    let huboRecarga = false;
    window.recargarTrasRestaurarRespaldo = () => { huboRecarga = true; };
    window.storage.set = async (k,v) => ({key:k, value:v, pendiente:true}); // simula "sin señal"
    const paqueteValidoPeroSinSenal = { datos: { usuarios: JSON.stringify(usuariosRealesDeAntes), obras: JSON.stringify(["VARELA"]) } };
    const inputFalso3 = { files: [new File([JSON.stringify(paqueteValidoPeroSinSenal)], "r.json", {type:"application/json"})], value:"" };
    alertas.length = 0;
    await importarRespaldo(inputFalso3);
    await new Promise(r=>setTimeout(r, 1500)); // el setTimeout(recargarTrasRestaurarRespaldo,1200) real, si se llegara a programar, ya dispararía en esta ventana
    const r8_noAvisoExitoFalso = !alertas.some(a=>/restaurado ✓/i.test(a)) && !/Restaurado ✓/.test(document.getElementById("respaldo-info").textContent||"");
    const r8_noRecargoLaPagina = !huboRecarga;
    const r8_avisoProblemaDeConexion = alertas.some(a=>/conexi[oó]n/i.test(a));

    return {
      r1_noVacioUsuariosConValorCorrupto, r1_marcoError,
      r2_muestraBloqueDeError, r2_noMuestraCrearAdmin, r2_noMuestraLoginNormal,
      r3_noCreoAdminEncimaDeUsuariosReales,
      r4_rechazoPasswordCorta, r4_aceptoPasswordDeSeisOMas,
      r5_rechazoPasswordCortaCapataz,
      r6_noEscribioNadaConUsuariosCorruptos, r6_avisoDelProblema,
      r7_noEscribioNadaConUsuariosVacio,
      r8_noAvisoExitoFalso, r8_noRecargoLaPagina, r8_avisoProblemaDeConexion,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_noVacioUsuariosConValorCorrupto) fallas.push("BUG REPRODUCIDO: un valor de 'usuarios' corrupto vació la lista de usuarios reales en memoria");
  if (!resultado.r1_marcoError) fallas.push("Debería marcar errorCargaUsuarios al no poder leer/parsear 'usuarios'");
  if (!resultado.r2_muestraBloqueDeError) fallas.push("Con error de carga, debería mostrarse el bloque de error bloqueante");
  if (!resultado.r2_noMuestraCrearAdmin) fallas.push("BUG REPRODUCIDO: con error de carga, se mostró igual el formulario de 'crear cuenta admin'");
  if (!resultado.r2_noMuestraLoginNormal) fallas.push("Con error de carga, no debería mostrarse tampoco el login normal");
  if (!resultado.r3_noCreoAdminEncimaDeUsuariosReales) fallas.push("BUG REPRODUCIDO: crearCuentaAdmin() pisó usuarios reales ya existentes");
  if (!resultado.r4_rechazoPasswordCorta) fallas.push("BUG REPRODUCIDO: crearCuentaAdmin() aceptó una contraseña de 3 caracteres");
  if (!resultado.r4_aceptoPasswordDeSeisOMas) fallas.push("crearCuentaAdmin() debería aceptar una contraseña de 6+ caracteres en el primer uso legítimo");
  if (!resultado.r5_rechazoPasswordCortaCapataz) fallas.push("BUG REPRODUCIDO: agregarUsuario() aceptó una contraseña de 2 caracteres para un capataz");
  if (!resultado.r6_noEscribioNadaConUsuariosCorruptos) fallas.push("BUG REPRODUCIDO: importarRespaldo() escribió datos en el servidor con 'usuarios' corrupto en el archivo");
  if (!resultado.r6_avisoDelProblema) fallas.push("Debería avisar específicamente que el problema es con 'usuarios'");
  if (!resultado.r7_noEscribioNadaConUsuariosVacio) fallas.push("BUG REPRODUCIDO: importarRespaldo() escribió datos con 'usuarios' como array vacío en el archivo");
  if (!resultado.r8_noAvisoExitoFalso) fallas.push("BUG REPRODUCIDO: importarRespaldo() avisó 'Restaurado ✓' aunque el guardado real quedó pendiente (sin conexión)");
  if (!resultado.r8_noRecargoLaPagina) fallas.push("BUG REPRODUCIDO: importarRespaldo() programó la recarga de la página aunque el guardado quedó pendiente");
  if (!resultado.r8_avisoProblemaDeConexion) fallas.push("Debería avisar que la restauración quedó incompleta por falta de conexión");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE USUARIOS CORRUPTOS Y RESPALDO OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
