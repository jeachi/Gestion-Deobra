// Cobertura de las funciones de cálculo puro del motor de Plano de avance (áreas y % de avance).
// Es la parte más grande y con más estado de toda la app (~9.400 líneas, sin ningún test hasta
// ahora) -- estas dos funciones en particular son las que terminan convirtiéndose en plata real:
// el % que sale de acá es el mismo que se factura en un Certificado (ver Certificados <-> Plano
// de avance). Ver tests/extract.js para cómo se sacan del index.html sin tocarlo ni necesitar un
// build.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargarDesdeApp } = require("./extract");

const { areaPoligono, calcularPorcentajesDeLista } = cargarDesdeApp([
  { nombre: "areaPoligono" },
  { nombre: "calcularPorcentajesDeLista" },
]);

test("areaPoligono: cuadrado unitario da área 1", () => {
  assert.equal(areaPoligono([[0,0],[1,0],[1,1],[0,1]]), 1);
});

test("areaPoligono: triángulo rectángulo 4x3 da área 6", () => {
  assert.equal(areaPoligono([[0,0],[4,0],[0,3]]), 6);
});

test("areaPoligono: el orden de los vértices (horario o antihorario) no cambia el área", () => {
  const sentidoHorario = areaPoligono([[0,0],[0,1],[1,1],[1,0]]);
  const sentidoAntihorario = areaPoligono([[0,0],[1,0],[1,1],[0,1]]);
  assert.equal(sentidoHorario, sentidoAntihorario);
});

test("areaPoligono: menos de 3 puntos (una línea) da área 0", () => {
  assert.equal(areaPoligono([[0,0],[5,5]]), 0);
  assert.equal(areaPoligono([[0,0]]), 0);
  assert.equal(areaPoligono([]), 0);
});

test("calcularPorcentajesDeLista: sin polígonos, no hay actividades", () => {
  assert.deepEqual(calcularPorcentajesDeLista([]), []);
});

test("calcularPorcentajesDeLista: una capa al 50% del área total de su actividad", () => {
  // "Durlok" tiene 100 de área total (sin capa) y una capa "Estructura" de 50 -- debería marcar 50%.
  const poligonos = [
    { nombreBase: "Durlok", capa: null, area: 100 },
    { nombreBase: "Durlok", capa: "Estructura", area: 50, capaId: "cap-1" },
  ];
  const r = calcularPorcentajesDeLista(poligonos);
  assert.equal(r.length, 1);
  assert.equal(r[0].capa, "Estructura");
  assert.equal(r[0].pct, 50);
  assert.equal(r[0].capaId, "cap-1");
});

test("calcularPorcentajesDeLista: varias piezas sueltas de la misma capa se suman, no se pisan", () => {
  // Dos rectángulos separados marcados como la misma capa "Estructura" (15 + 5 de 100 = 20%).
  const poligonos = [
    { nombreBase: "Cielorraso", capa: null, area: 100 },
    { nombreBase: "Cielorraso", capa: "Estructura", area: 15 },
    { nombreBase: "Cielorraso", capa: "Estructura", area: 5 },
  ];
  const r = calcularPorcentajesDeLista(poligonos);
  assert.equal(r.length, 1);
  assert.equal(r[0].pct, 20);
});

test("calcularPorcentajesDeLista: el % nunca pasa de 100 aunque el área marcada sea mayor a la total", () => {
  // Puede pasar por redondeo pieza a pieza (cada una se redondea antes de sumar) -- nunca debería
  // mostrarse más de 100%, aunque la suma cruda diera un poco más.
  const poligonos = [
    { nombreBase: "Piso", capa: null, area: 100 },
    { nombreBase: "Piso", capa: "Terminado", area: 60 },
    { nombreBase: "Piso", capa: "Terminado", area: 60 },
  ];
  const r = calcularPorcentajesDeLista(poligonos);
  assert.equal(r[0].pct, 100);
});

test("calcularPorcentajesDeLista: actividades distintas no se mezclan entre sí", () => {
  const poligonos = [
    { nombreBase: "Durlok", capa: null, area: 100 },
    { nombreBase: "Durlok", capa: "Estructura", area: 25 },
    { nombreBase: "Pintura", capa: null, area: 200 },
    { nombreBase: "Pintura", capa: "Primera mano", area: 100 },
  ];
  const r = calcularPorcentajesDeLista(poligonos);
  assert.equal(r.length, 2);
  const durlok = r.find(x=>x.nombreBase==="Durlok");
  const pintura = r.find(x=>x.nombreBase==="Pintura");
  assert.equal(durlok.pct, 25);
  assert.equal(pintura.pct, 50);
});
