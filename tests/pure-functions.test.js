// Cobertura de las funciones de cálculo puro más críticas de la app (moneda, fechas de quincena,
// búsqueda, escape de HTML) -- justo las que, si se rompen, rompen sueldos/rendiciones/reportes
// en silencio. Ver tests/extract.js para cómo se sacan del index.html sin tocarlo ni necesitar
// un build. No cubre nada que dependa del DOM, Firestore o del estado global de la app (eso
// necesitaría un entorno de navegador simulado, es un paso más grande a futuro).
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargarDesdeApp } = require("./extract");

const {
  pad2, diasDelMes, rangoQuincena, fechaDia, esFinde, headerDia, esc, formatoMoneda, normalizarBusqueda,
} = cargarDesdeApp([
  { nombre: "pad2" },
  { nombre: "diasDelMes" },
  { nombre: "rangoQuincena" },
  { nombre: "fechaDia" },
  { nombre: "esFinde" },
  { nombre: "DIAS_ES", tipo: "const" },
  { nombre: "headerDia" },
  { nombre: "esc" },
  { nombre: "formatoMoneda" },
  { nombre: "normalizarBusqueda" },
]);

const { calcularMamposteria } = cargarDesdeApp([{ nombre: "calcularMamposteria" }]);

test("pad2 rellena con cero a la izquierda", () => {
  assert.equal(pad2(1), "01");
  assert.equal(pad2(9), "09");
  assert.equal(pad2(10), "10");
  assert.equal(pad2(31), "31");
});

test("diasDelMes calcula bien meses cortos, largos y febrero (bisiesto y no)", () => {
  assert.equal(diasDelMes(2026, 1), 31); // enero
  assert.equal(diasDelMes(2026, 4), 30); // abril
  assert.equal(diasDelMes(2026, 2), 28); // 2026 no es bisiesto
  assert.equal(diasDelMes(2024, 2), 29); // 2024 sí es bisiesto
});

test("rangoQuincena: la primera siempre 1-15, la segunda hasta el último día real del mes", () => {
  assert.deepEqual(rangoQuincena(2026, 1, 1), { desde: 1, hasta: 15 });
  assert.deepEqual(rangoQuincena(2026, 1, 2), { desde: 16, hasta: 31 });
  assert.deepEqual(rangoQuincena(2026, 4, 2), { desde: 16, hasta: 30 });
  assert.deepEqual(rangoQuincena(2024, 2, 2), { desde: 16, hasta: 29 }); // bisiesto
});

test("fechaDia arma la fecha esperada (mes 1-a-12, como el resto de la app)", () => {
  const d = fechaDia(2026, 3, 15);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2); // Date interno usa 0-11
  assert.equal(d.getDate(), 15);
});

test("esFinde distingue sábado/domingo de días de semana", () => {
  // 2026-03-21 es sábado, 2026-03-23 es lunes (verificado contra un calendario real)
  assert.equal(esFinde(2026, 3, 21), true);
  assert.equal(esFinde(2026, 3, 22), true);
  assert.equal(esFinde(2026, 3, 23), false);
});

test("headerDia arma \"abrev\\nDD/MM\" con el día de semana correcto", () => {
  assert.equal(headerDia(2026, 3, 23), "lun\n23/03");
});

test("esc escapa comillas dobles para no romper atributos HTML, y tolera null/undefined", () => {
  assert.equal(esc('Juan "el rápido" Pérez'), "Juan &quot;el rápido&quot; Pérez");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(123), "123");
});

test("esc también escapa <, > y & (evita XSS persistente al insertar texto libre vía innerHTML)", () => {
  assert.equal(esc("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(esc("Juan & Cía"), "Juan &amp; Cía");
  // El orden importa: "&" se escapa primero, si no "&lt;" quedaría re-escapado a "&amp;lt;".
  assert.equal(esc("<a href=\"x\">"), "&lt;a href=&quot;x&quot;&gt;");
});

test("formatoMoneda: formato $ argentino, negativos, y entrada no numérica cae a $0,00", () => {
  assert.equal(formatoMoneda(1234.5), "$1.234,50");
  assert.equal(formatoMoneda(-500), "-$500,00");
  assert.equal(formatoMoneda(0), "$0,00");
  assert.equal(formatoMoneda("no es un número"), "$0,00");
  assert.equal(formatoMoneda(undefined), "$0,00");
});

test("normalizarBusqueda saca tildes y pasa a minúscula, para que 'Martin' encuentre 'Martín'", () => {
  assert.equal(normalizarBusqueda("Martín"), "martin");
  assert.equal(normalizarBusqueda("MARTIN"), "martin");
  assert.equal(normalizarBusqueda("Peón"), "peon");
  assert.equal(normalizarBusqueda(""), "");
  assert.equal(normalizarBusqueda(null), "");
});

test("calcularMamposteria: hormigón 20x20x40, muro de 8x2.5m, sin desperdicio", () => {
  const r = calcularMamposteria({ tipo:"hormigon", formato:"20x20x40", largo:8, alto:2.5, rendimiento:12.5, desperdicio:0 });
  assert.equal(r.area, 20);
  assert.equal(r.piezas, 250); // 20 * 12.5
  assert.equal(r.usoTipico, "Muros portantes, cercos y medianeras.");
});

test("calcularMamposteria: aplica el % de desperdicio redondeando hacia arriba", () => {
  const r = calcularMamposteria({ tipo:"hormigon", formato:"20x20x40", largo:8, alto:2.5, rendimiento:12.5, desperdicio:5 });
  assert.equal(r.piezas, 263); // ceil(250 * 1.05) = ceil(262.5)
});

test("calcularMamposteria: ladrillo común 'de plano' usa el texto de pared doble", () => {
  const r = calcularMamposteria({ tipo:"ladrillo", formato:"6x12x24-plano", largo:5, alto:2.5, rendimiento:144, desperdicio:0 });
  assert.match(r.usoTipico, /pared doble/);
});

test("calcularMamposteria: ladrillo común 'de canto' (cualquier otro formato) usa el texto de pared simple", () => {
  const r = calcularMamposteria({ tipo:"ladrillo", formato:"6x12x24", largo:5, alto:2.5, rendimiento:72, desperdicio:0 });
  assert.match(r.usoTipico, /pared simple/);
});

test("calcularMamposteria: hueco y portante devuelven sus textos de uso típico propios", () => {
  assert.match(calcularMamposteria({ tipo:"hueco", formato:"hueco18", largo:1, alto:1, rendimiento:16, desperdicio:0 }).usoTipico, /NO portantes/);
  assert.match(calcularMamposteria({ tipo:"portante", formato:"portante18", largo:1, alto:1, rendimiento:16, desperdicio:0 }).usoTipico, /carga/);
});

test("calcularMamposteria: largo o alto en 0 da área y piezas en 0, no NaN ni excepción", () => {
  const r = calcularMamposteria({ tipo:"hormigon", formato:"20x20x40", largo:0, alto:2.5, rendimiento:12.5, desperdicio:5 });
  assert.equal(r.area, 0);
  assert.equal(r.piezas, 0);
});

test("calcularMamposteria: cemento, arena y cal son proporcionales a piezas (referencias fijas 180/300/220)", () => {
  const r = calcularMamposteria({ tipo:"hormigon", formato:"20x20x40", largo:8, alto:2.5, rendimiento:12.5, desperdicio:0 }); // 250 piezas
  assert.equal(r.bolsasCemento, 2);  // ceil(250/180)
  assert.equal(r.m3Arena, 0.83);     // round(250/300, 2)
  assert.equal(r.bolsasCal, 2);      // ceil(250/220)
});
