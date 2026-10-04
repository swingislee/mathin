import type { ReactNode } from "react";
import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { HeightMark } from "../planar-kit/geometry";
import { textFor, type PlanarDrawingApi, type PlanarField, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { activateLine, addLineMaterial, createLineGeometry, createLinesState, dragLine, duplicateLine, lineMaterial, lineMaterials, lineMetrics, linePolar, lineTarget, removeLine, setLineField, type LineKind, type LineMaterial } from "./model";
import { LINE_LIMIT, LINE_SCENE, LINE_UNIT } from "./validation";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const labels = [t("线段", "Segment"), t("射线", "Ray"), t("直线", "Line"), t("角", "Angle"), t("量角器", "Protractor"), t("点到直线", "Point to line"), t("平行线", "Parallel lines")];
const names = ["segment", "ray", "line", "angle", "protractor", "perpendicular", "parallel"];
const colors = ["var(--leaf-deep)", "var(--rose)", "var(--crater)", "var(--muted)"];
const fmt = (value: number) => Number(value.toFixed(2)).toString();
const plus = (p: Point, q: Point): Point => ({ x: p.x + q.x, y: p.y + q.y });
const at = (state: PlanarState) => lineMaterial(state);
const absent = (state: PlanarState) => !at(state);
const field = (key: string, label: PlanarText, min: number, max: number, read: (state: PlanarState) => number, disabled = absent, step = .1): PlanarField => ({ key, label, min, max, step, read, disabled });
const line = (a: Point, b: Point, color = "var(--ink)", width = 2.5, dashed = false) => <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeDasharray={dashed ? "5 5" : undefined} strokeLinecap="round" />;
function Caption({ point, children }: { point: Point; children: ReactNode }) {
  return <text x={point.x} y={point.y} textAnchor="middle" fontSize="15" fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">{children}</text>;
}
function Dot({ object, name, point, api }: { object: LineMaterial; name: "a" | "b" | "c" | "q"; point: Point; api: PlanarDrawingApi }) {
  return <g {...api.bind(`line.${object.id}.${name}`, textFor(t(`材料 ${object.id + 1} 点 ${name.toUpperCase()}`, `Material ${object.id + 1} point ${name.toUpperCase()}`), api.locale))} data-line-handle={name} style={{ cursor: "grab" }}>
    <circle cx={point.x} cy={point.y} r="17" fill="transparent" />
    <circle cx={point.x} cy={point.y} r="5" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" />
    <Caption point={{ x: point.x, y: point.y - 14 }}>{name.toUpperCase()}</Caption>
  </g>;
}
function Protractor({ object }: { object: LineMaterial }) {
  const { length: radius, orientation } = lineMetrics(object);
  return <g data-line-protractor transform={`translate(${object.a.x} ${object.a.y}) rotate(${orientation})`}>
    <path d={`M${radius},0 A${radius},${radius} 0 0 1 ${-radius},0 Z`} fill="var(--moon)" fillOpacity=".12" stroke="var(--muted)" strokeWidth="1.5" />
    {Array.from({ length: 37 }, (_, i) => {
      const angle = i * 5, start = linePolar(radius - (i % 2 ? 7 : 13), angle), end = linePolar(radius, angle), label = linePolar(radius - 29, angle);
      return <g key={i}>{line(start, end, "var(--muted)", i % 2 ? 1 : 1.5)}{i % 6 === 0 && <text x={label.x} y={label.y + 4} textAnchor="middle" fontSize="11" fill="var(--ink)" pointerEvents="none">{angle}</text>}</g>;
    })}
    {line({ x: -12, y: 0 }, { x: 12, y: 0 }, "var(--rose)", 1)}{line({ x: 0, y: -9 }, { x: 0, y: 9 }, "var(--rose)", 1)}
  </g>;
}
function Material({ object, state, api }: { object: LineMaterial; state: PlanarState; api: PlanarDrawingApi }) {
  const { a, b, c, kind, id } = object, metrics = lineMetrics(object), color = colors[id % colors.length];
  const extension = (origin: Point, extent: number) => plus(origin, { x: metrics.unit.x * extent, y: metrics.unit.y * extent });
  const first = kind === 2 || kind >= 5 ? extension(a, -12000) : a, last = kind === 1 || kind === 2 || kind >= 5 ? extension(a, 12000) : b;
  const edit = api.editable && api.operation === "line-edit" && lineTarget(api.selected)?.id === id;
  const distanceEdit = api.editable && api.operation === "line-distance" && lineTarget(api.selected)?.id === id;
  return <g data-line-material={id} data-line-kind={kind}>
    <g {...api.bind(`line.${id}.body`, textFor(labels[kind], api.locale))} style={{ cursor: "grab" }}>
      {kind === 4 ? <Protractor object={object} /> : <>
        {line(first, last, "transparent", 22)}{line(first, last, color)}
        {kind === 3 && <>{line(a, c, "transparent", 22)}{line(a, c, color)}<path d={`M${plus(a, linePolar(28, metrics.orientation)).x},${plus(a, linePolar(28, metrics.orientation)).y} A28,28 0 ${metrics.angle > 180 ? 1 : 0} 1 ${plus(a, linePolar(28, metrics.orientation + metrics.angle)).x},${plus(a, linePolar(28, metrics.orientation + metrics.angle)).y}`} fill="none" stroke={color} strokeWidth="1.5" pointerEvents="none" /></>}
        {kind === 6 && <>{line(extension(c, -12000), extension(c, 12000), "transparent", 22)}{line(extension(c, -12000), extension(c, 12000), color)}</>}
        {kind <= 2 && state.flags.detour && <polyline points={`${a.x},${a.y} ${c.x},${c.y} ${b.x},${b.y}`} fill="none" stroke="var(--rose)" strokeWidth="2" strokeDasharray="5 5" />}
        {kind >= 5 && <>{line(c, metrics.via, "var(--rose)", 2)}<circle cx={c.x} cy={c.y} r="5" fill={color} /></>}
        {kind <= 2 && <><circle cx={a.x} cy={a.y} r="4" fill={color} /><circle cx={b.x} cy={b.y} r="4" fill={color} /></>}
      </>}
    </g>
    {kind >= 5 && state.flags.foot && <HeightMark vertex={c} baseA={a} baseB={b} label={state.flags.measures ? `${fmt(metrics.height / LINE_UNIT)} u` : undefined} />}
    {state.flags.names && <Caption point={{ x: a.x, y: a.y - 36 }}>{`${id + 1} · ${textFor(labels[kind], api.locale)}`}</Caption>}
    {state.flags.measures && kind !== 4 && <Caption point={{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 28 }}>{kind === 3 ? `${fmt(metrics.angle)}°` : kind >= 5
      ? textFor(t(`斜线 ${fmt(metrics.slant / LINE_UNIT)} u`, `Oblique ${fmt(metrics.slant / LINE_UNIT)} u`), api.locale)
      : `AB ${fmt(metrics.length / LINE_UNIT)} u${state.flags.detour ? ` · ACB ${fmt(metrics.detour / LINE_UNIT)} u` : ""}`}</Caption>}
    {edit && <>{(["a", "b", "c"] as const).filter((name) => name !== "c" || kind === 3 || kind >= 5 || state.flags.detour).map((name) => <Dot key={name} object={object} name={name} point={object[name]} api={api} />)}</>}
    {distanceEdit && kind >= 5 && <Dot object={object} name="q" point={metrics.via} api={api} />}
  </g>;
}

export const planeLinesScene: PlanarSceneDefinition = {
  id: LINE_SCENE, toolId: "plane-geometry", title: t("线与角的同台建构", "Build lines and angles together"),
  description: t("在同一舞台画线、张角和放量角器；添加垂距或平行线材料，直接改点并用准确参数比较。", "Draw lines and angles and place protractors on one stage. Add distance or parallel-line materials, edit their points and compare precise values."),
  create: createLinesState,
  materials: labels.map((label, kind) => ({ id: `line-add-${names[kind]}`, label, group: t("添加线与角材料", "Add line and angle materials"),
    preview: <svg viewBox="0 0 80 54" width="72" height="48" aria-hidden="true">{kind === 4 ? <path d="M8,18 A30,30 0 0 1 68,18Z" fill="none" stroke="currentColor" strokeWidth="2" /> : <><path d={kind === 3 ? "M60,18 L20,40 L64,40" : kind >= 5 ? "M6,35H74M40,12V35" : "M8,38L70,16"} fill="none" stroke="currentColor" strokeWidth="2" />{kind === 6 && <path d="M6,12H74" stroke="currentColor" strokeWidth="2" />}</>}</svg>,
    add: (state) => addLineMaterial(state, kind as LineKind), disabled: (state) => state.params.count >= LINE_LIMIT })),
  construction: {
    maxPoints: 3, tools: names.map((name, kind) => ({ id: name, kind: kind === 3 ? "points" as const : "drag" as const, label: labels[kind],
      hint: kind === 3 ? t("依次点顶点、第一臂端点、第二臂端点，再完成。", "Choose vertex, first-arm endpoint, then second-arm endpoint and finish.") : t("拖出两个定位点，完成后可编辑所有点。", "Drag between two points; edit all points after creating the material."),
      disabled: (state: PlanarState) => state.params.count >= LINE_LIMIT })),
    create: createLineGeometry,
    preview: (_tool, points) => <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--rose)" strokeWidth="2" strokeDasharray="5 5" pointerEvents="none" />,
    invalidHint: t("请使用不同定位点；量角器半径为 1–10 u。", "Use distinct defining points; the protractor radius is 1–10 u."),
  },
  fields: [
    field("x", t("基点 X（u）", "Anchor X (u)"), -100, 100, (s) => (at(s)?.a.x ?? 0) / LINE_UNIT),
    field("y", t("基点 Y（u）", "Anchor Y (u)"), -100, 100, (s) => (at(s)?.a.y ?? 0) / LINE_UNIT),
    field("orientation", t("整体方向（°）", "Orientation (°)"), -180, 180, (s) => at(s) ? lineMetrics(at(s)!).orientation : 0),
    field("length", t("AB／量角器半径（u）", "AB / protractor radius (u)"), .025, 200, (s) => at(s) ? lineMetrics(at(s)!).length / LINE_UNIT : 0, absent, .025),
  ],
  operations: [
    { id: "line-edit", icon: "editShape", label: t("编辑当前材料定位点", "Edit current defining points"), fields: [
      { key: "vertex", label: t("定位点", "Defining point"), min: 0, max: 2, options: ["A", "B", "C"].map((name, value) => ({ value, label: t(name, name) })), disabled: absent },
      field("pointX", t("点 X（u）", "Point X (u)"), -100, 100, (s) => (at(s)?.[["a", "b", "c"][s.params.vertex] as "a" | "b" | "c"].x ?? 0) / LINE_UNIT),
      field("pointY", t("点 Y（u）", "Point Y (u)"), -100, 100, (s) => (at(s)?.[["a", "b", "c"][s.params.vertex] as "a" | "b" | "c"].y ?? 0) / LINE_UNIT),
      { key: "kind", label: t("当前线的延伸方式", "Current line extension"), min: 0, max: 2, options: labels.slice(0, 3).map((label, value) => ({ value, label })), read: (s) => at(s)?.kind ?? 0, disabled: (s) => !at(s) || at(s)!.kind > 2 },
    ] },
    { id: "line-angle", icon: "rotate", label: t("准确张角", "Set the opening angle"), fields: [
      field("angle", t("顺时针张角（°）", "Clockwise opening (°)"), 0, 359.9, (s) => at(s) ? lineMetrics(at(s)!).angle : 0, (s) => at(s)?.kind !== 3),
      field("secondLength", t("第二臂长（u）", "Second arm length (u)"), .025, 200, (s) => at(s) ? lineMetrics(at(s)!).secondLength / LINE_UNIT : 0, (s) => at(s)?.kind !== 3, .025),
    ] },
    { id: "line-distance", icon: "measure", label: t("移动斜线落点", "Move the oblique endpoint"), fields: [
      field("q", t("落点距垂足（u）", "Endpoint from perpendicular foot (u)"), -100, 100, (s) => (at(s)?.q ?? 0) / LINE_UNIT, (s) => !at(s) || at(s)!.kind < 5),
    ] },
  ],
  actions: [
    { id: "line-copy", icon: "duplicate", label: t("复制当前材料", "Duplicate current material"), run: duplicateLine, disabled: (s) => absent(s) || s.params.count >= LINE_LIMIT },
    { id: "line-remove", icon: "remove", label: t("移除当前材料", "Remove current material"), run: removeLine, disabled: absent },
    ...(["measures", "names", "detour", "foot"] as const).map((key, index) => ({ id: `line-observe-${key}`, icon: (["measure", "labels", "edge", "projection"] as const)[index],
      label: [t("显示准确量", "Show measurements"), t("显示名称和编号", "Show names and numbers"), t("比较直达与绕行", "Compare direct and detour paths"), t("显示垂距和直角", "Show perpendicular distance")][index],
      active: (s: PlanarState) => s.flags[key], run: (s: PlanarState) => ({ ...s, flags: { ...s.flags, [key]: !s.flags[key] } }) })),
  ],
  draw: (state, api) => <g data-lines-workbench>{state.params.count === 0 && <Caption point={{ x: 480, y: 330 }}>{textFor(t("添加材料或直接画出线与角", "Add a material or draw lines and angles"), api.locale)}</Caption>}{lineMaterials(state).map((object) => <Material key={object.id} object={object} state={state} api={api} />)}</g>,
  setField: setLineField, drag: dragLine, tap: activateLine,
  selectionAfterChange: (before, after, selected) => before.params.count !== after.params.count ? after.params.count ? `line.${after.params.active}.body` : null : selected,
  contextActions: (state, selected) => {
    const hit = lineTarget(selected), object = hit && lineMaterial(state, hit.id); if (!object) return null;
    const points = [object.a, object.b, object.c];
    return { bounds: { minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)) },
      items: [{ kind: "operation", id: "line-edit" }, ...(object.kind === 3 || object.kind >= 5 ? [{ kind: "operation" as const, id: object.kind === 3 ? "line-angle" : "line-distance" }] : []), { kind: "action", id: "line-copy" }, { kind: "action", id: "line-remove" }] };
  },
  summary: (state, locale) => textFor(t(`${state.params.count} 份线角材料`, `${state.params.count} line and angle materials`), locale),
};
