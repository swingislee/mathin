import type { ReactNode } from "react";
import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { HeightMark } from "../planar-kit/geometry";
import { textFor, type PlanarDrawingApi, type PlanarField, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { add, distance, normalizeTurn, polar, POLYGON_DIMENSIONS, POLYGON_LIMIT, POLYGON_SCENE, POLYGON_UNIT, polygonCornerGeometry, polygonJoinedCorners, polygonLocalVertices, polygonMaterial, polygonMaterials, polygonThreeRods, polygonWorldVertices, signedArea, toWorld, type Dimension, type PolygonKind, type PolygonMaterial } from "./geometry";
import { activatePolygonMaterial, addPolygonMaterial, arrangePolygonCorners, copyPolygonFromRods, createPolygonGeometry, createPolygonWorkbenchState, dragPolygonMaterial, duplicatePolygonMaterial, extractPolygonRods, interpolatePolygonCorners, interpolatePolygonFrame, nextPolygonBase, nextPolygonVertex, polygonTarget, removePolygonMaterial, setPolygonField, shearPolygonFrame, togglePolygonCorners, togglePolygonHeight, unlockPolygonMaterial } from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const labels = [t("独立小棒", "Independent rod"), t("三棒闭合关系", "Three-rod closure"), t("四杆活动框架", "Hinged four-rod frame"),
  t("自由三角形", "Free triangle"), t("自由四边形", "Free quadrilateral"), t("矩形", "Rectangle"), t("正方形", "Square"),
  t("平行四边形", "Parallelogram"), t("菱形", "Rhombus"), t("梯形", "Trapezoid")];
const colors = ["var(--leaf-deep)", "var(--rose)", "var(--crater)", "var(--muted)"];
const fmt = (value: number) => Number(value.toFixed(2)).toString();
const attr = (points: readonly Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
const line = (a: Point, b: Point, color: string, width = 2, dashed = false) => <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={dashed ? "6 5" : undefined} />;
function Caption({ at, children }: { at: Point; children: ReactNode }) {
  return <text x={at.x} y={at.y} textAnchor="middle" fontSize="14" fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">{children}</text>;
}
const absent = (state: PlanarState) => !polygonMaterial(state);
const noTriangle = (state: PlanarState) => polygonMaterial(state)?.kind !== 3;
const noCorners = (state: PlanarState) => !polygonMaterial(state)?.corners;
const noHeight = (state: PlanarState) => !polygonMaterial(state) || polygonMaterial(state)!.kind < 2;
const field = (key: string, label: PlanarText, min: number, max: number, read: (state: PlanarState) => number, disabled = absent): PlanarField => ({ key, label, min, max, read, disabled });
const dimension = (key: Dimension, label: PlanarText) => field(key, label, key === "shift" ? -40 : key === "opening" ? 5 : .1, key === "opening" ? 175 : 40,
  (state) => (polygonMaterial(state)?.dimensions[key] ?? 0) / (key === "opening" ? 1 : POLYGON_UNIT),
  (state) => { const object = polygonMaterial(state); return !object || !POLYGON_DIMENSIONS[object.kind].includes(key) || !!object.corners; });

function VertexHandle({ object, index, at, api, active }: { object: PolygonMaterial; index: number; at: Point; api: PlanarDrawingApi; active: boolean }) {
  return <g {...api.bind(`polygon.${object.id}.vertex.${index}`, textFor(t(`材料 ${object.id + 1} 定位点 ${index + 1}`, `Material ${object.id + 1} defining point ${index + 1}`), api.locale))} data-polygon-handle={index} style={{ cursor: "grab" }}>
    <circle cx={at.x} cy={at.y} r="16" fill="transparent" /><circle cx={at.x} cy={at.y} r="5" fill={active ? "var(--rose)" : "var(--paper)"} stroke="var(--rose)" strokeWidth="2" />
    <Caption at={{ x: at.x, y: at.y - 15 }}>{String.fromCharCode(65 + index)}</Caption>
  </g>;
}
function CornerPieces({ object, state, api }: { object: PolygonMaterial; state: PlanarState; api: PlanarDrawingApi }) {
  const geometry = polygonCornerGeometry(object); if (!object.corners) return null;
  const target = polygonJoinedCorners(object), origin = toWorld(object, target[0].at);
  const assembled = object.corners.every((corner, i) => distance(corner.at, target[i].at) < 1e-7 && Math.abs(normalizeTurn(corner.turn - target[i].turn)) < 1e-7);
  return <g data-polygon-corners>
    {line(toWorld(object, add(target[0].at, { x: -95, y: 0 })), toWorld(object, add(target[0].at, { x: 95, y: 0 })), "var(--muted)", 1.5, true)}
    {object.corners.map((corner, index) => {
      const shape = geometry[index], center = toWorld(object, corner.at), turn = corner.turn + object.rotation;
      const a = add(center, polar(shape.radius, turn)), b = add(center, polar(shape.radius, turn + shape.sweep));
      return <g key={index} {...api.bind(`polygon.${object.id}.corner.${index}`, textFor(t(`角片 ${index + 1}`, `Angle piece ${index + 1}`), api.locale))} data-polygon-corner={index} style={{ cursor: "grab" }}>
        <path d={`M${center.x},${center.y} L${a.x},${a.y} A${shape.radius},${shape.radius} 0 0 ${shape.sweep < 0 ? 0 : 1} ${b.x},${b.y} Z`} fill={colors[index]} fillOpacity=".7" stroke="var(--ink)" strokeWidth="1.5" />
        {state.flags.measures && <Caption at={add(center, polar(shape.radius + 19, turn + shape.sweep / 2))}>{`${fmt(Math.abs(shape.sweep))}°`}</Caption>}
      </g>;
    })}
    {state.flags.measures && assembled && <Caption at={{ x: origin.x, y: origin.y + 40 }}>{`${geometry.map((corner) => fmt(Math.abs(corner.sweep))).join("° + ")}° = ${fmt(geometry.reduce((sum, corner) => sum + Math.abs(corner.sweep), 0))}°`}</Caption>}
  </g>;
}
function MaterialDrawing({ object, state, api }: { object: PolygonMaterial; state: PlanarState; api: PlanarDrawingApi }) {
  const vertices = polygonWorldVertices(object), color = colors[object.id % colors.length];
  const selected = polygonTarget(api.selected)?.id === object.id;
  const edit = api.editable && selected && api.operation === "polygon-edit" && !object.corners;
  const rods = object.kind === 1 ? polygonThreeRods(object.dimensions.width!, object.dimensions.left!, object.dimensions.right!, object.dimensions.side!) : null;
  const segments = rods ? rods.segments.map(([a, b]) => [toWorld(object, a), toWorld(object, b)])
    : object.kind === 0 ? [[vertices[0], vertices[1]]] : vertices.map((point, index) => [point, vertices[(index + 1) % vertices.length]]);
  const top = { x: vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length, y: Math.min(...vertices.map((p) => p.y)) - 30 };
  return <g data-polygon-material={object.id} data-polygon-kind={object.kind}>
    <g {...api.bind(`polygon.${object.id}.body`, textFor(labels[object.kind], api.locale))} style={{ cursor: "grab" }}>
      {object.kind >= 2 && <polygon points={attr(vertices)} fill={color} fillOpacity={object.kind === 2 ? .05 : .18} stroke="none" />}
      {segments.map(([a, b], index) => <g key={index}>{line(a, b, "transparent", 22)}{line(a, b, object.kind < 3 ? colors[index % 3] : color, object.kind < 3 ? 7 : 2.5)}</g>)}
      {rods && rods.gap > 0 && line(vertices[2], vertices[3], "var(--rose)", 2, true)}
    </g>
    {object.kind >= 2 && vertices.map((a, index) => <g key={index} {...api.bind(`polygon.${object.id}.edge.${index}`, textFor(t(`选择材料 ${object.id + 1} 底边 ${index + 1}`, `Choose material ${object.id + 1} base ${index + 1}`), api.locale))}>
      {line(a, vertices[(index + 1) % vertices.length], "transparent", 15)}
      {object.height && object.base === index && line(a, vertices[(index + 1) % vertices.length], "var(--rose)", 4)}
    </g>)}
    {object.height && vertices.filter((_, index) => index !== object.base && index !== (object.base + 1) % vertices.length).map((vertex, index) => {
      const a = vertices[object.base], b = vertices[(object.base + 1) % vertices.length];
      const height = Math.abs((b.x - a.x) * (vertex.y - a.y) - (b.y - a.y) * (vertex.x - a.x)) / distance(a, b);
      return <HeightMark key={index} vertex={vertex} baseA={a} baseB={b} label={state.flags.measures ? `h${vertices.length === 4 ? index + 1 : ""} = ${fmt(height / POLYGON_UNIT)} u` : undefined} />;
    })}
    {state.flags.names && <Caption at={top}>{`${object.id + 1} · ${textFor(labels[object.kind], api.locale)}`}</Caption>}
    {state.flags.measures && <g data-polygon-measurements>{segments.map(([a, b], index) => <Caption key={index} at={{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12 }}>{`${fmt(distance(a, b) / POLYGON_UNIT)} u`}</Caption>)}
      {object.kind >= 2 && <Caption at={{ x: top.x, y: Math.max(...vertices.map((p) => p.y)) + 25 }}>{`S = ${fmt(Math.abs(signedArea(vertices)) / POLYGON_UNIT ** 2)} u²`}</Caption>}
      {rods && <Caption at={{ x: top.x, y: Math.max(...vertices.map((p) => p.y)) + 28 }}>{textFor(rods.closed ? t("三棒闭合", "Three rods close") : rods.gap > 0 ? t(`端点间隙 ${rods.gap < .4 ? "< 0.01" : fmt(rods.gap / POLYGON_UNIT)} u`, `Endpoint gap ${rods.gap < .4 ? "< 0.01" : fmt(rods.gap / POLYGON_UNIT)} u`) : t("三棒共线", "Three rods are collinear"), api.locale)}</Caption>}
    </g>}
    {edit && vertices.map((point, index) => rods?.closed && index === 3 ? null : <VertexHandle key={index} object={object} index={index} at={point} api={api} active={state.params.active === object.id && state.params.vertex === index} />)}
    <CornerPieces object={object} state={state} api={api} />
  </g>;
}

const drawingTools = [
  { id: "rod", kind: "drag" as const, label: labels[0] }, { id: "rods", kind: "points" as const, label: labels[1] },
  { id: "frame", kind: "points" as const, label: labels[2] }, { id: "triangle", kind: "points" as const, label: labels[3] },
  { id: "quadrilateral", kind: "points" as const, label: labels[4] }, { id: "rectangle", kind: "drag" as const, label: labels[5] }, { id: "square", kind: "drag" as const, label: labels[6] },
];
export const planePolygonWorkbenchScene: PlanarSceneDefinition = {
  id: POLYGON_SCENE, toolId: "plane-polygons", title: t("三角形、四边形与活动框架", "Triangles, quadrilaterals and hinged frames"),
  description: t("在同一舞台画、摆和改材料；观察杆长、拆拼三个角，或换一条底边看真实高。", "Draw, arrange and edit materials together. Explore rod lengths, assemble three angles, or choose another base and its true altitudes."),
  create: createPolygonWorkbenchState,
  materials: labels.map((label, kind) => ({ id: `polygon-add-${kind}`, label, group: kind < 3 ? t("杆与活动框架", "Rods and frames") : t("图形材料", "Shape materials"),
    preview: <svg viewBox="0 0 80 54" width="72" height="48" aria-hidden="true"><path d={kind === 0 ? "M8,39L69,15" : kind === 1 || kind === 3 ? "M10,42L66,42L30,9Z" : kind === 5 || kind === 6 ? "M13,10H67V43H13Z" : kind === 9 ? "M8,43L23,12H56L72,43Z" : "M8,43L28,12H72L52,43Z"} fill={kind < 3 ? "none" : "var(--leaf)"} fillOpacity=".3" stroke="currentColor" strokeWidth={kind < 3 ? 4 : 2} /></svg>,
    add: (state) => addPolygonMaterial(state, kind as PolygonKind), disabled: (state) => state.params.count >= POLYGON_LIMIT })),
  construction: {
    maxPoints: 4,
    tools: drawingTools.map((tool) => ({ ...tool, disabled: (state: PlanarState) => state.params.count >= POLYGON_LIMIT,
      hint: tool.id === "frame" ? t("依次点基边两端和邻边端点，再完成；第四个关节按杆长闭合。", "Choose the two base ends and the adjacent joint, then finish; the fourth joint closes the frame.")
        : tool.kind === "points" ? t(tool.id === "quadrilateral" ? "依次点四个顶点，再完成。" : "依次点三个顶点，再完成。", tool.id === "quadrilateral" ? "Choose four vertices in order, then finish." : "Choose three vertices in order, then finish.")
          : t("拖出小棒两端或图形对角点。", "Drag between rod ends or opposite shape corners.") })),
    create: createPolygonGeometry,
    preview: (tool, points) => {
      const width = points.length > 1 ? Math.abs(points[1].x - points[0].x) : 0, height = points.length > 1 ? Math.abs(points[1].y - points[0].y) : 0;
      const w = tool === "square" ? Math.min(width, height) : width, h = tool === "square" ? Math.min(width, height) : height;
      return <g pointerEvents="none">{tool === "rectangle" || tool === "square" ? points.length > 1 && <rect x={Math.min(points[0].x, points[1].x)} y={Math.max(points[0].y, points[1].y) - h} width={w} height={h} fill="none" stroke="var(--rose)" strokeWidth="2" strokeDasharray="5 5" />
        : <polyline points={attr(points)} fill="none" stroke="var(--rose)" strokeWidth="2" strokeDasharray="5 5" />}</g>;
    },
    invalidHint: t("请使用足够分开的点；三角形不共线，四边形不交叉，框架开角为 5–175°。", "Separate the points; triangles need area, quadrilaterals must be simple, and frame openings range from 5–175°."),
  },
  fields: [field("x", t("材料基点 X（u）", "Material anchor X (u)"), -100, 100, (s) => (polygonMaterial(s)?.origin.x ?? 0) / POLYGON_UNIT),
    field("y", t("材料基点 Y（u）", "Material anchor Y (u)"), -100, 100, (s) => (polygonMaterial(s)?.origin.y ?? 0) / POLYGON_UNIT),
    field("rotation", t("整体方向（°）", "Material orientation (°)"), -180, 180, (s) => polygonMaterial(s)?.rotation ?? 0)],
  operations: [
    { id: "polygon-size", icon: "dimensions", label: t("准确杆长与家族尺寸", "Precise rod and family dimensions"), fields: [
      dimension("width", t("AB／小棒长（u）", "AB / rod length (u)")), dimension("left", t("左杆／框架侧杆（u）", "Left rod / frame side (u)")),
      dimension("right", t("右杆长（u）", "Right rod length (u)")), dimension("height", t("基线间高（u）", "Height between bases (u)")),
      dimension("shift", t("上边偏移（u）", "Upper-base offset (u)")), dimension("top", t("梯形上边长（u）", "Trapezoid upper base (u)")),
      dimension("opening", t("关节开角（°）", "Joint opening (°)")),
    ] },
    { id: "polygon-edit", icon: "editShape", label: t("编辑材料定位点", "Edit material defining points"), fields: [
      ...(["pointX", "pointY"] as const).map((key) => field(key, t(`当前点 ${key === "pointX" ? "X" : "Y"}（u）`, `Current point ${key === "pointX" ? "X" : "Y"} (u)`), -250, 250,
        (s) => { const o = polygonMaterial(s); if (!o) return 0; const v = polygonLocalVertices(o); return toWorld(o, v[Math.min(s.params.vertex, v.length - 1)])[key === "pointX" ? "x" : "y"] / POLYGON_UNIT; },
        (s) => absent(s) || !!polygonMaterial(s)?.corners)),
    ], actions: [{ id: "polygon-next-vertex", icon: "nextStep", label: t("选择下一个定位点", "Select the next defining point"), run: (s) => nextPolygonVertex(s), disabled: (s) => absent(s) || !!polygonMaterial(s)?.corners }] },
    { id: "polygon-rods", icon: "group", label: t("三棒关系与框架活动", "Rod relationships and hinged motion"), actions: [
      { id: "polygon-extract-rods", icon: "ungroup", label: t("复制成三根独立小棒", "Copy as three independent rods"), run: extractPolygonRods, disabled: (s) => polygonMaterial(s)?.kind !== 1 || s.params.count + 3 > POLYGON_LIMIT },
      { id: "polygon-rods-triangle", icon: "duplicate", label: t("复制闭合三角形材料", "Copy the closed triangle as material"), run: copyPolygonFromRods, disabled: (s) => copyPolygonFromRods(s) === s },
      { id: "polygon-frame-shear", icon: "play", label: t("连续推斜框架", "Continuously shear the frame"), run: shearPolygonFrame, duration: 1400, interpolate: interpolatePolygonFrame, disabled: (s) => polygonMaterial(s)?.kind !== 2 },
    ] },
    { id: "polygon-angles", icon: "cut", label: t("拆出真实角片并拼角", "Extract and assemble true angle pieces"), fields: [
      ...(["cornerX", "cornerY"] as const).map((key) => field(key, t(`当前角片 ${key === "cornerX" ? "X" : "Y"}（u）`, `Current angle piece ${key === "cornerX" ? "X" : "Y"} (u)`), -250, 250,
        (s) => { const o = polygonMaterial(s); return o?.corners ? toWorld(o, o.corners[Math.min(2, s.params.vertex)].at)[key === "cornerX" ? "x" : "y"] / POLYGON_UNIT : 0; }, noCorners)),
      field("cornerTurn", t("当前角片方向（°）", "Current angle piece orientation (°)"), -180, 180, (s) => { const o = polygonMaterial(s); return o?.corners ? normalizeTurn(o.corners[Math.min(2, s.params.vertex)].turn + o.rotation) : 0; }, noCorners),
    ], actions: [
      { id: "polygon-corners", icon: "cut", label: t("拆出角片／收回角片", "Extract / put away angle pieces"), run: togglePolygonCorners, active: (s) => !!polygonMaterial(s)?.corners, disabled: noTriangle },
      { id: "polygon-next-corner", icon: "nextStep", label: t("选择下一个角片", "Select the next angle piece"), run: (s) => nextPolygonVertex(s, true), disabled: noCorners },
      { id: "polygon-join-angles", icon: "assemble", label: t("逐片拼成平角", "Assemble the angles into a straight angle"), run: (s) => arrangePolygonCorners(s, true), duration: 2100, interpolate: interpolatePolygonCorners, disabled: noCorners },
      { id: "polygon-return-angles", icon: "returnContents", label: t("角片逐片回原位", "Return the angle pieces to their vertices"), run: (s) => arrangePolygonCorners(s, false), duration: 2100, interpolate: interpolatePolygonCorners, disabled: noCorners },
    ] },
    { id: "polygon-altitudes", icon: "projection", label: t("选择底边与观察真实高", "Choose a base and inspect true altitudes"), actions: [
      { id: "polygon-show-height", icon: "projection", label: t("显示当前材料的底与高", "Show this material's base and altitudes"), run: togglePolygonHeight, active: (s) => !!polygonMaterial(s)?.height, disabled: noHeight },
      { id: "polygon-next-base", icon: "nextStep", label: t("换下一条底边", "Choose the next base"), run: nextPolygonBase, disabled: noHeight },
    ] },
  ],
  actions: [
    { id: "polygon-copy", icon: "duplicate", label: t("复制当前材料", "Duplicate current material"), run: duplicatePolygonMaterial, disabled: (s) => absent(s) || s.params.count >= POLYGON_LIMIT },
    { id: "polygon-remove", icon: "remove", label: t("移除当前材料", "Remove current material"), run: removePolygonMaterial, disabled: absent },
    { id: "polygon-unlock", icon: "ungroup", label: t("明确转为自由四边形", "Convert explicitly to a free quadrilateral"), run: unlockPolygonMaterial, disabled: (s) => ![2, 5, 6, 7, 8, 9].includes(polygonMaterial(s)?.kind ?? -1) },
    ...(["measures", "names"] as const).map((key) => ({ id: `polygon-show-${key}`, icon: key === "measures" ? "measure" as const : "labels" as const,
      label: key === "measures" ? t("显示准确量", "Show measurements") : t("显示材料名称", "Show material names"), active: (s: PlanarState) => s.flags[key],
      run: (s: PlanarState) => ({ ...s, flags: { ...s.flags, [key]: !s.flags[key] } }) })),
  ],
  draw: (state, api) => <g data-polygon-workbench>{polygonMaterials(state).map((object) => <MaterialDrawing key={object.id} object={object} state={state} api={api} />)}
    {state.params.count === 0 && <Caption at={{ x: 480, y: 330 }}>{textFor(t("添加小棒或图形，也可以直接绘制", "Add rods or shapes, or draw your own"), api.locale)}</Caption>}</g>,
  setField: setPolygonField, tap: activatePolygonMaterial, drag: dragPolygonMaterial,
  selectionAfterChange: (before, after, selected) => before.params.count !== after.params.count ? after.params.count ? `polygon.${after.params.active}.body` : null : selected,
  contextActions: (state, selected) => {
    const hit = polygonTarget(selected), object = hit && polygonMaterial(state, hit.id); if (!object) return null;
    const points = [...polygonWorldVertices(object), ...(object.corners?.map((corner) => toWorld(object, corner.at)) ?? [])];
    return { bounds: { minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)) }, items: [
      { kind: "operation", id: "polygon-edit" }, { kind: "operation", id: object.kind === 3 ? "polygon-angles" : object.kind < 3 ? "polygon-rods" : "polygon-size" },
      ...(object.kind >= 2 ? [{ kind: "operation" as const, id: "polygon-altitudes" }] : []), { kind: "action", id: "polygon-copy" }, { kind: "action", id: "polygon-remove" },
    ] };
  },
  summary: (state, locale) => textFor(t(`${state.params.count} 份独立材料`, `${state.params.count} independent materials`), locale),
};
