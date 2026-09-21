// Cobertura del parser de "Foja de Medición" (el acta que manda la Inspección de obra con el %
// que ELLOS aprueban) -- estas funciones son las que deciden qué fila del PDF/Excel es un ítem,
// cuál es un rubro, y qué % le corresponde a cada uno. Las filas de prueba de más abajo son datos
// reales (texto y números) tomados de un acta real de la Provincia de Buenos Aires / DGCYE que el
// usuario proveyó como modelo, ya agrupados palabra por palabra como los devolvería pdf.js -- así
// el test corre contra la forma real del archivo, no contra un ejemplo inventado. Ver
// tests/extract.js para cómo se sacan del index.html sin tocarlo ni necesitar un build.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargarDesdeApp } = require("./extract");

const {
  parsearPctFoja,
  esPuntoORaya,
  agruparPalabrasEnFilas,
  detectarFilaFojaMedicion,
  sugerirMesDesdeTextoInspeccion,
  normalizarBusqueda,
  puntajeCoincidenciaNombres,
} = cargarDesdeApp([
  { nombre: "parsearPctFoja" },
  { nombre: "esPuntoORaya" },
  { nombre: "agruparPalabrasEnFilas" },
  { nombre: "detectarFilaFojaMedicion" },
  { nombre: "sugerirMesDesdeTextoInspeccion" },
  { nombre: "normalizarBusqueda" },
  { nombre: "puntajeCoincidenciaNombres" },
]);

test("parsearPctFoja: interpreta porcentajes en formato argentino, puntos y rayas como 'sin dato'", () => {
  assert.equal(parsearPctFoja("40,0%"), 0.4);
  assert.equal(parsearPctFoja("0,00%"), 0);
  assert.equal(parsearPctFoja("100,0%"), 1);
  assert.equal(parsearPctFoja("."), null);
  assert.equal(parsearPctFoja("-"), null);
  assert.equal(parsearPctFoja(""), null);
  assert.equal(parsearPctFoja(null), null);
  assert.equal(parsearPctFoja(undefined), null);
});

test("esPuntoORaya: reconoce los placeholders de celda vacía del acta", () => {
  assert.equal(esPuntoORaya("."), true);
  assert.equal(esPuntoORaya("-"), true);
  assert.equal(esPuntoORaya(""), true);
  assert.equal(esPuntoORaya(undefined), true);
  assert.equal(esPuntoORaya("40,0%"), false);
});

test("agruparPalabrasEnFilas: junta palabras a la misma altura (con tolerancia) y las ordena de izquierda a derecha", () => {
  // Simula "1 1.1 Limpieza de terreno... 100,0%" con Y casi idénticos (jitter típico de pdf.js) y
  // una segunda fila bastante más abajo -- no se deben mezclar entre sí.
  const palabras = [
    { texto: "100,0%", x: 300, y: 500.2 },
    { texto: "1", x: 10, y: 500.0 },
    { texto: "1.1", x: 30, y: 500.1 },
    { texto: "Limpieza", x: 60, y: 500.3 },
    { texto: "OTRA_FILA", x: 10, y: 480.0 },
  ];
  const filas = agruparPalabrasEnFilas(palabras);
  assert.equal(filas.length, 2);
  // pdf.js: Y crece hacia arriba -- la fila con mayor Y (500.x) es la de ARRIBA, va primero.
  assert.deepEqual(filas[0], ["1", "1.1", "Limpieza", "100,0%"]);
  assert.deepEqual(filas[1], ["OTRA_FILA"]);
});

test("detectarFilaFojaMedicion: reconoce una fila de ÍTEM real del acta (Tanque de reserva, 60/40/100)", () => {
  const tokens = "3 18 Tanque reserva de agua y/o cisterna 0,00% 60,0% 40,0% 100,0% . .".split(" ");
  const det = detectarFilaFojaMedicion(tokens);
  assert.equal(det.tipo, "item");
  assert.equal(det.rubroNum, 3);
  assert.equal(det.codigo, "18");
  assert.equal(det.descripcion, "Tanque reserva de agua y/o cisterna");
  assert.equal(det.anterior, 0.6);
  assert.equal(det.enElMes, 0.4);
  assert.equal(det.acumulado, 1);
});

test("detectarFilaFojaMedicion: reconoce una fila de RUBRO real del acta (Trabajos preparatorios)", () => {
  const tokens = "1 - TRABAJOS PREPARATORIOS (todas las demoliciones, extracciones y 2,20% . . . 0,5% 99,0%".split(" ");
  const det = detectarFilaFojaMedicion(tokens);
  assert.equal(det.tipo, "rubro");
  assert.equal(det.rubroNum, 1);
  assert.equal(det.descripcion, "TRABAJOS PREPARATORIOS (todas las demoliciones, extracciones y");
  assert.equal(Math.round(det.incidencia*10000), 220);
  assert.equal(det.enElMes, 0.005);
  assert.equal(det.acumulado, 0.99);
});

test("detectarFilaFojaMedicion: descarta filas sueltas que no tienen la forma esperada (encabezados, texto libre)", () => {
  assert.equal(detectarFilaFojaMedicion(["Nº", "DESCRIPCIÓN", "Cantidad"]), null);
  assert.equal(detectarFilaFojaMedicion(["PROGRAMA:", "CAF", "PROVINCIA"]), null);
  assert.equal(detectarFilaFojaMedicion(["Representante", "Técnico", "(firma", "y", "aclaración)", "2", "de", "Inspector"]), null);
});

test("detectarFilaFojaMedicion: una fila de ítem con TODAS las % en 0 (nada avanzó) no se descarta por error", () => {
  const tokens = "2 2.2 Relleno y nivelación c/ tierra negra en forma mecánica 0,00% 0,0% 0,0% 0,0% . .".split(" ");
  const det = detectarFilaFojaMedicion(tokens);
  assert.equal(det.tipo, "item");
  assert.equal(det.anterior, 0);
  assert.equal(det.enElMes, 0);
  assert.equal(det.acumulado, 0);
});

test("sugerirMesDesdeTextoInspeccion: encuentra el número de Certificado de Obra en el texto del acta", () => {
  const filas = [
    ["PROGRAMA:", "CAF", "PROVINCIA"],
    ["CORRESPONDE", "AL", "CERTIFICADO", "DE", "OBRA", "Nº:", "12"],
  ];
  assert.equal(sugerirMesDesdeTextoInspeccion(filas), 12);
});

test("sugerirMesDesdeTextoInspeccion: sin ninguna mención reconocible, no inventa un número", () => {
  assert.equal(sugerirMesDesdeTextoInspeccion([["nada", "de", "esto", "menciona", "un", "período"]]), null);
});

test("puntajeCoincidenciaNombres: una descripción truncada por el ancho del PDF igual matchea bien contra el nombre completo", () => {
  const truncado = "Cerco de obra - Panel fenólico de 15 mm y estructura Tirantes de madera 3\"x3\"";
  const completo = "Cerco de obra - Panel fenólico de 15 mm y estructura Tirantes de madera 3\"x3\" con paños de chapa";
  const p = puntajeCoincidenciaNombres(truncado, completo);
  assert.ok(p >= 0.7, `esperaba puntaje alto, dio ${p}`);
});

test("puntajeCoincidenciaNombres: dos ítems sin relación dan puntaje bajo", () => {
  const p = puntajeCoincidenciaNombres("Mampostería Bloque Std. de H° Liso 19x19x39", "Grifería automática lavatorio s/mesada");
  assert.ok(p < 0.3, `esperaba puntaje bajo, dio ${p}`);
});
