// Cobertura de las funciones nuevas para el Reporte PDF (tabla de etiquetas por código/medida con
// estado, agrupada por categoría con subtotal) y el Monitor de avance (agrupado de pines por tipo
// de ambiente) -- ver tests/extract.js para cómo se sacan del index.html sin tocarlo ni necesitar
// un build. No cubre lo que depende de storage/Firestore (calcularMonitorAvance,
// pinesVinculadosAPlano, sugerirUbicacionPorPinCercano) -- eso está en tests/e2e/.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cargarDesdeApp } = require("./extract");

const {
  medidaUnitariaFila, medidaTotalFila, claveMedidaFila, sufijoMedidaFila,
  estadoMetaActual, agruparMedidasPorCategoriaParaReporte,
} = cargarDesdeApp([
  { nombre: "medidaUnitariaFila" },
  { nombre: "medidaTotalFila" },
  { nombre: "claveMedidaFila" },
  { nombre: "sufijoMedidaFila" },
  { nombre: "estadoMetaActual" },
  { nombre: "agruparMedidasPorCategoriaParaReporte" },
]);

const { colorEstadoPinMaestro, contarPinesMaestroPorEstado, agruparPinesPorTipoAmbiente } = cargarDesdeApp([
  { nombre: "colorEstadoPinMaestro" },
  { nombre: "contarPinesMaestroPorEstado" },
  { nombre: "agruparPinesPorTipoAmbiente" },
]);

test("medidaUnitariaFila/medidaTotalFila: par 'Ancho x Alto' usa el área ya calculada", () => {
  const m = { valor: "2.5x3.5", cantidad: 2, area: 8.75, areaTotal: 17.5 };
  assert.equal(medidaUnitariaFila(m), 8.75);
  assert.equal(medidaTotalFila(m), 17.5);
});

test("medidaUnitariaFila/medidaTotalFila: número suelto (ml) no tiene área pero sí total generalizado", () => {
  const m = { valor: "8", cantidad: 4, area: null, areaTotal: null };
  assert.equal(medidaUnitariaFila(m), 8);
  assert.equal(medidaTotalFila(m), 32);
});

test("medidaUnitariaFila: texto no numérico devuelve null (no inventa un número)", () => {
  const m = { valor: "a mano", cantidad: 1, area: null, areaTotal: null };
  assert.equal(medidaUnitariaFila(m), null);
  assert.equal(medidaTotalFila(m), null);
});

test("claveMedidaFila/sufijoMedidaFila: distingue área (m²) de lineal (m) aunque comparten unidad", () => {
  const area = { unidad: "m", area: 8.75 };
  const lineal = { unidad: "m", area: null };
  assert.notEqual(claveMedidaFila(area), claveMedidaFila(lineal));
  assert.equal(sufijoMedidaFila(area), " m²");
  assert.equal(sufijoMedidaFila(lineal), " m");
});

test("estadoMetaActual: devuelve el marcado 'completa', sin importar su posición en la lista", () => {
  global.estadosPersonalizados = [
    { id: "pendiente", nombre: "Pendiente", completa: false },
    { id: "marco", nombre: "Marco colocado", completa: true },
    { id: "instalado", nombre: "Instalado", completa: false },
  ];
  assert.equal(estadoMetaActual().id, "marco");
});

test("estadoMetaActual: sin ninguno marcado, cae al ÚLTIMO de la lista (comportamiento de siempre)", () => {
  global.estadosPersonalizados = [
    { id: "pendiente", nombre: "Pendiente" },
    { id: "marco", nombre: "Marco colocado" },
    { id: "instalado", nombre: "Instalado" },
  ];
  assert.equal(estadoMetaActual().id, "instalado");
});

test("agruparMedidasPorCategoriaParaReporte: subtotal por categoría, % contra el estado ★", () => {
  global.estadosPersonalizados = [
    { id: "pendiente", nombre: "Pendiente" },
    { id: "marco", nombre: "Marco colocado" },
    { id: "instalado", nombre: "Instalado", completa: true },
  ];
  const resumen = [
    { codigo: "V1", categoria: "Ventana", valor: "2x2", unidad: "m", cantidad: 1, estados: { instalado: 1 }, area: 4, areaTotal: 4, esPar: true },
    { codigo: "V2", categoria: "Ventana", valor: "1x1", unidad: "m", cantidad: 1, estados: { pendiente: 1 }, area: 1, areaTotal: 1, esPar: true },
    { codigo: "P1", categoria: "Puerta", valor: "1x2", unidad: "m", cantidad: 1, estados: { instalado: 1 }, area: 2, areaTotal: 2, esPar: true },
  ];
  const r = agruparMedidasPorCategoriaParaReporte(resumen);
  assert.equal(r.categorias.length, 2);
  const ventana = r.categorias.find(c => c.nombre === "Ventana");
  assert.equal(ventana.cantidad, 2);
  assert.equal(ventana.estados.instalado, 1);
  assert.equal(ventana.estados.pendiente, 1);
  assert.equal(ventana.pct, 50); // 1 de 2 instalada
  assert.ok(ventana.medida, "Ventana tiene una sola clase de medida (m², área) -- no debería quedar en null");
  assert.equal(Math.round(ventana.medida.total * 100) / 100, 5); // 4 + 1
  assert.equal(Math.round(ventana.medida.meta * 100) / 100, 4); // solo la instalada (V1)
  const puerta = r.categorias.find(c => c.nombre === "Puerta");
  assert.equal(puerta.pct, 100);
  assert.equal(r.totalCantidad, 3);
  assert.equal(r.pctTotal, 67); // 2 de 3 instaladas, redondeado
});

test("agruparMedidasPorCategoriaParaReporte: categoría que mezcla m² y ml no suma, se marca 'mezcla'", () => {
  global.estadosPersonalizados = [{ id: "instalado", nombre: "Instalado", completa: true }];
  const resumen = [
    { codigo: "R1", categoria: "Reja", valor: "2x3", unidad: "m", cantidad: 1, estados: { instalado: 1 }, area: 6, areaTotal: 6, esPar: true },
    { codigo: "R2", categoria: "Reja", valor: "8", unidad: "m", cantidad: 1, estados: { instalado: 1 }, area: null, areaTotal: null, esPar: false },
  ];
  const r = agruparMedidasPorCategoriaParaReporte(resumen);
  const reja = r.categorias.find(c => c.nombre === "Reja");
  assert.equal(reja.mezclaMedida, true);
  assert.equal(reja.medida, null);
});

test("agruparMedidasPorCategoriaParaReporte: sin estado ★ marcado, el % es 0 en vez de romper", () => {
  global.estadosPersonalizados = [];
  const resumen = [
    { codigo: "V1", categoria: "Ventana", valor: "2x2", unidad: "m", cantidad: 1, estados: { instalado: 1 }, area: 4, areaTotal: 4, esPar: true },
  ];
  const r = agruparMedidasPorCategoriaParaReporte(resumen);
  assert.equal(r.categorias[0].pct, 0);
  assert.equal(r.pctTotal, 0);
});

test("contarPinesMaestroPorEstado/colorEstadoPinMaestro: urgente pesa más que pendiente simple", () => {
  const pinUrgente = { checklist: [{ texto: "a", hecho: false, urgente: true }] };
  const pinPendiente = { checklist: [{ texto: "b", hecho: false, urgente: false }] };
  const pinAlDia = { checklist: [{ texto: "c", hecho: true, urgente: false }] };
  assert.equal(colorEstadoPinMaestro(pinUrgente), "#DC5B4A");
  assert.equal(colorEstadoPinMaestro(pinPendiente), "#E9A23B");
  assert.equal(colorEstadoPinMaestro(pinAlDia), "#0E9488");
  const c = contarPinesMaestroPorEstado([pinUrgente, pinPendiente, pinAlDia]);
  assert.deepEqual(c, { urgentes: 1, pendientes: 1, alDia: 1 });
});

test("agruparPinesPorTipoAmbiente: agrupa por tipo, promedia % de checklist entre los del mismo tipo", () => {
  const pines = [
    { tipoAmbiente: "Aula", checklist: [{ hecho: true }, { hecho: false }] }, // 50%
    { tipoAmbiente: "Aula", checklist: [{ hecho: true }, { hecho: true }] }, // 100%
    { tipoAmbiente: "Baño", checklist: [{ hecho: false, urgente: true }] }, // 0%, urgente
  ];
  const r = agruparPinesPorTipoAmbiente(pines);
  assert.equal(r.totalPines, 3);
  const aula = r.grupos.find(g => g.nombre === "Aula");
  assert.equal(aula.pines, 2);
  assert.equal(aula.pct, 75); // promedio de 50% y 100%
  const bano = r.grupos.find(g => g.nombre === "Baño");
  assert.equal(bano.urgentes, 1);
  assert.equal(bano.pct, 0);
});

test("agruparPinesPorTipoAmbiente: un pin sin checklist no ensucia el promedio del grupo", () => {
  const pines = [
    { tipoAmbiente: "Cocina", checklist: [{ hecho: true }] }, // 100%
    { tipoAmbiente: "Cocina", checklist: [] }, // sin checklist -- no cuenta para el promedio
  ];
  const r = agruparPinesPorTipoAmbiente(pines);
  const cocina = r.grupos.find(g => g.nombre === "Cocina");
  assert.equal(cocina.pines, 2);
  assert.equal(cocina.pct, 100); // el promedio ignora al que no tiene checklist, no lo cuenta como 0%
});

test("agruparPinesPorTipoAmbiente: sin ningún pin con checklist, el % total queda null (no 0% falso)", () => {
  const pines = [{ tipoAmbiente: "Aula", checklist: [] }];
  const r = agruparPinesPorTipoAmbiente(pines);
  assert.equal(r.pctTotal, null);
  assert.equal(r.grupos[0].pct, null);
});
