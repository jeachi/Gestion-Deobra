// Reporte real del usuario: entra casi siempre con huella/Face ID, nunca vuelve a tipear la
// clave -- el día que la necesitó (celular nuevo, no configuró huella todavía, etc.) la que tenía
// guardada ya no entraba, y no existía NINGÚN botón en la app para cambiarla. Sin una clave vieja
// que ya no se sabe, y sin ningún Administrador con acceso, quedaba sin salida -- había que borrar
// el usuario entero (perdiendo todo su historial) y crearlo de nuevo.
// Se agrega "🔑 Clave" en la tabla de usuarios (Configuración): cualquier Administrador le puede
// poner una clave NUEVA a cualquier usuario (incluido a sí mismo) sin necesitar la vieja.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  const setup = await page.evaluate(async () => {
    const hashVieja = await hashPassword("claveVieja123");
    usuarios = [
      { username: "admin", role: "admin", password: hashVieja },
      { username: "capataz1", role: "capataz", permisos: {}, password: await hashPassword("otraClave1") },
    ];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    irA("trabajadores");
    cambiarVistaConfig("usuarios");
    renderTablaUsuarios();
    return { hashVieja };
  });

  // ---- 1) El botón "🔑 Clave" aparece para cada usuario de la tabla ----
  const r1 = await page.evaluate(() => {
    const html = document.getElementById("tbody-usuarios").innerHTML;
    return {
      hayBotonParaAdmin: html.includes("abrirCambiarClaveUsuario('admin')"),
      hayBotonParaCapataz: html.includes("abrirCambiarClaveUsuario('capataz1')"),
    };
  });

  // ---- 2) Cambiarle la clave a OTRO usuario (capataz1) sin saber la vieja -- la nueva entra, la
  // vieja deja de servir ----
  await page.click("button[onclick=\"abrirCambiarClaveUsuario('capataz1')\"]");
  await page.waitForTimeout(80);
  await page.fill("#cc-pass1", "claveNueva456");
  await page.fill("#cc-pass2", "claveNueva456");
  await page.click('#prompt-generico-overlay button:has-text("Guardar clave nueva")');
  await page.waitForTimeout(80);

  const r2 = await page.evaluate(async () => {
    const modalCerrado = document.getElementById("prompt-generico-overlay").style.display === "none" || !document.getElementById("prompt-generico-overlay").innerHTML.includes("cc-pass1");
    const u = usuarios.find(x => x.username === "capataz1");
    const hashNueva = await hashPassword("claveNueva456");
    const hashViejaCapataz = await hashPassword("otraClave1");
    return {
      modalCerrado,
      claveNuevaQuedoGuardada: u.password === hashNueva,
      claveViejaYaNoSirve: u.password !== hashViejaCapataz,
    };
  });

  // ---- 3) Con la clave nueva, el login (iniciarSesion) ahora SÍ entra -- y la vieja ya no ----
  const r3 = await page.evaluate(() => {
    document.getElementById("pantalla-login").style.display = "flex";
    document.getElementById("app-principal").style.display = "none";
    document.getElementById("login-user").value = "capataz1";
    document.getElementById("login-pass").value = "claveNueva456";
    document.getElementById("login-error2").textContent = "";
    return iniciarSesion().then(() => ({
      entroConClaveNueva: document.getElementById("app-principal").style.display !== "none",
    }));
  });
  const r4 = await page.evaluate(() => {
    document.getElementById("pantalla-login").style.display = "flex";
    document.getElementById("app-principal").style.display = "none";
    document.getElementById("login-user").value = "capataz1";
    document.getElementById("login-pass").value = "otraClave1"; // la vieja
    document.getElementById("login-error2").textContent = "";
    return iniciarSesion().then(() => ({
      mensaje: document.getElementById("login-error2").textContent,
      siguioSinEntrar: document.getElementById("app-principal").style.display === "none",
    }));
  });

  // ---- 5) Validaciones: clave corta, o que no coincide con la repetición ----
  await page.evaluate(() => {
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    irA("trabajadores");
    cambiarVistaConfig("usuarios");
    renderTablaUsuarios();
  });
  await page.click("button[onclick=\"abrirCambiarClaveUsuario('capataz1')\"]");
  await page.waitForTimeout(80);
  await page.fill("#cc-pass1", "corta");
  await page.fill("#cc-pass2", "corta");
  await page.click('#prompt-generico-overlay button:has-text("Guardar clave nueva")');
  const r5_corta = await page.evaluate(() => document.getElementById("cc-error").textContent);
  await page.fill("#cc-pass1", "claveLarga789");
  await page.fill("#cc-pass2", "distinta000");
  await page.click('#prompt-generico-overlay button:has-text("Guardar clave nueva")');
  const r5_nocoincide = await page.evaluate(() => document.getElementById("cc-error").textContent);

  // ---- 6) Sin ser Administrador, la función rechaza (mismo criterio que el resto de Usuarios) ----
  const comoNoAdmin = await page.evaluate(() => {
    cerrarPromptGenerico(); // el modal de la validación fallida anterior puede haber quedado abierto a propósito
    ingresarComo({ username: "capataz1", role: "capataz", permisos: {} });
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/Administrador/.test(msg)) huboToast = true; original(msg); };
    abrirCambiarClaveUsuario("admin");
    const overlay = document.getElementById("prompt-generico-overlay");
    const modalSigueCerrado = !overlay || overlay.style.display === "none";
    showToast = original;
    return { huboToast, modalSigueCerrado };
  });

  const resultado = { r1, r2, r3, r4, r5_corta, r5_nocoincide, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1.hayBotonParaAdmin) fallas.push("BUG: no hay botón '🔑 Clave' para el usuario admin en la tabla");
  if (!r1.hayBotonParaCapataz) fallas.push("BUG: no hay botón '🔑 Clave' para el capataz en la tabla");

  if (!r2.modalCerrado) fallas.push("BUG: el modal de cambiar clave no se cerró después de guardar");
  if (!r2.claveNuevaQuedoGuardada) fallas.push("BUG: la clave nueva no quedó guardada en el usuario");
  if (!r2.claveViejaYaNoSirve) fallas.push("BUG: la clave vieja seguiría sirviendo después del cambio");

  if (!r3.entroConClaveNueva) fallas.push("BUG REPRODUCIDO: con la clave nueva puesta por el admin, el usuario no puede entrar");
  if (r4.mensaje !== "Usuario o contraseña incorrectos.") fallas.push(`BUG: con la clave VIEJA (ya reemplazada) debería rechazar como contraseña incorrecta, dio '${r4.mensaje}'`);
  if (!r4.siguioSinEntrar) fallas.push("BUG: la clave vieja (ya reemplazada) todavía deja entrar");

  if (r5_corta !== "La clave tiene que tener al menos 6 caracteres.") fallas.push(`BUG: una clave de menos de 6 caracteres debería rechazarse con ese mensaje, dio '${r5_corta}'`);
  if (r5_nocoincide !== "Las claves no coinciden.") fallas.push(`BUG: si la clave y su repetición no coinciden debería avisar eso, dio '${r5_nocoincide}'`);

  if (!comoNoAdmin.huboToast) fallas.push("BUG: un Capataz (no admin) puede abrir el cambio de clave de otro usuario sin aviso");
  if (!comoNoAdmin.modalSigueCerrado) fallas.push("BUG: un Capataz (no admin) igual pudo abrir el modal de cambiar clave");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE CAMBIAR CLAVE DE USUARIO (SIN LA VIEJA) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
