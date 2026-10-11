// "Mejoras visuales de la app en general" -- ronda 1: el modo oscuro (body.tema-oscuro, toggle
// manual en Configuración) ya existía como arquitectura de variables, pero decenas de inputs,
// selects, buscadores, tarjetas y botones tenían el fondo "background:#fff" puesto a mano en vez
// de var(--papel) -- quedaban como rectángulos blancos encendidos sobre el resto de la pantalla
// ya oscurecida. Se corrigieron (sin tocar el Plano de avance/Maestro, que a propósito tiene su
// propio look fijo tipo CAD, ni los módulos de login/impresión/PDF, que deben quedar blancos
// siempre). De paso, cambiar esos fondos a oscuro destapó un segundo bug: varios de esos mismos
// botones/chips usaban "color:var(--verde-oscuro)" o un rojo fijo como texto -- un tono pensado
// para leerse sobre blanco -- que al quedar sobre el nuevo fondo oscuro se volvía casi invisible
// (texto oscuro sobre fondo oscuro). Se corrigió usando las variables de texto que la propia app
// ya tenía preparadas para este caso (--texto-en-verde-claro / --texto-alerta).
const { chromium } = require("playwright");

function parseRgb(css) {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function luminancia([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(rgb1, rgb2) {
  const l1 = luminancia(rgb1), l2 = luminancia(rgb2);
  const [claro, oscuro] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (claro + 0.05) / (oscuro + 0.05);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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

  const resultado = await page.evaluate(async () => {
    obraPredeterminada = "VARELA"; obras = ["VARELA"]; obrasFinalizadas = [];
    usuarios = [{ username: "admin", role: "admin", password: "x".repeat(64) }];
    trabajadores = [{ id: "t1", nombre: "Juan Pérez", obra: "VARELA", estado: "Activo", categoria: "Oficial" }];
    pedidosIndex = [{ id: "p1", obra: "VARELA", estado: "Pendiente", fecha: hoyISO(), numero: 1 }];
    ingresarComo({ username: "admin", role: "admin", permisos: {} });
    await new Promise(r => setTimeout(r, 200));

    // ==== Activar el tema oscuro real de la app (no prefers-color-scheme -- es un toggle manual
    // guardado por usuario, ver aplicarTemaColor()) ====
    temaColor = "oscuro";
    aplicarTemaColor();
    const r1_elBodyQuedaConLaClase = document.body.classList.contains("tema-oscuro");

    irA("trabajadores");
    await new Promise(r => setTimeout(r, 200));

    // ==== El input "Nombre" (.field input) ya NO debería quedar blanco fijo ====
    const inputNombre = document.querySelector(".field input");
    const bgInputNombre = getComputedStyle(inputNombre).backgroundColor;
    const r2_elInputDeFormularioYaNoEsBlancoFijo = bgInputNombre !== "rgb(255, 255, 255)";

    // ==== El buscador (.filtro-obra-input, reusado en Pedidos/Certificados/Caja) tampoco ====
    irA("pedidos");
    await new Promise(r => setTimeout(r, 200));
    const buscador = document.querySelector(".filtro-obra-input");
    const bgBuscador = buscador ? getComputedStyle(buscador).backgroundColor : null;
    const r3_elBuscadorYaNoEsBlancoFijo = bgBuscador !== "rgb(255, 255, 255)";

    // ==== El número de pedido ".ped-num" (texto en negrita sobre la tarjeta, que ahora tiene
    // fondo oscuro) tampoco puede seguir usando el verde-oscuro fijo pensado para fondo blanco ====
    const numPedido = document.querySelector(".pedido-card .ped-num");
    const estiloNumPedido = numPedido ? getComputedStyle(numPedido) : null;
    const bgCardPedido = numPedido ? getComputedStyle(numPedido.closest(".pedido-card")).backgroundColor : null;
    const colorNumPedido = estiloNumPedido ? estiloNumPedido.color : null;

    // ==== El botón "+ Nuevo pedido" (.subtabs-scroll button) sigue siendo LEGIBLE -- el fondo
    // pasó a oscuro, así que el texto no puede seguir siendo el mismo "var(--verde-oscuro)"
    // pensado para fondo blanco (ver nota del archivo) ====
    const btnNuevoPedido = document.getElementById("btn-ped-nuevo");
    const estiloBtn = btnNuevoPedido ? getComputedStyle(btnNuevoPedido) : null;
    const bgBtn = estiloBtn ? estiloBtn.backgroundColor : null;
    const colorBtn = estiloBtn ? estiloBtn.color : null;

    return {
      r1_elBodyQuedaConLaClase, r2_elInputDeFormularioYaNoEsBlancoFijo, r3_elBuscadorYaNoEsBlancoFijo,
      bgInputNombre, bgBuscador, bgBtn, colorBtn, bgCardPedido, colorNumPedido,
    };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_elBodyQuedaConLaClase) fallas.push("El toggle de tema oscuro no agrega la clase body.tema-oscuro");
  if (!resultado.r2_elInputDeFormularioYaNoEsBlancoFijo) fallas.push("BUG REPRODUCIDO: un input de formulario (.field input) sigue con fondo blanco fijo en modo oscuro");
  if (!resultado.r3_elBuscadorYaNoEsBlancoFijo) fallas.push("BUG REPRODUCIDO: el buscador (.filtro-obra-input) sigue con fondo blanco fijo en modo oscuro");

  if (resultado.bgBtn && resultado.colorBtn) {
    const bg = parseRgb(resultado.bgBtn);
    const fg = parseRgb(resultado.colorBtn);
    if (bg && fg) {
      const ratio = contraste(bg, fg);
      if (ratio < 4.5) {
        fallas.push(`BUG REPRODUCIDO: el botón "+ Nuevo pedido" en modo oscuro tiene contraste ${ratio.toFixed(2)}:1 (fondo ${resultado.bgBtn} / texto ${resultado.colorBtn}) -- por debajo del mínimo 4.5:1 (texto oscuro sobre fondo ahora oscuro)`);
      }
    }
  } else {
    fallas.push("No se encontró el botón \"+ Nuevo pedido\" para chequear su contraste");
  }

  if (resultado.bgCardPedido && resultado.colorNumPedido) {
    const bg = parseRgb(resultado.bgCardPedido);
    const fg = parseRgb(resultado.colorNumPedido);
    if (bg && fg) {
      const ratio = contraste(bg, fg);
      if (ratio < 4.5) {
        fallas.push(`BUG REPRODUCIDO: "N° 0001" en la tarjeta de pedido tiene contraste ${ratio.toFixed(2)}:1 en modo oscuro (fondo ${resultado.bgCardPedido} / texto ${resultado.colorNumPedido})`);
      }
    }
  } else {
    fallas.push("No se encontró \".pedido-card .ped-num\" para chequear su contraste");
  }

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE MODO OSCURO (RONDA 1) OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
