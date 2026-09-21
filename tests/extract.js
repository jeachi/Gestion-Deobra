// Gestión de Obra es un único index.html con todo el JS en un <script> inline, sin build ni
// módulos -- no hay forma de "importar" sus funciones normalmente. En vez de reestructurar 26 mil
// líneas de app en producción solo para poder testearla (riesgo enorme para ganar poco), este
// helper extrae el código fuente de funciones/constantes puntuales directo del HTML, por nombre,
// contando llaves para encontrar el cierre correcto. Sirve para las funciones de cálculo puro que
// no dependen del DOM ni de datos globales de la app (fechas, moneda, texto) -- para esas alcanza
// con tener su propio código, sin necesitar el resto de la app alrededor.
"use strict";
const fs = require("fs");
const path = require("path");

function leerScriptInline(indexPath) {
  const html = fs.readFileSync(indexPath, "utf-8");
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error("No se encontró el <script> inline en " + indexPath);
  return m[1];
}

// Extrae "function nombre(...) { ... }" contando llaves balanceadas desde la primera "{".
// No entiende strings/regex con llaves adentro -- alcanza para las funciones puras y chicas que
// se testean acá, revisadas a mano para no tener ese caso.
function extraerFuncion(srcScript, nombre) {
  const marcador = `function ${nombre}(`;
  const inicio = srcScript.indexOf(marcador);
  if (inicio === -1) throw new Error(`No se encontró function ${nombre}(...) en el script`);
  const inicioLlave = srcScript.indexOf("{", inicio);
  let profundidad = 0, i = inicioLlave;
  for (; i < srcScript.length; i++) {
    if (srcScript[i] === "{") profundidad++;
    else if (srcScript[i] === "}") {
      profundidad--;
      if (profundidad === 0) break;
    }
  }
  if (profundidad !== 0) throw new Error(`No se pudo balancear las llaves de ${nombre}`);
  return srcScript.slice(inicio, i + 1);
}

// Extrae una declaración de una sola línea: "const NOMBRE = ...;"
function extraerConstSimple(srcScript, nombre) {
  const re = new RegExp(`^const ${nombre}\\s*=.*;$`, "m");
  const m = srcScript.match(re);
  if (!m) throw new Error(`No se encontró const ${nombre} = ...; en el script`);
  return m[0];
}

// Junta varios extractos (funciones/const, en el orden que se pasen) y los compila en una función
// que expone lo pedido -- así el test los llama como si fueran un módulo normal.
function cargarDesdeApp(nombres) {
  const indexPath = path.join(__dirname, "..", "index.html");
  const src = leerScriptInline(indexPath);
  const piezas = nombres.map((n) => {
    if (n.tipo === "const") return extraerConstSimple(src, n.nombre);
    return extraerFuncion(src, n.nombre);
  });
  const exportados = nombres.map((n) => n.nombre).join(", ");
  const cuerpo = `${piezas.join("\n\n")}\n\nmodule.exports = { ${exportados} };`;
  const mod = { exports: {} };
  new Function("module", "exports", cuerpo)(mod, mod.exports);
  return mod.exports;
}

module.exports = { leerScriptInline, extraerFuncion, extraerConstSimple, cargarDesdeApp };
