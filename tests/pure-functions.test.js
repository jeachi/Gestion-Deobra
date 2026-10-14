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
const { calcularTecho } = cargarDesdeApp([{ nombre: "calcularTecho" }]);
const { calcularMallaElectrosoldada } = cargarDesdeApp([{ nombre: "calcularMallaElectrosoldada" }]);
const { calcularLosaViguetas } = cargarDesdeApp([{ nombre: "calcularLosaViguetas" }]);
const { convertirAEnvases, calcularPintura } = cargarDesdeApp([{ nombre: "convertirAEnvases" }, { nombre: "calcularPintura" }]);
const { calcularMembranaLiquida } = cargarDesdeApp([{ nombre: "convertirAEnvases" }, { nombre: "calcularMembranaLiquida" }]);
const { calcularMembranaRollos } = cargarDesdeApp([{ nombre: "calcularMembranaRollos" }]);
const { calcularContrapiso } = cargarDesdeApp([{ nombre: "calcularContrapiso" }]);
const { calcularPisoCeramico } = cargarDesdeApp([{ nombre: "calcularPisoCeramico" }]);
const { calcularRevoque } = cargarDesdeApp([{ nombre: "calcularRevoque" }]);
const { calcularAislacionTermica } = cargarDesdeApp([{ nombre: "calcularAislacionTermica" }]);

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

test("calcularTecho: chapas acanalada 5m de ancho, 6m de agua, chapa de 6m, 10% de solape", () => {
  const r = calcularTecho({ ancho:5, largoAgua:6, anchoUtil:0.91, largoChapa:6, solape:10, tornillosPorChapa:13, desperdicio:0 });
  assert.equal(r.chapasAncho, 7);  // ceil(5/0.91*1.1) = ceil(6.044)
  assert.equal(r.hileras, 1);      // ceil(6/6)
  assert.equal(r.totalChapas, 7);
  assert.equal(r.tornillos, 91);   // 7*13
});

test("calcularTecho: una agua mas larga que la chapa pide varias hileras", () => {
  const r = calcularTecho({ ancho:5, largoAgua:13, anchoUtil:0.91, largoChapa:6, solape:0, tornillosPorChapa:13, desperdicio:0 });
  assert.equal(r.hileras, 3); // ceil(13/6)
});

test("calcularMallaElectrosoldada: panel estandar 2.15x5.00 (10.75 m2), con 10% de solape", () => {
  const r = calcularMallaElectrosoldada({ ancho:10, largo:5, solape:10, m2PorPanel:10.75 });
  assert.equal(r.area, 50);
  assert.equal(r.paneles, 6); // ceil(50*1.1/10.75) = ceil(5.116)
});

test("calcularLosaViguetas: h=16cm, separacion 50cm, 4x5m", () => {
  const r = calcularLosaViguetas({ modo:"ceramico", altura:"16", ancho:4, largo:5 });
  assert.equal(r.area, 20);
  assert.equal(r.viguetasCant, 9);      // ceil(4/0.5)+1
  assert.equal(r.viguetasMetros, 45);   // 9*5
  assert.equal(r.ladrillos, 140);       // 20*7 piezas/m2
  assert.equal(r.malla, 2);             // ceil(20/10.75)
  assert.equal(r.cemento, 7);           // ceil(1.0*7)
  assert.equal(r.arena, 0.5);
  assert.equal(r.piedra, 0.5);
});

test("calcularLosaViguetas: a menor altura, menos separacion entre viguetas y mas viguetas", () => {
  const h12 = calcularLosaViguetas({ modo:"telgopor", altura:"12", ancho:4, largo:5 });
  assert.equal(h12.separacion, 42);
  assert.equal(h12.viguetasCant, 11); // ceil(4/0.42)+1
});

test("convertirAEnvases: reparte de mayor a menor y redondea hacia arriba en el ultimo tamaño", () => {
  assert.deepEqual(convertirAEnvases(6, [20,10,4,1]), { 20:0, 10:0, 4:1, 1:2 });
  assert.deepEqual(convertirAEnvases(0, [20,10,4,1]), { 20:0, 10:0, 4:0, 1:0 });
});

test("calcularPintura: 10x3m, 2 manos, rendimiento 10 m2/L, con fijador", () => {
  const r = calcularPintura({ ancho:10, largo:3, manos:2, rendimiento:10, conFijador:true });
  assert.equal(r.area, 30);
  assert.equal(r.litros, 6); // 30*2/10
  assert.deepEqual(r.latas, { 20:0, 10:0, 4:1, 1:2 });
  assert.equal(r.fijadorLitros, 4.29); // 30/7
});

test("calcularPintura: sin fijador da 0 litros de fijador", () => {
  const r = calcularPintura({ ancho:10, largo:3, manos:2, rendimiento:10, conFijador:false });
  assert.equal(r.fijadorLitros, 0);
});

test("calcularMembranaLiquida: 10x3m, 2 manos, con imprimacion", () => {
  const r = calcularMembranaLiquida({ ancho:10, largo:3, manos:2, kgPorM2PorMano:1.35, conImprimacion:true });
  assert.equal(r.area, 30);
  assert.equal(r.kg, 81); // 30*1.35*2
  assert.deepEqual(r.baldes, { 25:3, 20:0, 10:0, 5:2 });
  assert.equal(r.imprimacionLitros, 6.67); // 30/4.5
});

test("calcularMembranaRollos: 5x12m, rollo 1m util x 10m, 10% de solape, con imprimacion", () => {
  const r = calcularMembranaRollos({ ancho:5, largo:12, anchoUtilRollo:1, largoRollo:10, solape:10, conImprimacion:true });
  assert.equal(r.rollosAncho, 6); // ceil(5/1*1.1) = ceil(5.5)
  assert.equal(r.rollosLargo, 2); // ceil(12/10)
  assert.equal(r.totalRollos, 12);
  assert.equal(r.imprimacionLitros, 13.33); // (5*12)/4.5
});

test("calcularContrapiso: 5x4m, espesor 8cm", () => {
  const r = calcularContrapiso({ ancho:5, largo:4, espesor:0.08 });
  assert.equal(r.area, 20);
  assert.equal(r.volumen, 1.6);
  assert.equal(r.cemento, 12); // ceil(1.6*7)
  assert.equal(r.arena, 0.8);
  assert.equal(r.piedra, 0.8);
});

test("calcularPisoCeramico: 5x4m, caja 1.44m2, 10% desperdicio", () => {
  const r = calcularPisoCeramico({ ancho:5, largo:4, m2PorCaja:1.44, desperdicio:10, m2PorBolsaPegamento:4, rendimientoPastina:0.4 });
  assert.equal(r.area, 20);
  assert.equal(r.cajas, 16); // ceil(20/1.44*1.1)
  assert.equal(r.bolsasPegamento, 5); // ceil(20/4)
  assert.equal(r.pastinaKg, 8); // 20*0.4
});

test("calcularRevoque: grueso 5x2.5m usa mas cemento, fino usa mas cal", () => {
  const grueso = calcularRevoque({ ancho:5, alto:2.5, tipo:"grueso" });
  assert.equal(grueso.volumen, 0.19); // round(12.5*0.015, 2)
  assert.equal(grueso.cemento, 1);
  assert.equal(grueso.cal, 1);
  const fino = calcularRevoque({ ancho:5, alto:2.5, tipo:"fino" });
  assert.ok(fino.volumen < grueso.volumen); // espesor mucho menor
  assert.ok(fino.cal >= fino.cemento); // el fino lleva relativamente mas cal
});

test("calcularAislacionTermica: 5x4m, 10% de solape, rollo de 12m2", () => {
  const r = calcularAislacionTermica({ ancho:5, largo:4, solape:10, m2PorRollo:12 });
  assert.equal(r.area, 20);
  assert.equal(r.m2Necesarios, 22); // 20*1.1
  assert.equal(r.rollos, 2); // ceil(22/12)
});
