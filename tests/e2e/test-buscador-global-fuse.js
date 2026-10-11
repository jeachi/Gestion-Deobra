// El buscador global (⌘/🔍) hacía match exacto por substring (con tildes normalizadas). Se suma
// Fuse.js para tolerar errores de tipeo ("talador" encuentra "Taladro") y para que los resultados
// más parecidos aparezcan primero, SIN tocar el resto: mismo límite de 8 por grupo, mismos
// permisos por rol/módulo, mismo cierre al hacer click. Si el CDN de Fuse.js no carga, cae al
// mismo filtro por substring que ya tenía la app (se prueba también ese camino).
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.route("https://cdnjs.cloudflare.com/ajax/libs/fuse.js/6.6.2/fuse.min.js", async (route) => {
    await route.fulfill({ path: path.join(__dirname, "libs/fusejs/dist/fuse.min.js"), contentType: "application/javascript" });
  });

  await page.addInitScript(() => {
    window.firebase = { initializeApp(){}, firestore(){return {collection(){return {doc(){return {get:async()=>({exists:false}),set:async()=>{},delete:async()=>{}};},get:async()=>({docs:[]})};}};}, auth(){return {signInAnonymously:()=>Promise.resolve()};} };
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  await page.evaluate(() => {
    obraPredeterminada = "VARELA"; obras = ["VARELA", "LANUS"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    trabajadores = [
      { id:"t1", nombre:"Carlos Ruiz", categoria:"Oficial", obra:"VARELA", estado:"activo" },
      { id:"t2", nombre:"Martín Gómez", categoria:"Ayudante", obra:"VARELA", estado:"activo" },
      { id:"t3", nombre:"José Pérez", categoria:"Oficial", obra:"LANUS", estado:"baja" },
    ];
    herramientas = [
      { id:"h1", nombre:"Taladro Bosch GSB 13 RE", obra:"VARELA", estado:"bien" },
      { id:"h2", nombre:"Amoladora Makita", obra:"LANUS", estado:"danada" },
    ];
    pedidosIndex = [{ id:"p1", numero:12, obra:"VARELA", rubro:"Hormigón", estado:"pendiente", fecha:"2026-02-01" }];
    remitosIndex = [{ id:"r1", numero:17, obra:"VARELA", fecha:"2026-02-02" }];
    observaciones = [{ id:"o1", titulo:"Falta señalización", descripcion:"en la entrada", obra:"VARELA", responsable:"Martín", prioridad:"alta", fecha:"2026-02-03" }];
    minutasIndex = [{ id:"m1", numero:13, obra:"VARELA", fecha:"2026-02-04" }];
    presupuestoItems = [{ rubro:"1.1", rubroNombre:"Movimiento de suelo", nombre:"Excavación zanjas", precioConCoef:12345 }];
    irA("dashboard");
  });
  await page.waitForTimeout(100);

  // ---- 1) Con Fuse.js real: un typo encuentra al trabajador/herramienta igual ----
  const conTypo = await page.evaluate(() => {
    abrirBuscadorGlobal();
    document.getElementById("buscador-global-input").value = "marton gomez"; // typo de "Martín Gómez"
    ejecutarBusquedaGlobal();
    const html = document.getElementById("buscador-global-resultados").innerHTML;
    return { fuseDisponible: typeof Fuse !== "undefined", encontroConTypo: html.includes("Martín Gómez") };
  });

  // ---- 2) Coincidencia exacta sigue funcionando en todos los grupos ----
  const exactos = await page.evaluate(() => {
    const buscar = (texto) => {
      document.getElementById("buscador-global-input").value = texto;
      ejecutarBusquedaGlobal();
      return document.getElementById("buscador-global-resultados").innerHTML;
    };
    return {
      trabajador: buscar("Jose Perez").includes("José Pérez"), // sin tilde, debe encontrar
      pedido: buscar("Hormigon").includes("Pedido N° 12"),
      remito: buscar("17").includes("Remito N° 17"),
      herramienta: buscar("Amoladora").includes("Amoladora Makita"),
      observacion: buscar("señalizacion").includes("Falta señalización"),
      minuta: buscar("13").includes("Minuta N° 13"),
      presupuesto: buscar("Excavacion").includes("Excavación zanjas"),
    };
  });

  // ---- 3) Sin resultados sigue mostrando el estado vacío de siempre ----
  const sinResultados = await page.evaluate(() => {
    document.getElementById("buscador-global-input").value = "zzzzz_no_existe";
    ejecutarBusquedaGlobal();
    return document.getElementById("buscador-global-resultados").innerHTML.includes("Sin resultados");
  });

  // ---- 4) Permisos por rol se siguen respetando (Capataz sin acceso a Presupuesto) ----
  const comoCapataz = await page.evaluate(() => {
    usuarios.push({ username:"capataz", role:"capataz", permisos:{presupuesto:false, pedidos:true} });
    ingresarComo({ username:"capataz", role:"capataz", permisos:{presupuesto:false, pedidos:true} });
    document.getElementById("buscador-global-input").value = "Excavacion";
    ejecutarBusquedaGlobal();
    const sinPresupuesto = !document.getElementById("buscador-global-resultados").innerHTML.includes("Excavación zanjas");
    document.getElementById("buscador-global-input").value = "Hormigon";
    ejecutarBusquedaGlobal();
    const conPedidos = document.getElementById("buscador-global-resultados").innerHTML.includes("Pedido N° 12");
    const noTrabajadores = !document.getElementById("buscador-global-resultados").innerHTML.includes("👷"); // capataz no admin -> sin trabajadores
    return { sinPresupuesto, conPedidos };
  });

  // ---- 5) Click en un resultado navega y cierra el buscador (comportamiento de siempre) ----
  const clickNavega = await page.evaluate(() => {
    ingresarComo({ username:"admin", role:"admin", permisos:{} });
    document.getElementById("buscador-global-input").value = "Hormigon";
    ejecutarBusquedaGlobal();
    document.querySelector("#buscador-global-resultados .bg-item").click();
    return {
      vistaCambio: vistaActualNexo === "pedidos",
      buscadorCerrado: document.getElementById("buscador-global-overlay").style.display === "none",
    };
  });

  // ---- 6) Camino de respaldo: sin Fuse.js disponible, sigue funcionando por substring ----
  const sinFuse = await page.evaluate(() => {
    const original = window.Fuse;
    delete window.Fuse;
    abrirBuscadorGlobal();
    document.getElementById("buscador-global-input").value = "Hormigon";
    ejecutarBusquedaGlobal();
    const funcionaSinFuse = document.getElementById("buscador-global-resultados").innerHTML.includes("Pedido N° 12");
    document.getElementById("buscador-global-input").value = "marton gomez"; // el typo NO debería encontrar nada sin Fuse (substring exacto)
    ejecutarBusquedaGlobal();
    const noToleraTypoSinFuse = !document.getElementById("buscador-global-resultados").innerHTML.includes("Martín Gómez");
    window.Fuse = original;
    return { funcionaSinFuse, noToleraTypoSinFuse };
  });

  const resultado = { conTypo, exactos, sinResultados, comoCapataz, clickNavega, sinFuse };
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!conTypo.fuseDisponible) fallas.push("BUG: Fuse.js no se pudo cargar (revisar el route de este test)");
  if (!conTypo.encontroConTypo) fallas.push("BUG: con Fuse.js disponible, un typo ('marton gomez') no encontró a 'Martín Gómez'");
  for (const [k, v] of Object.entries(exactos)) if (!v) fallas.push(`BUG: la búsqueda exacta del grupo '${k}' dejó de funcionar`);
  if (!sinResultados) fallas.push("BUG: una búsqueda sin coincidencias no muestra el estado vacío de 'Sin resultados'");
  if (!comoCapataz.sinPresupuesto) fallas.push("BUG: un Capataz sin permiso de Presupuesto puede ver resultados de Presupuesto en el buscador");
  if (!comoCapataz.conPedidos) fallas.push("BUG: un Capataz CON permiso de Pedidos no ve resultados de Pedidos");
  if (!clickNavega.vistaCambio) fallas.push("BUG: hacer click en un resultado no navega al módulo correspondiente");
  if (!clickNavega.buscadorCerrado) fallas.push("BUG: hacer click en un resultado no cierra el buscador");
  if (!sinFuse.funcionaSinFuse) fallas.push("BUG: sin Fuse.js disponible, la búsqueda exacta por substring (respaldo) no funciona");
  if (!sinFuse.noToleraTypoSinFuse) fallas.push("BUG (inesperado): sin Fuse.js, el respaldo por substring de alguna forma toleró un typo");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DEL BUSCADOR GLOBAL CON FUSE.JS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
