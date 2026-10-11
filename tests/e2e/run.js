// Corre todos los test-*.js de esta carpeta contra un http-server local, uno por uno (cada uno
// abre su propio browser con Playwright). Pensado para correr igual en una máquina de desarrollo
// y en CI (ver .github/workflows/tests.yml) -- usa solo lo que ya trae Node + los módulos del
// package.json del repo (http-server y playwright como devDependencies), sin nada instalado
// fuera del proyecto.
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const REPO_ROOT = path.join(__dirname, "..", "..");
// Puerto fijo a propósito -- cada test-*.js de esta carpeta tiene "http://localhost:8811" escrito
// adentro (no lee ninguna variable de entorno), así que cambiarlo acá solo rompería la conexión.
const PUERTO = "8811";
const TIMEOUT_POR_TEST_MS = 60000;

function esperarServidor(url, intentos) {
  return new Promise((resolve, reject) => {
    const intentar = (restantes) => {
      http.get(url, (res) => { res.resume(); resolve(); })
        .on("error", () => {
          if (restantes <= 0) return reject(new Error(`El servidor local no respondió en ${url}`));
          setTimeout(() => intentar(restantes - 1), 300);
        });
    };
    intentar(intentos);
  });
}

async function main() {
  console.log("Preparando librerías reales para los tests que las necesitan (Chart.js, Fuse.js, jsPDF, html2canvas)...");
  execFileSync(process.execPath, [path.join(__dirname, "fetch-libs.js")], { stdio: "inherit" });

  console.log(`Levantando http-server en :${PUERTO}...`);
  // "npx" (no el binario resuelto a mano) para no depender de la estructura interna del paquete
  // http-server -- usa la copia que ya instaló npm en devDependencies, sin bajar nada de más.
  const server = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["http-server", "-p", PUERTO, "-s", "."], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "ignore"],
  });

  const detenerServidor = () => { try { server.kill(); } catch (e) {} };
  process.on("exit", detenerServidor);

  try {
    await esperarServidor(`http://localhost:${PUERTO}/index.html`, 30);
  } catch (e) {
    detenerServidor();
    console.error(e.message);
    process.exit(1);
  }

  const archivos = fs.readdirSync(__dirname).filter((f) => f.startsWith("test-") && f.endsWith(".js")).sort();
  console.log(`Corriendo ${archivos.length} tests...\n`);

  let ok = 0, fail = 0;
  const fallidos = [];
  for (const archivo of archivos) {
    const inicio = Date.now();
    try {
      execFileSync(process.execPath, [path.join(__dirname, archivo)], {
        stdio: "pipe",
        timeout: TIMEOUT_POR_TEST_MS,
      });
      console.log(`PASS  ${archivo}  (${Date.now() - inicio}ms)`);
      ok++;
    } catch (e) {
      console.log(`FAIL  ${archivo}`);
      console.log((e.stdout || "").toString());
      console.log((e.stderr || "").toString());
      fail++;
      fallidos.push(archivo);
    }
  }

  detenerServidor();
  console.log(`\nTOTAL pass=${ok} fail=${fail}`);
  if (fallidos.length) console.log("Fallidos: " + fallidos.join(", "));
  process.exit(fail > 0 ? 1 : 0);
}

main();
