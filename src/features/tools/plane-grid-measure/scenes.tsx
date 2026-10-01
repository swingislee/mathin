import type { ReactNode } from "react";
import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { HeightMark } from "../planar-kit/geometry";
import { textFor, type PlanarAction, type PlanarContextActions, type PlanarDrawingApi, type PlanarField, type PlanarMaterial, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { add, latticeCounts, perpendicularFoot, pointInPolygon, polygonPerimeter } from "../plane-geometry/model";
import { polygonArea } from "../planar-interaction/geometry";
import { gridCoverage, gridTriangles, unitSquareUnion } from "./geometry";
import {
  GRID_COLUMNS, GRID_ORIGIN, GRID_ROWS, GRID_SCALE, MAX_GRID_POLYGONS, MAX_UNIT_SQUARES,
  addGridPolygon, addUnitRow, addUnitSquare, constructGridMaterial, createGridMeasureState,
  duplicateGridMaterial, gridBounds, gridMaterial, gridMaterialPoints, gridMaterials, gridObjectTarget, gridPolygons, gridToStage, gridUnits,
  insertGridVertex, interpolateGridSeparation, isGeoboard, moveGridMaterial, parseGridTarget, projectGridPoint, removeGridMaterial, removeGridVertex,
  separateGridPolygon, setGridField, setGridFlag, snapGridMaterial, tapGridMaterial, unitSquares,
  type GridPolygon, type GridSceneId,
} from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const colors = ["var(--leaf)", "var(--moon)", "var(--cheek)", "var(--crater)"];
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const fmt = (value: number) => Number(value.toFixed(4)).toString();
const noMaterial = (state: PlanarState) => !gridMaterial(state);
const noPolygon = (state: PlanarState) => gridMaterial(state)?.kind !== 0;

function Caption({ at, children, size = 15 }: { at: PlanarPoint; children: ReactNode; size?: number }) {
  return <text x={at.x} y={at.y} textAnchor="middle" fontSize={size} fill="var(--ink)" stroke="var(--paper)" strokeWidth="5" paintOrder="stroke" pointerEvents="none">{children}</text>;
}
function Grid({ state }: { state: PlanarState }) {
  if (!state.flags.lattice) return null;
  if (!isGeoboard(state)) return <g data-unit-lattice="40" pointerEvents="none" stroke="var(--line)" strokeWidth="1">
    {Array.from({ length: GRID_COLUMNS + 1 }, (_, x) => <line key={`x${x}`} x1={GRID_ORIGIN.x + x * GRID_SCALE} x2={GRID_ORIGIN.x + x * GRID_SCALE} y1={GRID_ORIGIN.y} y2={GRID_ORIGIN.y + GRID_ROWS * GRID_SCALE} />)}
    {Array.from({ length: GRID_ROWS + 1 }, (_, y) => <line key={`y${y}`} y1={GRID_ORIGIN.y + y * GRID_SCALE} y2={GRID_ORIGIN.y + y * GRID_SCALE} x1={GRID_ORIGIN.x} x2={GRID_ORIGIN.x + GRID_COLUMNS * GRID_SCALE} />)}
  </g>;
  const chosen = gridMaterial(state), polygon = chosen?.kind === 0 ? chosen : gridPolygons(state)[0];
  return <g data-geoboard-lattice="40" pointerEvents="none">{Array.from({ length: (GRID_COLUMNS + 1) * (GRID_ROWS + 1) }, (_, index) => {
    const point = { x: index % (GRID_COLUMNS + 1), y: Math.floor(index / (GRID_COLUMNS + 1)) }, at = gridToStage(point);
    const kind = state.flags.points && polygon ? pointInPolygon(point, polygon.vertices) : "outside";
    return <circle key={index} cx={at.x} cy={at.y} r={kind === "outside" ? 2.3 : 4} fill={kind === "inside" ? "var(--leaf-deep)" : kind === "boundary" ? "var(--rose)" : "var(--muted)"} />;
  })}</g>;
}

function EditHandles({ state, polygon, api, editing }: { state: PlanarState; polygon: GridPolygon; api: PlanarDrawingApi; editing: boolean }) {
  const vertices = polygon.vertices.map(gridToStage);
  return <g data-grid-editing={editing ? polygon.id : undefined}>
    {(editing || state.flags.height || state.flags.boundary) && vertices.map((a, i) => {
      const b = vertices[(i + 1) % vertices.length], target = `edge.${polygon.id}.${i}`;
      return <g key={target} {...api.bind(target, textFor(t(`边 ${i + 1}`, `Side ${i + 1}`), api.locale))} style={{ cursor: "grab" }}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="22" pointerEvents="stroke" />
        {api.selected === target && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--rose)" strokeWidth="4" pointerEvents="none" />}
      </g>;
    })}
    {editing && vertices.map((at, i) => <g key={i} {...api.bind(`vertex.${polygon.id}.${i}`, textFor(t(`编辑顶点 ${i + 1}`, `Edit vertex ${i + 1}`), api.locale))} style={{ cursor: "grab" }}>
      <circle cx={at.x} cy={at.y} r="17" fill="transparent" />
      <rect x={at.x - 5} y={at.y - 5} width="10" height="10" rx="2" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" pointerEvents="none" />
      <Caption at={{ x: at.x + 12, y: at.y - 10 }} size={12}>{i + 1}</Caption>
    </g>)}
  </g>;
}

function PolygonDrawing({ state, polygon, api }: { state: PlanarState; polygon: GridPolygon; api: PlanarDrawingApi }) {
  const selected = parseGridTarget(api.selected), chosen = selected?.id === polygon.id, editing = chosen && api.operation === "edit" && !polygon.split;
  const vertices = polygon.vertices.map(gridToStage), units = gridUnits(state), bounds = gridBounds(vertices);
  const triangles = polygon.split || state.flags.triangles ? gridTriangles(polygon.vertices) : [];
  const counts = isGeoboard(state) && (state.flags.points || state.flags.relation) ? latticeCounts(polygon.vertices) : null;
  const measured = state.flags.measures, captions: string[] = [];
  if (measured) captions.push(`S = ${fmt(polygonArea(polygon.vertices) * units.areaFactor)} ${units.area} · P = ${fmt(polygonPerimeter(polygon.vertices) * units.factor)} ${units.length}`);
  if (counts && state.flags.points && polygon.id === state.params.active) captions.push(api.locale === "en" ? `Interior I = ${counts.inside.length} · boundary B = ${counts.boundary.length}` : `内部 I = ${counts.inside.length} · 边界 B = ${counts.boundary.length}`);
  if (counts && state.flags.relation) captions.push(`S = (I + B/2 − 1)${units.areaFactor === 1 ? "" : " × 0.01"} = ${fmt(counts.pickArea * units.areaFactor)} ${units.area}`);
  const a = polygon.vertices[polygon.base], b = polygon.vertices[(polygon.base + 1) % polygon.vertices.length], apex = polygon.vertices[polygon.apex];
  const altitude = state.flags.height ? perpendicularFoot(apex, a, b) : null;
  return <g data-grid-polygon={polygon.id}>
    <g {...api.bind(`object.${polygon.id}`, textFor(t(`图形 ${polygon.id}`, `Shape ${polygon.id}`), api.locale))} style={{ cursor: "grab" }}>
      <polygon points={coordinates(vertices)} fill={colors[polygon.id % colors.length]} fillOpacity={polygon.split ? 0.07 : 0.22} stroke={state.flags.boundary ? "var(--leaf-deep)" : "var(--ink)"} strokeWidth={state.flags.boundary ? 3.5 : 2} strokeDasharray={polygon.split ? "5 5" : undefined} strokeLinejoin="round" />
      {chosen && <polygon points={coordinates(vertices)} fill="none" stroke="var(--rose)" strokeWidth="1.5" strokeDasharray="5 5" pointerEvents="none" />}
    </g>
    {triangles.map((triangle, i) => {
      const points = triangle.map((point) => gridToStage(add(point, polygon.offsets[i] ?? { x: 0, y: 0 })));
      return polygon.split ? <g key={i} {...api.bind(`part.${polygon.id}.${i}`, textFor(t(`三角片 ${i + 1}`, `Triangle piece ${i + 1}`), api.locale))} style={{ cursor: "grab" }} data-grid-part={`${polygon.id}.${i}`}>
        <polygon points={coordinates(points)} fill={colors[i % colors.length]} fillOpacity="0.55" stroke="var(--ink)" strokeWidth="1.7" />
        {measured && <Caption at={{ x: points.reduce((sum, point) => sum + point.x, 0) / 3, y: points.reduce((sum, point) => sum + point.y, 0) / 3 }} size={13}>{fmt(polygonArea(triangle) * units.areaFactor)} {units.area}</Caption>}
      </g> : <polygon key={i} points={coordinates(points)} fill="none" stroke="var(--muted)" strokeWidth="1.3" strokeDasharray="5 5" pointerEvents="none" />;
    })}
    {chosen && !polygon.split && <EditHandles state={state} polygon={polygon} api={api} editing={editing} />}
    {altitude && altitude.distance > 1e-8 && !polygon.split && <HeightMark vertex={gridToStage(apex)} baseA={gridToStage(a)} baseB={gridToStage(b)} label={measured ? `h = ${fmt(altitude.distance * units.factor)} ${units.length}` : undefined} />}
    {captions.map((caption, i) => <Caption key={i} at={{ x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY + 24 + i * 21 }} size={14}>{caption}</Caption>)}
  </g>;
}

function drawGridMeasure(state: PlanarState, api: PlanarDrawingApi) {
  const units = gridUnits(state), squares = unitSquares(state), polygons = gridPolygons(state);
  const cells = !isGeoboard(state) && (state.flags.coverage || state.flags.measures) ? unitSquareUnion(squares.map((square) => square.at)) : [];
  const unionArea = cells.reduce((area, cell) => area + cell.width * cell.height, 0);
  const legend = state.params.unit === 0
    ? t("40 舞台单位 = 1 u；1 方格 = 1 u²；缩放画面不改变数学尺寸。", "40 stage units = 1 u; one square = 1 u². Display scaling does not change mathematical size.")
    : state.params.unit === 1
      ? t("40 舞台单位 = 1 cm；1 方格 = 1 cm²；图示不是实物比例尺。", "40 stage units = 1 cm; one square = 1 cm². This is a diagram, not a physical ruler.")
      : t("40 舞台单位 = 1 cm = 0.1 dm；1 方格 = 1 cm² = 0.01 dm²。", "40 stage units = 1 cm = 0.1 dm; one square = 1 cm² = 0.01 dm².");
  return <>
    <Grid state={state} />
    {polygons.map((polygon) => <PolygonDrawing key={polygon.id} state={state} polygon={polygon} api={api} />)}
    {squares.map((square) => {
      const at = gridToStage(square.at), selected = parseGridTarget(api.selected)?.id === square.id;
      return <g key={square.id} {...api.bind(`tile.${square.id}`, textFor(t(`单位方格 ${square.id}`, `Unit square ${square.id}`), api.locale))} style={{ cursor: "grab" }} data-unit-square={square.id}>
        <rect x={at.x} y={at.y} width={GRID_SCALE} height={GRID_SCALE} fill={colors[square.id % colors.length]} fillOpacity="0.65" stroke={selected ? "var(--rose)" : "var(--ink)"} strokeWidth={selected ? 2.5 : 1.5} />
        {state.flags.units && <Caption at={{ x: at.x + GRID_SCALE / 2, y: at.y + GRID_SCALE / 2 + 5 }} size={11}>{fmt(units.areaFactor)} {units.area}</Caption>}
      </g>;
    })}
    {!isGeoboard(state) && (state.flags.coverage || state.flags.measures) && polygons.map((polygon) => {
      const coverage = gridCoverage(polygon.vertices, cells), bounds = gridBounds(polygon.vertices.map(gridToStage));
      const path = coverage.pieces.map((piece) => `M${piece.map(gridToStage).map((point) => `${point.x},${point.y}`).join("L")}Z`).join("");
      return <g key={polygon.id} pointerEvents="none" data-unit-coverage={polygon.id}>
        {state.flags.coverage && <path d={path} fill="var(--leaf-deep)" fillOpacity="0.23" />}
        {state.flags.measures && <Caption at={{ x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY + 47 }} size={13}>
          {api.locale === "en" ? "Covered" : "已覆盖"} {fmt(coverage.covered * units.areaFactor)} / {fmt(coverage.area * units.areaFactor)} {units.area}
        </Caption>}
      </g>;
    })}
    {!isGeoboard(state) && state.flags.measures && <Caption at={{ x: 480, y: 55 }} size={14}>
      {api.locale === "en" ? `${squares.length} squares · laid area ${fmt(squares.length * units.areaFactor)} · union ${fmt(unionArea * units.areaFactor)} ${units.area}` : `${squares.length} 块单位方格 · 累计铺放 ${fmt(squares.length * units.areaFactor)} · 并集 ${fmt(unionArea * units.areaFactor)} ${units.area}`}
    </Caption>}
    <Caption at={{ x: 480, y: 690 }} size={12}>{textFor(legend, api.locale)}</Caption>
    {gridMaterials(state).length === 0 && <Caption at={{ x: 480, y: 335 }}>{textFor(t("从右侧绘制或追加材料", "Draw or add materials on the right"), api.locale)}</Caption>}
  </>;
}

const toggle = (flag: string, icon: PlanarAction["icon"], label: PlanarText): PlanarAction => ({ id: `grid-${flag}`, icon, label, active: (state) => state.flags[flag], run: (state) => setGridFlag(state, flag) });
const insertAction: PlanarAction = { id: "grid-insert-vertex", icon: "increase", label: t("在选中边上加点", "Insert a point on the selected side"),
  disabled: (state, context) => !context.selected || insertGridVertex(state, context.selected) === state, run: (state, context) => context.selected ? insertGridVertex(state, context.selected) : state };
const removeVertexAction: PlanarAction = { id: "grid-remove-vertex", icon: "decrease", label: t("移去选中顶点", "Remove selected vertex"),
  disabled: (state, context) => !context.selected || removeGridVertex(state, context.selected) === state, run: (state, context) => context.selected ? removeGridVertex(state, context.selected) : state };
const commonActions: PlanarAction[] = [
  toggle("boundary", "edge", t("观察边界", "Observe boundary")),
  toggle("measures", "measure", t("观察长度与面积", "Observe lengths and areas")),
  toggle("height", "dimensions", t("观察高与直角", "Observe height and right angle")),
  { id: "grid-duplicate", icon: "duplicate", label: t("复制当前材料", "Duplicate current material"), disabled: (state) => noMaterial(state) || duplicateGridMaterial(state) === state, run: duplicateGridMaterial },
  { id: "grid-remove", icon: "remove", label: t("移去当前材料", "Remove current material"), disabled: noMaterial, run: removeGridMaterial },
];
const latticeActions: PlanarAction[] = [
  toggle("points", "vertex", t("观察内部点与边界点", "Observe interior and boundary points")),
  toggle("relation", "number", t("观察格点面积关系", "Observe the lattice-area relation")),
  toggle("triangles", "cut", t("观察三角分割线", "Observe triangulation")),
  { id: "grid-separate", icon: "separate", label: t("分开三角片／拼回", "Separate triangles or restore"), duration: 1100,
    disabled: noPolygon, active: (state) => { const material = gridMaterial(state); return material?.kind === 0 && material.split; }, run: separateGridPolygon, interpolate: interpolateGridSeparation },
];
const areaActions: PlanarAction[] = [toggle("coverage", "layers", t("观察实际覆盖", "Observe actual coverage")), toggle("units", "number", t("显示单位方格面积", "Show each unit-square area"))];

const coordinateField = (key: "x" | "y", geoboard: boolean): PlanarField => ({ key, label: key === "x" ? t("左端 X（格）", "Left X (grid units)") : t("上端 Y（格）", "Top Y (grid units)"), min: -1, max: key === "x" ? GRID_COLUMNS : GRID_ROWS, step: geoboard ? 1 : 0.1,
  disabled: noMaterial, read: (state) => { const material = gridMaterial(state); if (!material) return 0; const bounds = gridBounds(gridMaterialPoints(material)); return key === "x" ? bounds.minX : bounds.minY; } });
const heightField = (key: "base" | "apex"): PlanarField => ({ key, label: key === "base" ? t("底边编号", "Base side number") : t("高的顶点编号", "Height vertex number"), min: 1, max: 32, step: 1, disabled: noPolygon,
  read: (state) => { const material = gridMaterial(state); return material?.kind === 0 ? material[key] + 1 : 1; } });

function gridMaterialsMenu(geoboard: boolean): PlanarMaterial[] {
  const quick: { id: string; label: PlanarText; points: PlanarPoint[] }[] = [
    { id: "triangle", label: t("追加三角形", "Add a triangle"), points: [{ x: 10, y: 3 }, { x: 15, y: 3 }, { x: 12, y: 7 }] },
    { id: "rectangle", label: t("追加长方形", "Add a rectangle"), points: [{ x: 10, y: 3 }, { x: 15, y: 3 }, { x: 15, y: 7 }, { x: 10, y: 7 }] },
  ];
  if (!geoboard) quick.push({ id: "hundred-square", label: t("追加 10 × 10 格目标", "Add a 10 × 10 target"), points: [{ x: 1, y: 1 }, { x: 11, y: 1 }, { x: 11, y: 11 }, { x: 1, y: 11 }] });
  const menu: PlanarMaterial[] = quick.map((preset) => ({ id: `grid-material-${preset.id}`, label: preset.label, group: t("可编辑目标", "Editable shapes"),
    preview: <svg viewBox="0 0 18 12" width="76" height="56" aria-hidden="true"><polygon points={coordinates(preset.points)} fill="var(--leaf)" stroke="var(--ink)" strokeWidth="0.3" /></svg>,
    add: (state) => addGridPolygon(state, preset.points), disabled: (state) => gridPolygons(state).length >= MAX_GRID_POLYGONS || addGridPolygon(state, preset.points) === state }));
  if (!geoboard) menu.unshift(
    { id: "grid-unit-square", label: t("一个单位方格", "One unit square"), group: t("单位面材料", "Unit-area pieces"),
      preview: <svg viewBox="0 0 4 3" width="76" height="56" aria-hidden="true"><rect x="1.5" y="1" width="1" height="1" fill="var(--moon)" stroke="var(--ink)" strokeWidth="0.06" /></svg>, add: (state) => addUnitSquare(state), disabled: (state) => unitSquares(state).length >= MAX_UNIT_SQUARES },
    { id: "grid-unit-row", label: t("追加十块方格", "Add ten unit squares"), group: t("单位面材料", "Unit-area pieces"),
      preview: <svg viewBox="0 0 12 5" width="76" height="56" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <rect key={i} x={i + 1} y="2" width="1" height="1" fill="var(--moon)" stroke="var(--ink)" strokeWidth="0.06" />)}</svg>, add: addUnitRow, disabled: (state) => unitSquares(state).length > MAX_UNIT_SQUARES - 10 },
  );
  return menu;
}

function previewGridMaterial(tool: string, draft: readonly PlanarPoint[], state?: PlanarState) {
  if (!state) return null;
  const blank = { ...createGridMeasureState(state.sceneId as GridSceneId, true), flags: state.flags }, candidate = constructGridMaterial(blank, tool, draft), material = gridMaterial(candidate);
  const points = draft.map((point) => projectGridPoint(point, state));
  return <g data-grid-draft="true" pointerEvents="none">
    {material ? <polygon points={coordinates(gridMaterialPoints(material).map(gridToStage))} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 5" /> : points.length > 1 ? <polyline points={coordinates(points)} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 5" /> : null}
    {points.map((at, i) => <circle key={i} cx={at.x} cy={at.y} r="4" fill="var(--paper)" stroke="var(--rose)" strokeWidth="1.5" />)}
  </g>;
}

function gridContextActions(state: PlanarState, selected: string | null): PlanarContextActions | null {
  const target = parseGridTarget(selected), material = target && gridMaterial(state, target.id);
  if (!target || !material) return null;
  let points = gridMaterialPoints(material);
  if (target.type === "part" && material.kind === 0 && material.split) {
    const triangle = gridTriangles(material.vertices)[target.index!];
    if (!triangle) return null;
    points = triangle.map((at) => add(at, material.offsets[target.index!]));
  }
  const bounds = gridBounds(points.map(gridToStage)), action = (id: string) => ({ kind: "action" as const, id }), operation = (id: string) => ({ kind: "operation" as const, id });
  if (material.kind === 1) return { bounds, items: [operation("move"), action("grid-duplicate"), action("grid-remove")] };
  if (target.type === "vertex") return { bounds, items: [action("grid-remove-vertex"), action("grid-measures"), action("grid-remove")] };
  if (target.type === "edge") return { bounds, items: [action("grid-insert-vertex"), operation("height"), action("grid-height")] };
  return { bounds, items: [...(!material.split ? [operation("edit")] : []), action(isGeoboard(state) ? "grid-separate" : "grid-coverage"), action("grid-measures"), action("grid-duplicate"), action("grid-remove")] };
}

export function createGridMeasureDefinition(sceneId: GridSceneId): PlanarSceneDefinition {
  const geoboard = sceneId === "34-create";
  return {
    id: sceneId, toolId: geoboard ? "plane-geoboard" : "plane-measurement", referenceGrid: false,
    title: geoboard ? t("钉板与格点面积", "Geoboards and lattice area") : t("面积单位", "Area units"),
    description: geoboard ? t("逐点围图形，右侧追加材料与观察；编辑顶点后松手落在钉点。", "Enclose shapes point by point. Add materials and observations on the right; edited vertices settle on pegs.")
      : t("画出目标，追加并搬动单位方格；重叠与越界也按真实覆盖观察。", "Draw a target, then add and move unit squares. Observe actual coverage, including overlaps and overhangs."),
    create: () => createGridMeasureState(sceneId), draw: drawGridMeasure,
    actions: [...commonActions, ...(geoboard ? latticeActions : areaActions)], materials: gridMaterialsMenu(geoboard), contextActions: gridContextActions,
    fields: [{ key: "unit", label: t("读数单位", "Displayed unit"), min: 0, max: 2, step: 1, options: [ { value: 0, label: t("单位 u", "Unit u") }, { value: 1, label: t("厘米 cm", "Centimetres cm") }, { value: 2, label: t("分米 dm", "Decimetres dm") } ] }],
    toggles: [{ key: "lattice", label: geoboard ? t("显示钉点", "Show pegs") : t("显示单位格网", "Show unit grid") }, ...(!geoboard ? [{ key: "snap", label: t("松手吸附单位格", "Snap to unit grid on release") }] : [])],
    operations: [
      { id: "edit", icon: "editShape", label: t("编辑图形顶点", "Edit shape vertices"), actions: [insertAction, removeVertexAction] },
      { id: "move", icon: "move", label: t("准确摆放", "Position precisely"), fields: [coordinateField("x", geoboard), coordinateField("y", geoboard)] },
      { id: "height", icon: "dimensions", label: t("设置底边与高", "Set base and height"), fields: [heightField("base"), heightField("apex")], actions: [commonActions[2]] },
    ],
    construction: { maxPoints: 32, projectPoint: projectGridPoint,
      tools: [
        { id: "polygon", label: t("逐点围多边形", "Enclose a polygon"), kind: "points", hint: t("点满三个点后，点回起点闭合。", "After three points, tap the first point to close."), disabled: (state) => gridPolygons(state).length >= MAX_GRID_POLYGONS },
        { id: "rectangle", label: t("拉出长方形", "Draw a rectangle"), kind: "drag", disabled: (state) => gridPolygons(state).length >= MAX_GRID_POLYGONS },
        ...(!geoboard ? [{ id: "unit-square", label: t("点放单位方格", "Place a unit square"), kind: "point" as const, disabled: (state: PlanarState) => unitSquares(state).length >= MAX_UNIT_SQUARES }] : []),
      ],
      create: (state, tool, draft) => { const next = constructGridMaterial(state, tool, draft); return next === state ? null : next; }, preview: previewGridMaterial,
      invalidHint: t("围出不交叉且有面积的图形；每个图形最多32点，钉板顶点落在格点。", "Enclose a simple polygon with positive area and at most 32 points; geoboard vertices must lie on pegs."),
    },
    setField: setGridField, setFlag: setGridFlag, drag: moveGridMaterial, snap: snapGridMaterial, tap: tapGridMaterial,
    selectionAfterChange: (before, after, selected) => {
      const active = gridMaterial(after), target = parseGridTarget(selected), material = target && gridMaterial(after, target.id);
      if (!active) return null;
      if (before.params.nextId !== after.params.nextId) return gridObjectTarget(active);
      if (!target) return selected;
      if (!material || target.id !== after.params.active && before.params.active !== after.params.active) return gridObjectTarget(active);
      if (material.kind === 0 && target.index !== undefined) {
        const previous = gridMaterial(before, material.id);
        if (target.type === "part" && (!material.split || target.index >= material.offsets.length) || target.type !== "part" && (target.index >= material.vertices.length || previous?.kind === 0 && previous.vertices.length !== material.vertices.length)) return gridObjectTarget(material);
      }
      return selected;
    },
    summary: (state, locale) => locale === "en" ? `${gridPolygons(state).length} shapes, ${unitSquares(state).length} unit squares` : `${gridPolygons(state).length} 个图形，${unitSquares(state).length} 块单位方格`,
  };
}

export const planeGridMeasureScenes: PlanarSceneDefinition[] = [createGridMeasureDefinition("34-create"), createGridMeasureDefinition("11-create")];
