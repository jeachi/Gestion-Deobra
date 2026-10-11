// Ronda 6 de auditoría -- Sesión/permisos: 2 arreglos (escalación de privilegios).
// 1) agregarUsuario/quitarUsuario/togglePermisoUsuario no chequeaban sesionActual.role==="admin" --
//    un Capataz podía llamarlas directo desde la consola del navegador y crear/borrar cuentas o
//    habilitarse módulos a sí mismo, aunque la UI (botones ocultos) se lo impidiera visualmente.
// 2) ejecutarBusquedaGlobal() buscaba y mostraba resultados de TODOS los módulos sin importar los
//    permisos del usuario -- un Capataz sin acceso a Presupuesto/Remitos/etc. podía igual enterarse
//    de nombres de ítems, montos y obras con solo escribir en el buscador global.
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
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];

    // ---- 1) agregarUsuario/quitarUsuario/togglePermisoUsuario exigen admin ----
    usuarios = [
      { username: "admin", password: "x", role: "admin", permisos: { ...PERMISOS_ADMIN } },
      { username: "capataz1", password: "x", role: "capataz", permisos: { ...PERMISOS_CAPATAZ_DEFAULT } },
    ];
    sesionActual = { username: "capataz1", role: "capataz", permisos: { ...PERMISOS_CAPATAZ_DEFAULT } };

    document.getElementById("nu-user").value = "intruso";
    document.getElementById("nu-pass").value = "1234";
    await agregarUsuario();
    const r1_noCreaSiNoEsAdmin = usuarios.length === 2 && !usuarios.some(u => u.username === "intruso");

    await quitarUsuario("admin");
    const r1_noBorraSiNoEsAdmin = usuarios.some(u => u.username === "admin");

    await togglePermisoUsuario("capataz1", "presupuesto", true);
    const r1_noHabilitaPermisoSiNoEsAdmin = usuarios.find(u => u.username === "capataz1").permisos.presupuesto === false;

    // Como admin, las tres siguen funcionando normalmente.
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    await togglePermisoUsuario("capataz1", "presupuesto", true);
    const r1_siFuncionaParaAdmin = usuarios.find(u => u.username === "capataz1").permisos.presupuesto === true;

    // ---- 2) ejecutarBusquedaGlobal respeta los permisos del usuario ----
    presupuestoItems = [{ id: "i1", nombre: "Cemento Portland", rubro: "1", rubroNombre: "Materiales", precioConCoef: 50000, historialMeses: [] }];
    remitosIndex = [{ id: "rm1", numero: 77, obra: "ObraTest", fecha: "2026-01-01" }];
    trabajadores = [{ id: "t1", nombre: "Juan Pérez", categoria: "Oficial", obra: "ObraTest", estado: "Activo" }];

    sesionActual = { username: "capataz1", role: "capataz", permisos: { ...PERMISOS_CAPATAZ_DEFAULT } }; // todos los módulos en false salvo asistencia
    document.getElementById("buscador-global-input").value = "cemento";
    ejecutarBusquedaGlobal();
    const htmlSinPermiso = document.getElementById("buscador-global-resultados").innerHTML;
    const r2_noMuestraPresupuestoSinPermiso = !htmlSinPermiso.includes("Cemento Portland");

    document.getElementById("buscador-global-input").value = "77";
    ejecutarBusquedaGlobal();
    const htmlRemitosSinPermiso = document.getElementById("buscador-global-resultados").innerHTML;
    const r2_noMuestraRemitosSinPermiso = !htmlRemitosSinPermiso.includes("Remito N° 77");

    document.getElementById("buscador-global-input").value = "juan";
    ejecutarBusquedaGlobal();
    const htmlTrabSinPermiso = document.getElementById("buscador-global-resultados").innerHTML;
    const r2_noMuestraTrabajadoresSiNoEsAdmin = !htmlTrabSinPermiso.includes("Juan Pérez");

    // Dándole permiso de Presupuesto, sí debería aparecer.
    sesionActual.permisos.presupuesto = true;
    document.getElementById("buscador-global-input").value = "cemento";
    ejecutarBusquedaGlobal();
    const htmlConPermiso = document.getElementById("buscador-global-resultados").innerHTML;
    const r2_siMuestraConPermiso = htmlConPermiso.includes("Cemento Portland");

    // Como admin, todo sigue visible.
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    document.getElementById("buscador-global-input").value = "cemento";
    ejecutarBusquedaGlobal();
    const htmlAdmin = document.getElementById("buscador-global-resultados").innerHTML;
    const r2_siMuestraParaAdmin = htmlAdmin.includes("Cemento Portland");

    return {
      r1_noCreaSiNoEsAdmin, r1_noBorraSiNoEsAdmin, r1_noHabilitaPermisoSiNoEsAdmin, r1_siFuncionaParaAdmin,
      r2_noMuestraPresupuestoSinPermiso, r2_noMuestraRemitosSinPermiso, r2_noMuestraTrabajadoresSiNoEsAdmin,
      r2_siMuestraConPermiso, r2_siMuestraParaAdmin,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_noCreaSiNoEsAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder crear usuarios llamando agregarUsuario() directo");
  if (!resultado.r1_noBorraSiNoEsAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder borrar usuarios llamando quitarUsuario() directo");
  if (!resultado.r1_noHabilitaPermisoSiNoEsAdmin) fallas.push("BUG REPRODUCIDO: un Capataz no debería poder habilitarse módulos llamando togglePermisoUsuario() directo");
  if (!resultado.r1_siFuncionaParaAdmin) fallas.push("togglePermisoUsuario debería seguir funcionando para un admin");
  if (!resultado.r2_noMuestraPresupuestoSinPermiso) fallas.push("BUG REPRODUCIDO: el buscador global no debería mostrar ítems de Presupuesto a quien no tiene ese permiso");
  if (!resultado.r2_noMuestraRemitosSinPermiso) fallas.push("BUG REPRODUCIDO: el buscador global no debería mostrar Remitos a quien no tiene ese permiso");
  if (!resultado.r2_noMuestraTrabajadoresSiNoEsAdmin) fallas.push("BUG REPRODUCIDO: el buscador global no debería mostrar Trabajadores a un Capataz (pantalla solo-admin)");
  if (!resultado.r2_siMuestraConPermiso) fallas.push("Con el permiso de Presupuesto habilitado, el buscador sí debería mostrar resultados de ese módulo");
  if (!resultado.r2_siMuestraParaAdmin) fallas.push("Para un admin, el buscador global debería seguir mostrando todo");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE SEGURIDAD/PERMISOS (RONDA 6) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
