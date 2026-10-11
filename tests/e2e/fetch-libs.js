// Algunos tests de tests/e2e/ necesitan la librería REAL (no un stub) para probar la integración
// de verdad -- lo que carga la app desde el CDN se intercepta (page.route) y se sirve desde una
// copia local de la MISMA versión exacta que usa index.html. Estas copias no se commitean al
// repo (ver .gitignore) -- se bajan acá con "npm pack" antes de correr los tests, tanto en CI
// como en una máquina de desarrollo. Si se actualiza la versión de alguna librería en index.html,
// hay que actualizar el número de versión ACÁ TAMBIÉN para que los tests sigan probando lo mismo
// que corre en producción.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const LIBS_DIR = path.join(__dirname, "libs");

// {carpetaDestino, paquete@version, archivoEsperado (solo para avisar si npm pack cambió su estructura)}
// "--strip-components=1" sacado a propósito: el .tgz de npm siempre trae todo adentro de una
// carpeta "package/" (sea cual sea el nombre real del paquete) -- sin este flag, "chart.js"
// aterrizaba como libs/chartjs/package/dist/... (doble "package"), una trampa boba de nombres.
const LIBS = [
  { carpeta: "chartjs", paquete: "chart.js@4.5.1", archivo: "dist/chart.umd.min.js" },
  { carpeta: "fusejs", paquete: "fuse.js@6.6.2", archivo: "dist/fuse.min.js" },
  { carpeta: "jspdf", paquete: "jspdf@3.0.4", archivo: "dist/jspdf.umd.min.js" },
  { carpeta: "html2canvas", paquete: "html2canvas@1.4.1", archivo: "dist/html2canvas.min.js" },
];

fs.mkdirSync(LIBS_DIR, { recursive: true });

for (const lib of LIBS) {
  const destino = path.join(LIBS_DIR, lib.carpeta);
  const archivoFinal = path.join(destino, lib.archivo);
  if (fs.existsSync(archivoFinal)) {
    console.log(`✓ ${lib.paquete} ya está (${lib.archivo})`);
    continue;
  }
  fs.mkdirSync(destino, { recursive: true });
  console.log(`Descargando ${lib.paquete}...`);
  execSync(`npm pack ${lib.paquete}`, { cwd: destino, stdio: "inherit" });
  const tgz = fs.readdirSync(destino).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack no generó ningún .tgz para ${lib.paquete}`);
  execSync(`tar xzf ${tgz} --strip-components=1`, { cwd: destino, stdio: "inherit" });
  fs.unlinkSync(path.join(destino, tgz));
  if (!fs.existsSync(archivoFinal)) {
    throw new Error(`Se esperaba encontrar ${lib.archivo} dentro de ${lib.paquete} y no está -- ¿cambió la estructura del paquete?`);
  }
  console.log(`✓ ${lib.paquete} listo`);
}
