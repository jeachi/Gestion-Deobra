// Pedido del usuario: poder activar/desactivar las tarjetas de "Módulos" del Dashboard desde
// Configuración > Personalización, una preferencia por usuario (mismo patrón que tema de color y
// ubicación de la barra). Por defecto todo sigue visible -- esto es puramente estético, nunca
// toca permisos: una tarjeta oculta solo deja de aparecer en el Dashboard, el módulo sigue entero
// disponible desde el menú y el gate de permisos de irA() sigue siendo el único control de acceso real.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  // Mock de Firestore CON memoria real (a diferencia de otros tests de este repo que siempre
  // devuelven exists:false) -- hace falta para probar que lo que se guarda con window.storage.set
  // se puede volver a leer con window.storage.get dentro de la misma sesión de página, igual que
  // pasaría entre un guardado y el próximo ingreso real a la app.
  await page.addInitScript(() => {
    const mem = {};
    window.firebase = {
      initializeApp(){},
      firestore(){
        return {
          collection(name){
            return {
              doc(id){
                const k = name + "/" + id;
                return {
                  get: async () => ({ exists: mem[k] !== undefined, data: () => mem[k] }),
                  set: async (val) => { mem[k] = val; },
                  delete: async () => { delete mem[k]; },
                };
              },
              get: async () => ({ docs: [] }),
            };
          },
        };
      },
      auth(){ return { signInAnonymously: () => Promise.resolve() }; },
    };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    irA("dashboard");
  });

  // ---- Estado inicial: nadie tocó el ajuste todavía -- las 12 tarjetas visibles y tildadas ----
  const inicial = await page.evaluate(async () => {
    await cargarDashModulosUsuario();
    const tarjetas = [...document.querySelectorAll("#view-dashboard .dash-grid.bento .dash-card[data-modulo]")];
    const checks = [...document.querySelectorAll("#dash-modulos-toggle-list input[type=checkbox]")];
    return {
      totalTarjetas: tarjetas.length,
      todasVisibles: tarjetas.every((el) => el.style.display !== "none"),
      totalChecks: checks.length,
      todosTildados: checks.every((c) => c.checked),
    };
  });

  // ---- Destildar "Presupuesto General" -- se oculta y queda guardado por usuario ----
  const trasOcultar = await page.evaluate(async () => {
    await toggleDashModulo("presupuesto", false);
    const tarjeta = document.querySelector('#view-dashboard .dash-grid.bento .dash-card[data-modulo="presupuesto"]');
    const guardado = await window.storage.get("dash_modulos_ocultos_admin", true);
    return {
      presupuestoOculto: tarjeta.style.display === "none",
      otraSigueVisible: document.querySelector('#view-dashboard .dash-grid.bento .dash-card[data-modulo="certificados"]').style.display !== "none",
      guardadoTienePresupuesto: JSON.parse(guardado.value).presupuesto === true,
    };
  });

  // ---- Simula volver a entrar (releer la preferencia guardada, como pasaría en un login real) ----
  const trasRecargar = await page.evaluate(async () => {
    await cargarDashModulosUsuario();
    const tarjeta = document.querySelector('#view-dashboard .dash-grid.bento .dash-card[data-modulo="presupuesto"]');
    const checkPresupuesto = document.querySelector('#dash-modulos-toggle-list input[type=checkbox]');
    const checks = [...document.querySelectorAll("#dash-modulos-toggle-list input[type=checkbox]")];
    return {
      siguoOculto: tarjeta.style.display === "none",
      totalChecksSigueSiendo12: checks.length,
      algunoDestildado: checks.some((c) => !c.checked),
    };
  });

  // ---- Volver a tildarla -- se muestra de nuevo y se borra del guardado (no queda "false" ahí) ----
  const trasMostrar = await page.evaluate(async () => {
    await toggleDashModulo("presupuesto", true);
    const tarjeta = document.querySelector('#view-dashboard .dash-grid.bento .dash-card[data-modulo="presupuesto"]');
    const guardado = await window.storage.get("dash_modulos_ocultos_admin", true);
    return {
      presupuestoVisibleDeNuevo: tarjeta.style.display !== "none",
      guardadoYaNoTienePresupuesto: !("presupuesto" in JSON.parse(guardado.value)),
    };
  });

  // ---- El toggle es PURAMENTE visual: nunca toca el gate real de permisos de irA() ----
  const permisosSinTocar = await page.evaluate(async () => {
    await toggleDashModulo("presupuesto", false); // lo oculta en el Dashboard del admin
    ingresarComo({ username: "capataz1", role: "capataz", permisos: { asistencia: true } });
    irA("dashboard");
    let huboToast = false;
    const original = showToast;
    showToast = (msg) => { if (/permiso/i.test(msg)) huboToast = true; original(msg); };
    await irA("presupuesto"); // capataz sin permiso -- debe seguir bloqueado, esté oculto o no en el Dashboard de otro usuario
    const seQuedoEnDashboard = document.getElementById("view-dashboard").classList.contains("active");
    showToast = original;
    return { huboToast, seQuedoEnDashboard };
  });

  const resultado = { inicial, trasOcultar, trasRecargar, trasMostrar, permisosSinTocar };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (inicial.totalTarjetas !== 12) fallas.push(`BUG: deberían existir 12 tarjetas de módulo en el Dashboard, hay ${inicial.totalTarjetas}`);
  if (!inicial.todasVisibles) fallas.push("BUG: sin ninguna preferencia guardada, alguna tarjeta ya aparece oculta -- debería ser 'todo visible' por defecto");
  if (inicial.totalChecks !== 12) fallas.push(`BUG: la lista de Personalización debería tener 12 checkboxes (uno por tarjeta), tiene ${inicial.totalChecks}`);
  if (!inicial.todosTildados) fallas.push("BUG: por defecto todos los checkboxes deberían estar tildados");

  if (!trasOcultar.presupuestoOculto) fallas.push("BUG: destildar 'Presupuesto General' no ocultó su tarjeta en el Dashboard");
  if (!trasOcultar.otraSigueVisible) fallas.push("BUG: ocultar una tarjeta ocultó de rebote otra que no se tocó");
  if (!trasOcultar.guardadoTienePresupuesto) fallas.push("BUG: la preferencia no quedó guardada en window.storage para este usuario");

  if (!trasRecargar.siguoOculto) fallas.push("BUG: al volver a leer la preferencia guardada (como en un login real), la tarjeta oculta volvió a aparecer");
  if (trasRecargar.totalChecksSigueSiendo12 !== 12) fallas.push("BUG: tras recargar la preferencia, la lista de checkboxes dejó de tener las 12 tarjetas");
  if (!trasRecargar.algunoDestildado) fallas.push("BUG: tras recargar, ningún checkbox quedó destildado -- no refleja la preferencia guardada");

  if (!trasMostrar.presupuestoVisibleDeNuevo) fallas.push("BUG: volver a tildar 'Presupuesto General' no la mostró de nuevo en el Dashboard");
  if (!trasMostrar.guardadoYaNoTienePresupuesto) fallas.push("BUG: al volver a mostrarla, su clave quedó pisada en 'false' en vez de borrarse del guardado");

  if (!permisosSinTocar.huboToast) fallas.push("BUG DE SEGURIDAD: ocultar/mostrar tarjetas del Dashboard terminó afectando el control de permisos real de irA()");
  if (!permisosSinTocar.seQuedoEnDashboard) fallas.push("BUG DE SEGURIDAD: un Capataz sin permiso entró igual a Presupuesto General");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE MÓDULOS PERSONALIZABLES DEL DASHBOARD OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
