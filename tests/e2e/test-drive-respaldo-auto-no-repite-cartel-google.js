// Bug reportado por el usuario: después de iniciar sesión, SIEMPRE le aparece la pantalla de
// "Selecciona una cuenta" de Google (algo que antes no pasaba) -- y de paso, el plano se siente
// lento/tarda justo al abrirse recién logueado.
//
// Causa real: el respaldo automático a Google Drive (verificarRespaldoSemanal, se dispara solo al
// loguearse el Administrador si pasaron 7+ días desde el último respaldo) pide un token en modo
// SILENCIOSO (prompt:""), pensado para no mostrar nunca ninguna pantalla de Google sin que la
// persona la haya pedido. Pero si esa renovación silenciosa falla (típicamente porque Google ya no
// puede renovarla sin interacción -- algo que viene pasando más seguido en celulares por los
// cambios de Chrome/Google en cookies de terceros), antes el código SOLO logueaba un warning y
// seguía -- nunca guardaba "ultimo_respaldo_drive" porque el respaldo nunca se completaba. Eso
// significa que en el SIGUIENTE login volvía a intentar lo mismo, fallaba de la misma manera, y
// así para siempre: el cartel de Google aparece en TODOS los logueos, no solo cada 7 días, y esa
// llamada de red/popup compitiendo justo al abrir la app explica también el "tarda" al entrar al
// plano enseguida de loguearse.
//
// Arreglo: cuando la renovación SILENCIOSA del token falla, se apaga el auto-respaldo (se guarda
// drive_autorizado=false) en vez de reintentar en cada apertura -- la próxima vez que el
// Administrador entre va a ver "Todavía no autorizaste el acceso" con un botón para reconectar a
// mano (ESE sí puede mostrar el cartel de Google, porque ahí la persona lo pidió a propósito).
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

    // Simula el SDK de Google Identity Services: initTokenClient() guarda el callback, y
    // requestAccessToken() lo llama enseguida como SI la renovación silenciosa hubiera fallado
    // (resp.error presente) -- exactamente el caso que antes dejaba todo en un loop sin fin.
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient(cfg) {
            const cliente = { callback: cfg.callback };
            cliente.requestAccessToken = function (opts) {
              setTimeout(() => cliente.callback({ error: "interaction_required" }), 0);
            };
            return cliente;
          },
        },
      },
    };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  const resultado = await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    // Simula que ya estaba autorizado (como alguien que lo conectó hace tiempo) y que pasó más de
    // una semana desde el último respaldo -- así verificarRespaldoSemanal(false) decide intentar.
    await window.storage.set("drive_autorizado", "true", true);
    await window.storage.set("ultimo_respaldo_drive", new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), true);

    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    // ingresarComo ya dispara inicializarGoogleDrive()+verificarRespaldoSemanal(false) solo -- se
    // espera a que termine ese intento fallido.
    await new Promise(r => setTimeout(r, 200));

    const autorizadoTrasFallo = (await window.storage.get("drive_autorizado", true)).value;

    // Simula un SEGUNDO login (p.ej. recargar la página) -- si el fix funciona, ya no debería
    // intentar de nuevo (porque autorizado quedó en "false"), así que no debería volver a tocar
    // requestAccessToken.
    let segundoIntento = false;
    const clienteOriginal = tokenClientDrive;
    tokenClientDrive = {
      requestAccessToken() {
        segundoIntento = true;
        // Igual que el mock de arriba: siempre responde (aunque no debería ni llegar a pedirse,
        // si el fix anda bien) -- así la promesa de pedirTokenDrive no se queda colgada para
        // siempre esperando un callback que nunca llega.
        setTimeout(() => this.callback({ error: "interaction_required" }), 0);
      },
      callback: null,
    };
    await verificarRespaldoSemanal(false);
    tokenClientDrive = clienteOriginal;

    return { autorizadoTrasFallo, segundoIntento };
  });

  if (resultado.autorizadoTrasFallo !== "false") {
    throw new Error("BUG: tras fallar la renovación silenciosa del token, drive_autorizado debería quedar en 'false' (para no reintentar en cada login): " + resultado.autorizadoTrasFallo);
  }
  if (resultado.segundoIntento) {
    throw new Error("BUG: con drive_autorizado en 'false', verificarRespaldoSemanal no debería volver a pedir token -- debería esperar a que el Administrador reconecte a mano.");
  }

  if (errs.length) throw new Error("Errores de página: " + errs.join(" | "));
  await browser.close();
  console.log("OK: test-drive-respaldo-auto-no-repite-cartel-google");
})().catch((e) => { console.error(e); process.exit(1); });
