// Pedido del usuario: "en los pedidos y cajas se ordenen por número descendente o que permita
// ordenar con un botón" -- antes ninguna de las dos listas tenía un .sort() explícito por número
// (dependían del orden de inserción con unshift(), que de casualidad coincide con descendente) ni
// había ningún botón para cambiar el orden. Ahora ambas listas se ordenan siempre de forma
// explícita por N° (descendente por defecto) y tienen un botón "N° ⌄/⌃" para alternar.
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
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
  });

  await page.goto("http://localhost:8811/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("pantalla-arranque").style.display === "none", { timeout: 20000 });

  await page.evaluate(() => {
    sesionActual = { username: "admin", role: "admin", permisos: {} };
    obraPredeterminada = "ObraTest";
    obras = ["ObraTest"];
    obrasFinalizadas = [];
  });

  // ---- 1) Pedidos: por defecto, N° descendente (más alto primero), aunque se carguen desordenados ----
  const r1 = await page.evaluate(async () => {
    pedidosIndex = [
      { id: "p10", numero: 10, fecha: hoyISO(), obra: "ObraTest", rubro: "1", estado: "Pendiente", ingresoFecha: "" },
      { id: "p30", numero: 30, fecha: hoyISO(), obra: "ObraTest", rubro: "1", estado: "Pendiente", ingresoFecha: "" },
      { id: "p20", numero: 20, fecha: hoyISO(), obra: "ObraTest", rubro: "1", estado: "Pendiente", ingresoFecha: "" },
    ];
    ordenPedidosDesc = true;
    irA("pedidos");
    await renderListaPedidos();
    const nums = [...document.querySelectorAll("#lista-pedidos .ped-num")].map(s => s.textContent);
    const textoBoton = document.getElementById("ped-btn-orden").textContent;
    return { nums, textoBoton };
  });
  console.log("1) Pedidos, orden inicial descendente:", JSON.stringify(r1));
  if (!/30/.test(r1.nums[0]) || !/10/.test(r1.nums[2])) throw new Error(`1) BUG: los pedidos no están ordenados descendente por N° -- quedó: ${JSON.stringify(r1.nums)}`);
  if (!r1.textoBoton.includes("⌄")) throw new Error(`1) BUG: el botón de orden no muestra el estado descendente -- texto: "${r1.textoBoton}"`);

  // ---- 2) Pedidos: tocar el botón alterna a ascendente (más viejo primero) ----
  const r2 = await page.evaluate(async () => {
    document.getElementById("ped-btn-orden").click();
    await new Promise(r => setTimeout(r, 50));
    const nums = [...document.querySelectorAll("#lista-pedidos .ped-num")].map(s => s.textContent);
    const textoBoton = document.getElementById("ped-btn-orden").textContent;
    return { nums, textoBoton };
  });
  console.log("2) Pedidos, tras tocar el botón:", JSON.stringify(r2));
  if (!/10/.test(r2.nums[0]) || !/30/.test(r2.nums[2])) throw new Error(`2) BUG: tocar el botón no invirtió el orden -- quedó: ${JSON.stringify(r2.nums)}`);
  if (!r2.textoBoton.includes("⌃")) throw new Error(`2) BUG: el botón no refleja el nuevo estado ascendente -- texto: "${r2.textoBoton}"`);

  // ---- 3) Caja Chica: por defecto, N° descendente, y el botón alterna igual que en Pedidos ----
  const r3 = await page.evaluate(async () => {
    rendicionesIndex = [
      { id: "r5", numero: 5, obra: "ObraTest", responsable: "Juan", usuario: "admin", mes: "2026-01", quincena: 1, totalGastos: 0, totalCaja: 0, diferencia: 0 },
      { id: "r7", numero: 7, obra: "ObraTest", responsable: "Juan", usuario: "admin", mes: "2026-01", quincena: 2, totalGastos: 0, totalCaja: 0, diferencia: 0 },
      { id: "r6", numero: 6, obra: "ObraTest", responsable: "Juan", usuario: "admin", mes: "2026-01", quincena: 1, totalGastos: 0, totalCaja: 0, diferencia: 0 },
    ];
    ordenRendicionesDesc = true;
    irA("caja");
    renderListaRendiciones();
    const nums = [...document.querySelectorAll("#lista-rendiciones .rc-num, #lista-rendiciones .rendicion-card")].map(el => el.textContent);
    const textoBoton = document.getElementById("caja-btn-orden").textContent;
    return { nums, textoBoton };
  });
  console.log("3) Caja Chica, orden inicial descendente:", JSON.stringify({ textoBoton: r3.textoBoton, primera: r3.nums[0] && r3.nums[0].slice(0, 40) }));
  if (!r3.nums[0] || !r3.nums[0].includes("0007")) throw new Error(`3) BUG: la rendición N°7 debería ser la primera (descendente) -- quedó: ${JSON.stringify(r3.nums.map(n => n.slice(0, 40)))}`);
  if (!r3.textoBoton.includes("⌄")) throw new Error(`3) BUG: el botón de orden de Caja Chica no muestra el estado descendente -- texto: "${r3.textoBoton}"`);

  // ---- 4) Caja Chica: tocar el botón alterna a ascendente ----
  const r4 = await page.evaluate(async () => {
    document.getElementById("caja-btn-orden").click();
    const nums = [...document.querySelectorAll("#lista-rendiciones .rendicion-card")].map(el => el.textContent);
    const textoBoton = document.getElementById("caja-btn-orden").textContent;
    return { nums, textoBoton };
  });
  console.log("4) Caja Chica, tras tocar el botón:", JSON.stringify({ textoBoton: r4.textoBoton, primera: r4.nums[0] && r4.nums[0].slice(0, 40) }));
  if (!r4.nums[0] || !r4.nums[0].includes("0005")) throw new Error(`4) BUG: tras alternar, la N°5 debería ser la primera (ascendente) -- quedó: ${JSON.stringify(r4.nums.map(n => n.slice(0, 40)))}`);
  if (!r4.textoBoton.includes("⌃")) throw new Error(`4) BUG: el botón no refleja el nuevo estado ascendente -- texto: "${r4.textoBoton}"`);

  console.log("Errores de página:", JSON.stringify(errs));
  if (errs.length) throw new Error("Hubo errores de página durante las pruebas");

  console.log("\nTODOS LOS CHEQUEOS DE ORDEN EN PEDIDOS Y CAJA CHICA OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
