// Reporte del usuario en producción: "no me toma el ingreso, pongo la clave y no pasa nada" --
// ni un mensaje de error, nada. Causa real: iniciarSesion() llamaba a hashPassword() (que usa
// crypto.subtle, la Web Crypto API del navegador) sin ningún try/catch alrededor. Si esa llamada
// fallaba por lo que sea -- el caso más común es entrar con un link http:// en vez de https://,
// donde el navegador bloquea crypto.subtle por seguridad -- la excepción quedaba sin atrapar: la
// pantalla se congelaba exactamente como estaba, sin ningún aviso, indistinguible de que el botón
// "Entrar" no hiciera nada. El arreglo envuelve todo en try/catch y chequea crypto.subtle antes de
// usarlo, así SIEMPRE se ve algún mensaje (uno específico para el caso http/https, uno genérico
// para cualquier otra falla inesperada) -- y el camino normal (bien/mal la contraseña) no cambia.
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
    const hashAdmin = await hashPassword("miClave123");
    usuarios = [{ username: "admin", role: "admin", password: hashAdmin }];
    return { hashAdmin };
  });

  // ---- 1) Camino normal: contraseña correcta sigue entrando (no se rompió el caso feliz) ----
  const r1 = await page.evaluate(() => {
    document.getElementById("login-user").value = "admin";
    document.getElementById("login-pass").value = "miClave123";
    document.getElementById("login-error2").textContent = "";
    return iniciarSesion().then(() => ({
      entroALaApp: document.getElementById("app-principal").style.display !== "none",
      errorVacio: document.getElementById("login-error2").textContent === "",
    }));
  });

  // ---- 2) Contraseña incorrecta: sigue mostrando el mismo mensaje de siempre ----
  const r2 = await page.evaluate(() => {
    document.getElementById("pantalla-login").style.display = "flex";
    document.getElementById("app-principal").style.display = "none";
    document.getElementById("login-user").value = "admin";
    document.getElementById("login-pass").value = "claveMal";
    document.getElementById("login-error2").textContent = "";
    return iniciarSesion().then(() => ({
      mensaje: document.getElementById("login-error2").textContent,
      siguioSinEntrar: document.getElementById("app-principal").style.display === "none",
    }));
  });

  // ---- 3) BUG REPRODUCIDO: hashPassword() falla por cualquier motivo inesperado -- antes esto
  // quedaba en silencio total, ahora tiene que aparecer ALGÚN mensaje ----
  const r3 = await page.evaluate(() => {
    const original = window.hashPassword;
    window.hashPassword = () => Promise.reject(new Error("digest falló (simulado)"));
    document.getElementById("login-user").value = "admin";
    document.getElementById("login-pass").value = "miClave123";
    document.getElementById("login-error2").textContent = "";
    return iniciarSesion().then(() => {
      const mensaje = document.getElementById("login-error2").textContent;
      window.hashPassword = original;
      return { mensaje, quedoVacio: mensaje === "" };
    });
  });

  // ---- 4) Caso específico (el más probable en el reporte real): el navegador bloqueó
  // crypto.subtle (típico de abrir la app por http:// en vez de https://) -- mensaje concreto,
  // no el genérico, para que quien reporte el problema ya sepa qué hacer ----
  const r4 = await page.evaluate(() => {
    const cryptoOriginal = window.crypto;
    Object.defineProperty(window, "crypto", { value: {}, configurable: true });
    document.getElementById("login-user").value = "admin";
    document.getElementById("login-pass").value = "miClave123";
    document.getElementById("login-error2").textContent = "";
    return iniciarSesion().then(() => {
      const mensaje = document.getElementById("login-error2").textContent;
      Object.defineProperty(window, "crypto", { value: cryptoOriginal, configurable: true });
      return { mensaje };
    });
  });

  const resultado = { setup: { hashNoVacio: !!setup.hashAdmin }, r1, r2, r3, r4 };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!r1.entroALaApp) fallas.push("BUG: con usuario y contraseña correctos, dejó de poder entrar a la app");
  if (!r1.errorVacio) fallas.push("BUG: con credenciales correctas quedó un mensaje de error visible");

  if (r2.mensaje !== "Usuario o contraseña incorrectos.") fallas.push(`BUG: con la contraseña mal, el mensaje debería seguir siendo "Usuario o contraseña incorrectos.", dio '${r2.mensaje}'`);
  if (!r2.siguioSinEntrar) fallas.push("BUG: con la contraseña mal, de todas formas entró a la app");

  if (r3.quedoVacio) fallas.push("BUG REPRODUCIDO: una falla inesperada en el login queda en silencio total (el reporte original: 'pongo la clave y no pasa nada')");
  if (!r3.mensaje) fallas.push("BUG: una falla inesperada debería mostrar algún mensaje, no quedó ninguno");

  if (!r4.mensaje) fallas.push("BUG: si el navegador bloquea crypto.subtle (típico de http:// en vez de https://) debería aparecer un mensaje específico, no quedó ninguno");
  else if (!/https/i.test(r4.mensaje)) fallas.push(`BUG: el mensaje para el caso de crypto.subtle bloqueado debería orientar a usar https://, dio '${r4.mensaje}'`);

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL LOGIN SIN FALLAS SILENCIOSAS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
