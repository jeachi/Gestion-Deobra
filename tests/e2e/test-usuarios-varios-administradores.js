// Pedido del usuario: "Dentro de los usuarios quiero poder crear varios administradores no solo
// el primer perfil". Antes, el selector de Rol en Configuración > Usuarios estaba fijo (disabled)
// en "Capataz" -- agregarUsuario() ni siquiera miraba ese campo, siempre creaba con role:"capataz".
// No había NINGUNA forma de crear un segundo Administrador desde la app (solo el primero, sembrado
// al arrancar). Ahora el selector deja elegir Administrador, con una confirmación extra (es una
// cuenta de acceso total) antes de crearlo.
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

  await page.evaluate(() => {
    usuarios = [{ username: "admin", role: "admin", permisos: {}, password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    irA("trabajadores");
    cambiarVistaConfig("usuarios");
    renderTablaUsuarios();
  });
  await page.waitForTimeout(100);

  // ---- 1) El selector de Rol ya no está fijo en Capataz -- tiene las 2 opciones ----
  const r1 = await page.evaluate(() => {
    const sel = document.getElementById("nu-rol");
    return {
      deshabilitado: sel.disabled,
      opciones: [...sel.options].map(o => o.value),
    };
  });

  // Un único listener persistente para toda la corrida: decide aceptar o rechazar según
  // "respuestaDialogoSiguiente" (seteada antes de cada acción), y registra todos los mensajes --
  // así evitamos el error de Playwright al registrar más de un handler para el mismo diálogo.
  const todosLosDialogos = [];
  let respuestaDialogoSiguiente = "accept";
  page.on("dialog", (d) => {
    todosLosDialogos.push(d.message());
    if (respuestaDialogoSiguiente === "dismiss") d.dismiss(); else d.accept();
  });

  // ---- 2) Agregar un Capataz normal NO pide confirmación extra ----
  const dialogosAntes = todosLosDialogos.length;
  await page.fill("#nu-user", "capataz2");
  await page.fill("#nu-pass", "clavecap123");
  await page.selectOption("#nu-rol", "capataz");
  await page.click('button[onclick="agregarUsuario()"]');
  await page.waitForTimeout(100);
  const dialogosCapataz = todosLosDialogos.slice(dialogosAntes);
  const r2 = await page.evaluate(() => ({
    capatazCreado: usuarios.some(u => u.username === "capataz2" && u.role === "capataz"),
    selectorVolvioACapataz: document.getElementById("nu-rol").value === "capataz",
  }));

  // ---- 3) Agregar un Administrador SÍ pide confirmación, y si se acepta, queda creado ----
  const dialogosAntesAdmin = todosLosDialogos.length;
  await page.fill("#nu-user", "admin2");
  await page.fill("#nu-pass", "claveadmin123");
  await page.selectOption("#nu-rol", "admin");
  await page.click('button[onclick="agregarUsuario()"]');
  await page.waitForTimeout(100);
  const dialogosAdmin = todosLosDialogos.slice(dialogosAntesAdmin);
  const r3 = await page.evaluate(() => ({
    totalAdmins: usuarios.filter(u => u.role === "admin").length,
    admin2Creado: usuarios.some(u => u.username === "admin2" && u.role === "admin"),
    adminOriginalSigueIntacto: usuarios.some(u => u.username === "admin" && u.role === "admin"),
  }));

  // ---- 4) Si se CANCELA la confirmación, NO se crea el Administrador ----
  respuestaDialogoSiguiente = "dismiss";
  await page.fill("#nu-user", "admin3");
  await page.fill("#nu-pass", "claveadmin456");
  await page.selectOption("#nu-rol", "admin");
  await page.click('button[onclick="agregarUsuario()"]');
  await page.waitForTimeout(100);
  respuestaDialogoSiguiente = "accept";
  const r4 = await page.evaluate(() => ({
    admin3NoFueCreado: !usuarios.some(u => u.username === "admin3"),
  }));

  // ---- 5) El segundo Administrador puede entrar y hacer cosas de admin (tabla muestra ✓ en todo) ----
  const r5 = await page.evaluate(() => {
    ingresarComo({ username: "admin2", role: "admin", permisos: {} });
    irA("trabajadores");
    cambiarVistaConfig("usuarios");
    renderTablaUsuarios();
    const fila = [...document.querySelectorAll("#tbody-usuarios tr")].find(tr => tr.textContent.includes("admin2"));
    return {
      badgeAdministrador: fila && fila.querySelector(".badge").textContent === "Administrador",
      todosLosModulosConCheck: fila && [...fila.querySelectorAll("td")].slice(2, -1).every(td => td.textContent.trim() === "✓"),
    };
  });

  // ---- 6) Sin ser Administrador, agregarUsuario sigue rechazando (no cambió ese chequeo) ----
  const comoNoAdmin = await page.evaluate(async () => {
    ingresarComo({ username: "capataz2", role: "capataz", permisos: {} });
    const antes = usuarios.length;
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/Administrador/.test(msg)) huboToast = true; original(msg); };
    await agregarUsuario();
    showToast = original;
    return { huboToast, noCreoNada: usuarios.length === antes };
  });

  const resultado = { r1, dialogosCapataz, r2, dialogosAdmin, r3, r4, r5, comoNoAdmin };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (r1.deshabilitado) fallas.push("BUG: el selector de Rol sigue deshabilitado -- no se puede elegir Administrador");
  if (!r1.opciones.includes("admin")) fallas.push("BUG: el selector de Rol no ofrece la opción Administrador");
  if (!r1.opciones.includes("capataz")) fallas.push("BUG: el selector de Rol perdió la opción Capataz");

  if (dialogosCapataz.length > 0) fallas.push("BUG: agregar un Capataz normal no debería mostrar ningún diálogo de confirmación");
  if (!r2.capatazCreado) fallas.push("BUG: no se creó el capataz normal");
  if (!r2.selectorVolvioACapataz) fallas.push("BUG: después de agregar un usuario, el selector de Rol debería volver a Capataz por defecto");

  if (dialogosAdmin.length !== 1) fallas.push(`BUG: crear un Administrador debería mostrar exactamente 1 diálogo de confirmación, mostró ${dialogosAdmin.length}`);
  if (dialogosAdmin[0] && !/Administrador/.test(dialogosAdmin[0])) fallas.push(`BUG: el diálogo de confirmación no menciona que va a ser Administrador: "${dialogosAdmin[0]}"`);
  if (r3.totalAdmins !== 2) fallas.push(`BUG REPRODUCIDO: debería poder haber 2 Administradores a la vez, hay ${r3.totalAdmins}`);
  if (!r3.admin2Creado) fallas.push("BUG: no se creó el segundo Administrador (admin2)");
  if (!r3.adminOriginalSigueIntacto) fallas.push("BUG: crear un segundo Administrador afectó al Administrador original");

  if (!r4.admin3NoFueCreado) fallas.push("BUG: cancelar la confirmación debería impedir que se cree el Administrador, pero igual se creó");

  if (!r5.badgeAdministrador) fallas.push("BUG: el segundo Administrador no aparece con el badge 'Administrador' en la tabla");
  if (!r5.todosLosModulosConCheck) fallas.push("BUG: el segundo Administrador no tiene acceso marcado a todos los módulos en la tabla");

  if (!comoNoAdmin.huboToast) fallas.push("BUG: un Capataz (no admin) puede agregar usuarios sin aviso");
  if (!comoNoAdmin.noCreoNada) fallas.push("BUG DE SEGURIDAD: un Capataz (no admin) pudo agregar un usuario (posiblemente otro Administrador)");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE VARIOS ADMINISTRADORES OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
