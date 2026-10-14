# Calculadora de Materiales — diseño

## Contexto y objetivo

El usuario pidió un módulo nuevo para calcular cantidades de materiales de
obra civil (mampostería en varios formatos, cielorraso, techo, malla
electrosoldada, pintura, membranas) que genere un reporte de materiales
necesarios, con unidades y presentación comercial reales de Argentina
(bolsas, chapas, rollos, latas — **cantidades, no precios**). Dio libertad
para proponer un concepto visual innovador y sumar rubros adicionales.

Tras dos rondas de ida y vuelta, el usuario aprobó explícitamente:
- El concepto: grilla de tarjetas con ícono por rubro → tocar abre un
  formulario → resultado en presentación comercial → "+ Agregar al
  cómputo" → reporte PDF final con todo lo acumulado.
- La lista completa de rubros (ver abajo), incluyendo variantes de
  cielorraso (junta tomada y modular 60x60) y pared de Durlock como rubro
  aparte de cielorraso.
- Que la implementación se entregue en varias PRs chicas (no una sola),
  igual que se hizo con el editor de Plano de avance.

En una tercera ronda, el usuario pidió además: que CADA rubro liste el
set COMPLETO de materiales para ejecutar esa actividad (no solo el
material principal), que Mampostería indique para qué tipo de pared se
usa cada ladrillo, y que se agregue un rubro nuevo de losa de viguetas
(con ladrillo cerámico tipo "Retak" y con ladrillo de telgopor/EPS).

## Alcance: los 13 rubros

Cada rubro es una "tarjeta" en la grilla de inicio del módulo. Algunos
tienen más de un "modo" (ej. Mampostería elige entre 4 tipos de unidad).

1. **Mampostería** — modos: Bloque de hormigón / Ladrillo común /
   Ladrillo hueco (8, 12, 18 y 20/D.M.20) / Ladrillo portante (12, 18 y
   20). Cada modo indica para qué tipo de pared se usa (ver fórmulas).
2. **Pared de Durlock** (tabique de placas de yeso sobre estructura
   metálica vertical).
3. **Cielorraso** — modos: Junta tomada (placas de yeso suspendidas) /
   Modular 60x60 (paneles de fibra mineral + perfilería T vista).
4. **Techo** (chapas + tornillos autoperforantes).
5. **Malla electrosoldada**.
6. **Pintura**.
7. **Membrana líquida**.
8. **Membrana en rollos**.
9. **Contrapiso / Hormigón** (dosificación básica).
10. **Piso cerámico / porcelanato**.
11. **Revoque** (grueso y fino).
12. **Aislación térmica** (lana de vidrio / poliestireno expandido).
13. **Losa de viguetas y ladrillos** — modos: Ladrillo cerámico (tipo
    "Retak" u otras marcas equivalentes) / Ladrillo de telgopor (EPS,
    más liviano).

## Concepto de UX

### Pantalla de inicio del módulo
Grilla de tarjetas (`.tool-card`-like, consistente con el resto de la
app), cada una con: ícono Phosphor representativo, nombre del rubro, y una
mini-descripción. Tocar una tarjeta abre su formulario específico como
overlay (mismo patrón visual que `abrirPromptGenerico`/los overlays de
ajustes ya usados en Plano).

### Formulario por rubro
Cada formulario pide SOLO los datos que ese cálculo necesita:
- Medidas (largo/alto/m² directo, con opción de restar aberturas en los
  rubros de paredes).
- Selector de formato/tipo (chips, igual que categoría en Plano) cuando
  el rubro tiene variantes (ej. formato de bloque, tipo de chapa).
- Parámetros editables con un valor por defecto razonable (rendimiento
  piezas/m², % de desperdicio, cantidad de manos de pintura) — el usuario
  puede ajustarlos si su proveedor rinde distinto, en vez de un número
  fijo sin posibilidad de corregir.
- Botón "Calcular" → muestra el resultado en presentación comercial
  (ver tabla de fórmulas abajo) + botón "➕ Agregar al cómputo".

### "Mi cómputo" (acumulador)
Lista persistente por obra (como `plano_avance_*`, clave tipo
`calc_materiales_<obra>`) de todos los ítems agregados: rubro, parámetros
usados, resultado. Se puede:
- Ver el listado completo con un total por rubro.
- Editar/eliminar un ítem (reabre el formulario con esos datos).
- Vaciar todo.
- Generar el reporte PDF (reusa el motor jsPDF/html2canvas ya usado por
  los demás reportes de la app — mismo patrón que
  `generarReportePlanoAvancePDF`/`mostrarModalPDF`).

El reporte PDF lista, por rubro: parámetros de entrada (ej. "Pared de
8m x 2.5m, bloque 20x20x40") y el resultado en unidades comerciales (ej.
"50 bloques + 3 bolsas de cemento + 0.5 m³ de arena"). Sin precios ni
totales en dinero.

## Fórmulas y valores por defecto (editables por el usuario)

Todos los rendimientos son valores de referencia estándar de la industria
argentina; se muestran como default pero el campo queda editable, porque
varían según marca/proveedor.

**1. Mampostería** — 4 tipos (antes "hueco" y "portante" estaban mezclados
en uno solo; se separan porque son familias de producto distintas, cada
una con su propia gama de anchos)
- Área neta = (largo × alto) − aberturas (opcional).
- Piezas = ceil(área neta × piezas/m² del formato elegido × (1 + %
  desperdicio)). El rendimiento piezas/m² depende de la CARA del ladrillo
  (alto × largo), no de su espesor/ancho -- por eso, dentro de "Ladrillo
  hueco" y "Ladrillo portante", todos los anchos comparten casi el mismo
  rendimiento; lo que cambia con el ancho es el volumen de mezcla, no la
  cantidad de piezas.
- Tipos y formatos con su rendimiento default (piezas/m²) Y para qué
  tipo de pared se usa cada uno (texto informativo en el formulario, no
  una restricción -- el usuario sigue pudiendo elegir cualquiera):
  - **Bloque de hormigón** — uso típico: muros portantes, cercos y
    medianeras. 20x20x40 → 12.5 · 20x20x20 → 25 · 12x20x40 → 12.5
  - **Ladrillo común** — uso típico: tabiques y parapetos (de canto,
    pared simple 12cm) o muros portantes/revestimientos (de plano,
    pared doble 25cm). 6x12x24 de canto → ~72 · 6x12x24 de plano → ~144
  - **Ladrillo hueco** (no portante, cara 18x33cm aprox. en todos los
    anchos) — uso típico: tabiques divisorios NO portantes, el ancho
    elegido define el espesor final de la pared. Hueco 8 (8x18x33) →
    ~16 · Hueco 12 (12x18x33) → ~16 · Hueco 18 (18x18x33) → ~16 ·
    Hueco 20 / D.M. 20 (20x18x33) → ~16
  - **Ladrillo portante** (cerámico armado, cara ~19x33cm) — uso
    típico: muros portantes de carga en obra nueva (reemplaza al
    ladrillo común de plano, con menos peso y mejor aislación). Portante
    12 (12x19x33) → ~16 · Portante 18 (18x19x33) → ~16 · Portante 20
    (20x19x33) → ~16
- Mezcla de asiento: cemento, arena y cal (dosificación de referencia
  ~1:1:6, editable) estimados por cada 100 piezas -- default editable, y
  el volumen escala con el ESPESOR/ancho elegido dentro de
  "hueco"/"portante" (más ancho = más mezcla, aunque la cantidad de
  piezas sea la misma).
- Salida: "N piezas de <formato>" + "N bolsas de cemento" + "N m³/bolsas
  de arena" + "N bolsas de cal".

**2. Pared de Durlock** — perfilería desglosada en sus 2 piezas reales
(antes "perfiles" era un solo número; se separan porque son dos
productos distintos que se compran por separado)
- Área neta = largo × alto − aberturas.
- Placas = ceil(área neta × caras (1 o 2) / 2.88 m² por placa × (1 + %
  desperdicio)).
- **Solera** (riel horizontal, arriba y abajo del tabique): metros
  lineales = 2 × largo del tabique.
- **Montante** (parante vertical, dentro de las soleras): cantidad =
  ceil(largo / modulación (0.40 o 0.60m, editable)) + 1; cada uno mide
  "alto" metros → metros lineales totales = cantidad × alto.
- Tornillos: cantidad por m² (default ~25-30 TN/m² por placa).
- Cinta de juntas (metros ≈ área × 0.35 m/m², editable) + masilla (kg ≈
  área × 0.3 kg/m², editable) -- se habían omitido, son parte necesaria
  del terminado de cualquier placa de yeso.
- Lana de vidrio (si "con aislación" = sí): m² = área neta.
- Salida: "N placas" + "N metros de solera" + "N montantes (= N metros)"
  + "N tornillos (caja de 250/500)" + "N m de cinta" + "N kg de masilla"
  + "N m² de lana" (si aplica).

**3. Cielorraso** — perfilería desglosada por tipo real de perfil
(distinta de la pared: un cielorraso NO usa solera/montante, que son
piezas de tabique vertical; usa perfilería de suspensión propia)
- *Junta tomada* (placas de yeso suspendidas, sistema continuo):
  - Placas = área / 2.88 (igual que pared).
  - **Perfil perimetral** (moldura angular fijada a la pared, en todo el
    borde del cielorraso): metros = perímetro del ambiente.
  - **Perfil primario / maestra** (corre de pared a pared, es de donde
    cuelgan las varillas): metros ≈ (ancho del ambiente / 1.20m,
    redondeado arriba) × largo del ambiente -- espaciamiento editable.
  - **Perfil secundario / transversal** (perpendicular al primario, es
    donde se atornillan las placas, cada 0.40-0.60m): metros ≈ (largo
    del ambiente / espaciamiento, redondeado arriba) × ancho del
    ambiente -- espaciamiento editable.
  - **Varillas de suspensión + nonio** (cuelgan el primario de la
    losa/techo de arriba): cantidad ≈ área / 1.2 m² (un punto de
    suspensión cada ~1.2 m², editable).
  - Tornillos TN (~25-30/m²) + cinta de juntas (metros ≈ área × 0.35
    m/m², editable) + masilla (kg ≈ área × 0.3 kg/m², editable).
- *Modular 60x60* (paneles de fibra mineral sobre perfilería T vista):
  - Paneles = ceil(área / 0.36 m² × (1 + % desperdicio)).
  - **Perfil T principal** (corre cada 1.20m, sostiene los T
    secundarios): metros ≈ área / 1.20 m², editable.
  - **Perfil T secundario / transversal** (cruza al principal cada
    0.60m, cierra la grilla de 60x60): metros ≈ área / 0.60 m²,
    editable.
  - **Perfil perimetral** (moldura en L en todo el borde, apoya el
    panel contra la pared): metros = perímetro.
  - **Varillas de suspensión**: cantidad ≈ área / 1.2 m², editable.
- Salida: según modo, "N placas/paneles" + una línea POR CADA tipo de
  perfil (perimetral, primario/maestra, secundario/transversal) en
  metros + "N varillas de suspensión" + accesorios (tornillos/cinta/
  masilla, solo en junta tomada).

**4. Techo**
- Ancho útil por formato de chapa (ej. acanalada ~0.91m, trapezoidal
  ~1.00-1.10m, sinusoidal ~0.91m) — editable.
- Chapas por hilera = ceil(ancho total del techo / ancho útil ×
  (1+solape%)).
- Hileras = ceil(largo de agua / largo de chapa elegido).
- Tornillos autoperforantes = chapas × cantidad por chapa (default
  editable, ej. ~12-14 por chapa estándar).
- Salida: "N chapas de <formato> x <largo>m" + "N tornillos (caja de
  100/250)".

**5. Malla electrosoldada**
- Formato (Q-92/Q-138/Q-188/R-84, etc.) con tamaño de panel estándar
  (ej. 2.15m × 5.00m = 10.75 m², editable).
- Paneles = ceil(área a cubrir × (1+% de solape) / m² por panel).
- Salida: "N paneles de malla <formato>".

**6. Pintura**
- Litros = (área a pintar × manos) / rendimiento m²/L del tipo elegido
  (interior látex ~10-12, exterior ~8-10, esmalte sintético ~8-10,
  editable).
- Conversión a latas: combinación de latas de 20L/10L/4L/1L que cubra el
  total (minimizando sobrante, o redondeando a la lata más próxima hacia
  arriba — a definir en el plan de implementación).
- Fijador/sellador (si la superficie es nueva/porosa, opcional): litros
  = área / rendimiento m²/L del fijador (default ~6-8, editable).
- Salida: "N litros totales" → "N latas de 20L + N de 4L + N de 1L" +
  "N litros de fijador" (si aplica).

**7. Membrana líquida**
- kg = área × kg/m² por mano (default ~1.2-1.5) × número de manos.
- Conversión a baldes: combinación de baldes de 25/20/10/5 kg.
- Imprimación asfáltica (previa, casi siempre necesaria): litros = área
  / rendimiento m²/L (default ~4-5, editable).
- Salida: "N kg totales" → "N baldes de Xkg" + "N litros de imprimación".

**8. Membrana en rollos**
- Ancho útil del rollo (default 1.00m o 1.05m, editable) y largo
  (default 10m, editable).
- Rollos = ceil(ancho total a cubrir / ancho útil × (1+% solape)) ×
  ceil(largo a cubrir / largo del rollo).
- Imprimación asfáltica (previa, casi siempre necesaria): igual que en
  membrana líquida.
- Salida: "N rollos de <ancho>m x <largo>m" + "N litros de imprimación".

**9. Contrapiso / Hormigón**
- Volumen = área × espesor (m).
- Dosificación default (editable) por m³: bolsas de cemento, m³ de arena,
  m³ de piedra (si es hormigón armado) — valores de referencia según
  dosificación 1:3:3 o similar.
- Salida: "N m³" + "N bolsas de cemento" + "N m³ de arena" (+ piedra si
  aplica).

**10. Piso cerámico/porcelanato**
- Área neta (área − desperdicio ya incluido en cajas).
- Cajas = ceil(área / m² por caja del formato elegido × (1+%
  desperdicio)).
- Pegamento: bolsas = ceil(área / rendimiento m²/bolsa, default ~4-5
  m²/bolsa).
- Pastina (para las juntas, se había omitido): bolsas = ceil(área /
  rendimiento m²/bolsa del tamaño de junta elegido, default ~15-20
  m²/kg, editable).
- Salida: "N cajas de <formato>" + "N bolsas de pegamento" + "N kg de
  pastina".

**11. Revoque**
- Volumen aprox = área × espesor (grueso ~1.5cm, fino ~0.3cm, editable).
- Bolsas de cemento, cal y m³ de arena según dosificación default
  editable (grueso ~1:1:6, fino con más cal, sin piedra en ningún caso).
- Salida: "N bolsas de cemento" + "N bolsas de cal" + "N m³ de arena"
  (separado grueso/fino si se pide ambos).

**12. Aislación térmica**
- m² = área a cubrir (con % de solape si corresplace).
- Rollos/planchas según formato elegido (lana de vidrio en rollo, o
  placas de EPS por m²/placa).
- Salida: "N rollos/placas de <formato>".

**13. Losa de viguetas y ladrillos** — nuevo, dos modos: ladrillo
cerámico (tipo "Retak" u otras marcas equivalentes de ladrillo cerámico
para losa) y ladrillo de telgopor/EPS (más liviano, mismo sistema
estructural).
- Altura de la losa / ladrillo elegido (cada altura trae una separación
  de viguetas típica asociada, editable): 12cm → separación ~42cm ·
  13cm → ~50cm · 16cm → ~50cm · 19cm → ~60cm · 23cm → ~60cm.
- **Viguetas** (pretensadas): cantidad = ceil(ancho a cubrir /
  separación elegida) + 1; cada una mide "largo"(luz a cubrir) metros →
  metros lineales totales = cantidad × largo.
- **Ladrillos** (cerámicos o de EPS, según el modo): cantidad ≈ área ×
  piezas/m² según la altura elegida (default editable, ej. h12 → ~9/m²
  · h13 → ~8/m² · h16 → ~7/m² · h19 → ~6/m² · h23 → ~5/m²).
- **Malla superior** (electrosoldada, sobre los ladrillos antes de la
  capa de compresión): área = área de la losa.
- **Capa de compresión** (hormigón, espesor default ~5cm): volumen =
  área × espesor → bolsas de cemento + m³ de arena + m³ de piedra (misma
  dosificación que Contrapiso/Hormigón).
- Salida: "N viguetas de <largo>m" + "N ladrillos <cerámicos/EPS> h<alto>"
  + "N paneles de malla" + "N bolsas de cemento" + "N m³ de arena" +
  "N m³ de piedra".

## Modelo de datos

- Catálogo de formatos/rendimientos por rubro: constantes en el código
  (`CATALOGO_MATERIALES`), igual de editable que otros catálogos de la
  app, pero NO se persiste por obra (son valores de referencia globales,
  el usuario los ajusta por cálculo, no de forma permanente — a menos que
  en una fase futura se pida "recordar mi último valor usado", que no es
  parte de este alcance).
- Cómputo acumulado por obra: `calc_materiales_<obra>` → array de ítems
  `{id, rubro, modo, parametros:{...}, resultado:{...}, fecha}`.
- Reporte PDF: generado a demanda desde el cómputo acumulado, sin
  persistirse (como los demás reportes de la app).

## Navegación / integración

- Nuevo módulo en la navegación principal (mismo nivel que Pedidos,
  Herramientas, etc.), ícono 🧮.
- Sin permisos especiales por rol en esta fase (cualquier usuario logueado
  puede calcular) — a confirmar si hace falta restringir en el plan de
  implementación.
- Integración futura (NO en esta entrega): enviar el cómputo acumulado
  directo como ítems de un "Pedido de materiales nuevo".

## Plan de entrega (varias PRs)

Dado el tamaño (13 rubros), la implementación se parte en PRs chicas,
cada una con sus propios tests e2e, siguiendo el mismo patrón usado para
el editor de Plano de avance:

1. **PR 1 — Módulo base**: navegación nueva, pantalla de grilla, patrón
   de formulario/resultado genérico, "Mi cómputo" (acumular/editar/
   borrar), reporte PDF vacío/con un rubro de prueba. Primer rubro real:
   Mampostería (los 4 modos).
2. **PR 2**: Pared de Durlock + Cielorraso (los 2 modos).
3. **PR 3**: Techo + Malla electrosoldada + Losa de viguetas y ladrillos
   (los 2 modos) -- se agrupan porque Losa reutiliza directamente la
   malla y el cálculo de hormigón de las otras dos.
4. **PR 4**: Pintura + Membrana líquida + Membrana en rollos.
5. **PR 5**: Contrapiso/Hormigón + Piso cerámico + Revoque + Aislación
   térmica.

Cada PR agrega sus rubros a la grilla de inicio y a la lógica de
cálculo/reporte, sin tocar los rubros ya entregados en PRs anteriores.
