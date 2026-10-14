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
const { calcularParedDurlock } = cargarDesdeApp([{ nombre: "calcularParedDurlock" }]);
const { calcularCielorraso } = cargarDesdeApp([{ nombre: "calcularCielorraso" }]);

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

test("calcularParedDurlock: 4x2.5m, 2 caras, modulacion 0.6, sin desperdicio", () => {
  const r = calcularParedDurlock({ largo:4, alto:2.5, caras:2, modulacion:0.6, desperdicio:0 });
  assert.equal(r.area, 10);
  assert.equal(r.areaTotal, 20);
  assert.equal(r.placas, 7);          // ceil(20/2.88)
  assert.equal(r.soleraMetros, 8);    // 2*largo
  assert.equal(r.montanteCantidad, 8); // ceil(4/0.6)+1
  assert.equal(r.montanteMetros, 20);  // 8*2.5
  assert.equal(r.tornillos, 540);      // ceil(20*27)
  assert.equal(r.cintaJuntas, 7);      // round(20*0.35,1)
  assert.equal(r.masilla, 6);          // round(20*0.3,1)
});

test("calcularParedDurlock: 1 sola cara da la mitad de areaTotal que 2 caras", () => {
  const unaCara = calcularParedDurlock({ largo:4, alto:2.5, caras:1, modulacion:0.6, desperdicio:0 });
  assert.equal(unaCara.areaTotal, 10);
  assert.equal(unaCara.placas, 4); // ceil(10/2.88)
});

test("calcularParedDurlock: lana de vidrio solo si conAislacion es true", () => {
  const sinAislacion = calcularParedDurlock({ largo:4, alto:2.5, caras:1, desperdicio:0 });
  const conAislacion = calcularParedDurlock({ largo:4, alto:2.5, caras:1, desperdicio:0, conAislacion:true });
  assert.equal(sinAislacion.lanaVidrio, 0);
  assert.equal(conAislacion.lanaVidrio, 10);
});

test("calcularCielorraso: junta tomada 4x5m -- placas, perfiles reales y fijacion", () => {
  const r = calcularCielorraso({ modo:"junta", ancho:4, largo:5 });
  assert.equal(r.area, 20);
  assert.equal(r.perimetro, 18);
  assert.equal(r.placas, 7); // ceil(20/2.88)
  assert.equal(r.perfiles.perimetral, 18);
  assert.equal(r.perfiles.primario, 20);   // ceil(4/1.2)*5
  assert.equal(r.perfiles.secundario, 40); // ceil(5/0.5)*4
  assert.equal(r.perfiles.varillas, 17);   // ceil(20/1.2)
  assert.equal(r.accesorios.tornillosTN, 540);
  assert.equal(r.fijacion.tarugos, 52);    // ceil(18/0.35)
  assert.equal(r.fijacion.alambreMetros, 17);
  assert.equal(r.tieneTerminado, true);
});

test("calcularCielorraso: modular 60x60 no tiene terminado (tornillos TN/cinta/masilla)", () => {
  const r = calcularCielorraso({ modo:"modular", ancho:4, largo:5 });
  assert.equal(r.placas, 56); // ceil(20/0.36)
  assert.equal(r.placasLabel, "paneles 60x60");
  assert.equal(r.perfiles.secundario, 33); // round(20/0.6)
  assert.equal(r.tieneTerminado, false);
  assert.deepEqual(r.accesorios, {});
});

test("calcularCielorraso: suspendido 60x120 espacia el secundario cada 1.2m (mitad que modular)", () => {
  const r = calcularCielorraso({ modo:"suspendido", ancho:4, largo:5 });
  assert.equal(r.placas, 28); // ceil(20/0.72)
  assert.equal(r.placasLabel, "paneles 60x120");
  assert.equal(r.perfiles.secundario, 17); // round(20/1.2), no 33 como en modular
  assert.equal(r.tieneTerminado, false);
});
