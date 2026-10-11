// Bug real encontrado en auditoría: guardarPedido() reconstruye los ítems desde npItems con un
// map que solo copia {desc,cant,un,imagen,entregado} -- se pierde it.cerrado (la marca "Cerrado
// sin completar, no llega el resto"). Cualquier edición de un pedido, aunque sea un campo sin
// relación (ej: observaciones), reabre silenciosamente esos ítems y revierte el estado del pedido
// de Completo a Parcial/Pendiente.
// También se agrega: validación de N° duplicado al auto-asignar un pedido NUEVO (antes solo se
// validaba al corregir el N° de uno YA EXISTENTE).
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // El SDK real de Firebase (gstatic) carga en CI con internet real pero no en
  // el sandbox de desarrollo (CDN bloqueado) -- bloquearlo siempre hace que el
  // mock de window.firebase de abajo sea quien manda en los dos entornos por igual.
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
    tiposCosto = tiposCosto || [];
    irA("pedidos");
  });

  // ---- 1) Editar un pedido con un ítem "cerrado" no debe reabrirlo ----
  const r1 = await page.evaluate(async () => {
    const id = "ped1";
    const pedido = {
      id, numero: 50, fecha: hoyISO(), obra: "ObraTest", rubro: "1", tipo: "material",
      respRecepcion: "Juan", proveedor: "", observaciones: "",
      ingreso: { A: false, B: false, C: false, fecha: "" },
      items: [
        { desc: "Disco de corte", cant: "4", un: "u", imagen: null, entregado: 2, cerrado: true },
      ],
      adjuntos: [], estado: "Completo",
    };
    pedidosCache[id] = pedido;
    pedidosIndex.push({ id, numero: 50, fecha: pedido.fecha, obra: pedido.obra, rubro: pedido.rubro, estado: "Completo", ingresoFecha: "", tipo: "material", estadoContratacion: null });

    await editarPedido(id);
    // Se edita un campo SIN relación con los ítems -- ej: observaciones.
    document.getElementById("np-observaciones").value = "Corrección de un typo, nada que ver con los ítems";
    await guardarPedido();

    const guardado = pedidosCache[id];
    return { cerrado: guardado.items[0].cerrado, estado: guardado.estado, indiceEstado: pedidosIndex.find(p => p.id === id).estado };
  });
  console.log("1) Editar un campo sin relación no debe reabrir un ítem cerrado a mano:", JSON.stringify(r1));
  if (r1.cerrado !== true) throw new Error(`1) BUG REPRODUCIDO: el ítem cerrado a mano se reabrió silenciosamente al editar un campo sin relación (cerrado=${r1.cerrado})`);
  if (r1.estado !== "Completo") throw new Error(`1) BUG REPRODUCIDO: el pedido debería seguir "Completo", quedó "${r1.estado}"`);
  if (r1.indiceEstado !== "Completo") throw new Error(`1) El índice de pedidos también debería reflejar "Completo", quedó "${r1.indiceEstado}"`);

  // ---- 2) No debe poder auto-asignarse un N° ya usado por otro pedido ----
  const r2 = await page.evaluate(async () => {
    // Ya existe el pedido N°50 (del paso anterior) -- forzamos el correlativo a que choque.
    correlativoSiguiente = 50;
    const cantidadAntes = pedidosIndex.length;
    document.getElementById("np-obra").innerHTML = `<option value="ObraTest">ObraTest</option>`;
    document.getElementById("np-rubro").innerHTML = `<option value="1">1</option>`;
    cambiarVistaPedidos("nuevo");
    document.getElementById("np-obra").value = "ObraTest";
    document.getElementById("np-rubro").value = "1";
    npItems[0] = { desc: "Otro material", cant: "1", un: "u", imagen: null, entregado: 0 };
    await guardarPedido();
    return { cantidadDespues: pedidosIndex.length, cantidadAntes, correlativoSigueIgual: correlativoSiguiente === 50 };
  });
  console.log("2) No se puede auto-asignar un N° ya usado:", JSON.stringify(r2));
  if (r2.cantidadDespues !== r2.cantidadAntes) throw new Error(`2) BUG REPRODUCIDO: se creó un pedido duplicado con un N° ya usado (había ${r2.cantidadAntes}, ahora hay ${r2.cantidadDespues})`);
  if (!r2.correlativoSigueIgual) throw new Error("2) El correlativo no debería haberse incrementado si el guardado se bloqueó");

  console.log("Errores de página:", JSON.stringify(errs));
  if (errs.length) throw new Error("Hubo errores de página durante las pruebas");

  console.log("\nTODOS LOS CHEQUEOS DE PEDIDOS (CERRADO PRESERVADO Y SIN DUPLICADOS) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
