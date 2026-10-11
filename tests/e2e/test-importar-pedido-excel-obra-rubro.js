// Bug real encontrado al reconstruir pedidos perdidos desde Excel: importarPedidoExcel() leía
// bien el Rubro del archivo, pero lo perdía al rellenar el formulario. Causa: ponía
// np-rubro.value ANTES de llamar a renderSelectsPedido() (sin argumentos) -- esa función
// reconstruye el innerHTML de los <select> de Obra y Rubro, lo que borra cualquier selección ya
// hecha. A "Obra" la salvaba una coincidencia: solo quedaba bien si el valor importado coincidía
// con obraPredeterminada (la única reasignación que hace renderSelectsPedido por su cuenta). A
// "Rubro" no la salvaba nada -- siempre quedaba vacío. El import de 18 pedidos reales (recuperados
// de PDFs tras una pérdida de datos) mostró el patrón: nunca se perdía la Obra (coincidía con la
// predeterminada en todos los casos de prueba) pero SIEMPRE se perdía el Rubro.
// Arreglo: igual que ya hace el flujo de "Editar pedido" (que llama a
// renderSelectsPedido(obra, rubro) y DESPUÉS vuelve a poner los .value a mano), la importación
// ahora pasa obraTexto/rubroTexto a renderSelectsPedido() y reasigna los .value después de esa
// llamada, no antes.
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => route.abort());
  // El SDK real de XLSX (cdnjs) se intercepta y se sirve desde la copia local exacta que usa
  // index.html (ver tests/e2e/fetch-libs.js) -- importarPedidoExcel() necesita la librería real
  // para parsear el archivo, un stub no sirve acá.
  const xlsxLocal = path.join(__dirname, "libs", "xlsx", "dist", "xlsx.full.min.js");
  await page.route("https://cdnjs.cloudflare.com/ajax/libs/xlsx/**", (route) =>
    route.fulfill({ path: xlsxLocal, contentType: "application/javascript" })
  );
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

  await page.evaluate(() => {
    // A propósito: obraPredeterminada DISTINTA de la obra del archivo a importar -- así, si el bug
    // de "Obra se salva solo por coincidir con la predeterminada" sigue ahí, este test lo detecta
    // (antes del fix, con las dos obras iguales, el bug de Obra quedaba oculto).
    obraPredeterminada = "OTRA_OBRA"; obras = ["OTRA_OBRA", "VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    irA("pedidos");
    cambiarVistaPedidos("nuevo");
  });
  await page.waitForTimeout(150);

  const archivo = path.join(__dirname, "fixtures", "pedido-importar-obra-rubro.xlsx");
  await page.setInputFiles("#input-importar-pedido", archivo);
  await page.waitForTimeout(500);

  const resultado = await page.evaluate(() => ({
    fecha: document.getElementById("np-fecha").value,
    obra: document.getElementById("np-obra").value,
    rubro: document.getElementById("np-rubro").value,
    resp: document.getElementById("np-resp").value,
    cantidadItems: npItems.filter(i => i.desc && i.desc.trim() !== "").length,
    primerItem: npItems.find(i => i.desc && i.desc.trim() !== ""),
  }));

  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (resultado.obra !== "VARELA") fallas.push(`BUG: Obra debería quedar en "VARELA" (la del archivo), dio "${resultado.obra}"`);
  if (resultado.rubro !== "ELECTRICIDAD") fallas.push(`BUG REPRODUCIDO: Rubro debería quedar en "ELECTRICIDAD" (la del archivo), dio "${resultado.rubro}" -- el <select> se vacía al reconstruirse`);
  if (resultado.fecha !== "2026-10-06") fallas.push(`fecha incorrecta: ${resultado.fecha}`);
  if (resultado.resp !== "JESUS CHIMINO") fallas.push(`responsable incorrecto: ${resultado.resp}`);
  if (resultado.cantidadItems !== 1) fallas.push(`se esperaba 1 item, dio ${resultado.cantidadItems}`);
  if (!resultado.primerItem || resultado.primerItem.desc !== "Material de prueba") fallas.push(`item incorrecto: ${JSON.stringify(resultado.primerItem)}`);
  if (errs.length) fallas.push(`error(es) de pagina sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nIMPORTAR PEDIDO EXCEL CONSERVA OBRA Y RUBRO OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
