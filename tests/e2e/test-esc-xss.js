// Vulnerabilidad crítica encontrada en ronda 4: esc() (usada en TODA la app para sanitizar texto
// libre antes de insertarlo como HTML real vía innerHTML) solo escapaba comillas dobles -- nunca
// "<", ">" ni "&". Esto permitía XSS persistente: cualquier campo de texto libre (destinatario de
// un remito, contenido de una minuta, texto de una observación, etc.) con algo como
// "<img src=x onerror=alert(1)>" quedaba guardado y se ejecutaba solo con abrir ese registro después.
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
    // ---- 1) Payload clásico de inyección de tag (atributo SIN comillas -- HTML5 lo permite,
    // y así el atacante evita depender de que las comillas dobles queden sin escapar) ----
    const payload = `<img src=x onerror=window.__xssEjecutado=true>`;
    const escapado = esc(payload);
    const r1_sinTagsCrudos = !escapado.includes("<img") && !/<[a-zA-Z]/.test(escapado);
    const r1_contieneEscapado = escapado.includes("&lt;img") && escapado.includes("&gt;");

    // ---- 2) Confirmar que insertado vía innerHTML NO ejecuta nada (esperamos el evento onerror real) ----
    const div = document.createElement("div");
    div.innerHTML = `<span>${esc(payload)}</span>`;
    document.body.appendChild(div);
    const img = div.querySelector("img");
    if (img) {
      await new Promise((resolve) => { img.addEventListener("error", resolve); img.addEventListener("load", resolve); setTimeout(resolve, 500); });
    }
    const r2_noEjecuto = window.__xssEjecutado !== true;
    const r2_textoVisiblePlano = div.textContent.includes("<img src=x");
    div.remove();

    // ---- 3) "&" se escapa antes que "<"/">" (si no, "&lt;" quedaría re-escapado a "&amp;lt;") ----
    const soloAmpersand = esc("Juan & Cía");
    const r3_ampersandOk = soloAmpersand === "Juan &amp; Cía";

    // ---- 4) Segundo vector (otro atributo/evento) también queda neutralizado ----
    const payload2 = `<img src=y onerror=window.__xssEjecutado2=true>`;
    const escPayload2 = esc(payload2);
    const div2 = document.createElement("div");
    div2.innerHTML = escPayload2;
    document.body.appendChild(div2);
    const img2 = div2.querySelector("img");
    if (img2) {
      await new Promise((resolve) => { img2.addEventListener("error", resolve); img2.addEventListener("load", resolve); setTimeout(resolve, 500); });
    }
    const r4_noEjecutoScript = window.__xssEjecutado2 !== true;
    div2.remove();

    // ---- 5) Texto normal en español (acentos, ñ) no se ve afectado ----
    const textoNormal = "Revisión técnica: instalación eléctrica en Piso 3 (Depósito Nº 2)";
    const r5_textoNormalIntacto = esc(textoNormal) === textoNormal;

    // ---- 6) Comillas dobles se siguen escapando (comportamiento previo, no debe romperse) ----
    const r6_comillasDobles = esc('Dijo "hola"') === "Dijo &quot;hola&quot;";

    return { r1_sinTagsCrudos, r1_contieneEscapado, r2_noEjecuto, r2_textoVisiblePlano, r3_ampersandOk, r4_noEjecutoScript, r5_textoNormalIntacto, r6_comillasDobles, escapadoDebug: escapado };
  });
  console.log("Resultado:", JSON.stringify(resultado, null, 2));

  const fallas = [];
  if (!resultado.r1_sinTagsCrudos) fallas.push(`BUG REPRODUCIDO (XSS): esc() debería neutralizar "<"/">" -- salió: ${resultado.escapadoDebug}`);
  if (!resultado.r1_contieneEscapado) fallas.push("esc() debería producir &lt; y &gt; para los tags");
  if (!resultado.r2_noEjecuto) fallas.push("BUG REPRODUCIDO (XSS CRÍTICO): un payload <img onerror=...> sanitizado con esc() e insertado vía innerHTML SE EJECUTÓ");
  if (!resultado.r2_textoVisiblePlano) fallas.push("El payload debería quedar visible como texto plano, no como tag real");
  if (!resultado.r3_ampersandOk) fallas.push("BUG: '&' debería escaparse a '&amp;' sin romper texto normal como 'Juan & Cía'");
  if (!resultado.r4_noEjecutoScript) fallas.push("BUG REPRODUCIDO (XSS CRÍTICO): un <script> sanitizado con esc() e insertado vía innerHTML SE EJECUTÓ");
  if (!resultado.r5_textoNormalIntacto) fallas.push("Texto normal en español no debería alterarse al pasar por esc()");
  if (!resultado.r6_comillasDobles) fallas.push("El escape de comillas dobles (comportamiento previo) no debería romperse");

  if (errs.length) fallas.push(`${errs.length} error(es) de página sin atrapar: ${JSON.stringify(errs)}`);

  if (fallas.length) {
    console.error("\nFALLÓ:\n- " + fallas.join("\n- "));
    process.exit(1);
  }
  console.log("\nTODOS LOS CHEQUEOS DE esc() XSS OK");
  await browser.close();
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
