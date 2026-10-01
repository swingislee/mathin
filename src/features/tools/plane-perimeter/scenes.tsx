import type { ReactNode } from "react";
import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { constructionBounds, constructionObject, constructionObjects, parseConstructionTarget } from "../plane-construction/model";
import { createConstructionDefinition } from "../plane-construction/scenes";
import { distance, polygonSegments } from "../plane-geometry/model";
import {
  PERIMETER_SCENE_ID, PERIMETER_UNIT, createPerimeterGeometry, createPerimeterState,
  perimeterComparison, perimeterLength, perimeterVertices, setPerimeterField, setPerimeterProgress,
  syncPerimeterGeometry, walkPerimeter, type PerimeterProgress,
} from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const colors = ["var(--leaf-deep)", "var(--crater)", "var(--rose)", "var(--muted)"];
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const fmt = (value: number) => Number(value.toFixed(2)).toString();
const base = createConstructionDefinition(PERIMETER_SCENE_ID, "plane-perimeter", t("周长探究", "Exploring perimeter"));
const noObject = (state: PlanarState) => !constructionObject(state);
const withProgress = (action: PlanarAction): PlanarAction => ({ ...action, run: (state, context) => syncPerimeterGeometry(state, action.run(state, context)) });

function Caption({ at, children, size = 14, anchor = "middle" }: { at: PlanarPoint; children: ReactNode; size?: number; anchor?: "start" | "middle" | "end" }) {
  return <text x={at.x} y={at.y} textAnchor={anchor} fontSize={size} fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">{children}</text>;
}

function progressAction(kind: PerimeterProgress, label: PlanarText): PlanarAction {
  return {
    id: kind === "walk" ? "perimeter-walk" : "perimeter-straighten", icon: "play", label, duration: kind === "walk" ? 3200 : 2200,
    disabled: noObject,
    run: (state) => setPerimeterProgress(state, kind, state.params[`${kind}.${state.params.active}`] >= 1 ? 0 : 1),
  };
}

function BoundaryComparison({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const comparison = perimeterComparison(state, api.operation === "perimeter");
  if (!comparison) return null;
  const { scale, bounds, rowHeight, entries, hiddenCount } = comparison;
  const idealUnit = 55 / (scale * PERIMETER_UNIT), power = 10 ** Math.floor(Math.log10(idealUnit));
  const ruler = [1, 2, 5, 10].filter((value) => value * power <= idealUnit).at(-1)! * power;
  return <g data-perimeter-comparison data-perimeter-scale={scale} pointerEvents="none">
    <rect x="70" y="446" width="820" height="250" rx="9" fill="var(--paper)" fillOpacity="0.97" stroke="var(--line)" />
    <Caption at={{ x: 86, y: 466 }} anchor="start" size={13}>{textFor(t("边界副本 · 共同比例尺", "Boundary copies · one shared scale"), api.locale)}</Caption>
    <line x1="770" y1="461" x2={770 + ruler * PERIMETER_UNIT * scale} y2="461" stroke="var(--muted)" strokeWidth="1.5" />
    <Caption at={{ x: 852, y: 466 }} size={12}>{fmt(ruler)} u</Caption>
    {entries.map(({ object, vertices, segments }, index) => {
      const rowY = 480 + index * rowHeight, offset = { x: 112 - bounds.minX * scale, y: rowY + 20 - bounds.minY * scale };
      return <g key={object.id} data-perimeter-copy={object.id}>
        <Caption at={{ x: 86, y: rowY + 12 }} anchor="start" size={12}>{textFor(t(`材料 ${object.id + 1}`, `Shape ${object.id + 1}`), api.locale)}{state.flags.measures ? ` · P = ${fmt(perimeterLength(object) / PERIMETER_UNIT)} u` : ""}</Caption>
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          <polygon points={coordinates(vertices)} fill="none" stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity="0.45" />
          {segments.map((segment, edge) => <line key={edge} data-perimeter-copy-edge={edge} x1={segment.a.x} y1={segment.a.y} x2={segment.b.x} y2={segment.b.y} stroke={colors[edge % colors.length]} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
        </g>
      </g>;
    })}
    <Caption at={{ x: 86, y: 688 }} anchor="start" size={12}>{hiddenCount > 0
      ? textFor(t(`另有 ${hiddenCount} 份边界保留；选择原材料查看`, `${hiddenCount} more boundaries retained; select a shape to view`), api.locale)
      : textFor(t("原材料保持原位；选中材料可编辑或继续演示", "Original shapes stay in place; select one to edit or continue"), api.locale)}</Caption>
  </g>;
}

const actions = base.actions!.filter((action) => !["construction-life-outline", "construction-counts", "construction-names"].includes(action.id)).map((action) => withProgress(action.id === "construction-measures"
  ? { ...action, label: t("显示边长与周长", "Show side lengths and perimeter") } : action));

export const planePerimeterScene: PlanarSceneDefinition = {
  ...base,
  description: t("画出或添加图形，编辑点和尺寸；沿真实边界绕一周，将边界副本保长拉直并用同一比例尺比较。", "Draw or add shapes and edit their vertices or dimensions. Trace their real boundaries, straighten boundary copies without changing edge lengths, and compare at one shared scale."),
  create: createPerimeterState,
  fields: base.fields!.filter((field) => field.key !== "detail").map((field) => field.key === "width" || field.key === "height" ? {
    ...field, label: field.key === "width" ? t("当前图形宽（u）", "Current shape width (u)") : t("当前图形高（u）", "Current shape height (u)"),
    min: field.min / PERIMETER_UNIT, max: field.max / PERIMETER_UNIT, step: 0.1, read: (state) => field.read!(state) / PERIMETER_UNIT,
  } : field),
  actions,
  materials: base.materials!.slice(0, 5).map((material) => ({ ...material, group: t("添加直边图形", "Add a straight-edged shape"), add: (state) => syncPerimeterGeometry(state, material.add(state)) })),
  construction: {
    ...base.construction!, tools: base.construction!.tools.filter((tool) => tool.id === "rectangle" || tool.id === "polygon"),
    create: createPerimeterGeometry,
    invalidHint: t("请沿边界顺序画出闭合、不自交且有面积的图形。", "Draw a closed boundary in order, without crossing itself and with non-zero area."),
  },
  operations: [
    {
      id: "perimeter", icon: "edge", label: t("绕边与拉直", "Trace and straighten"),
      fields: [
        { key: "walk", label: t("绕边进度（%）", "Boundary trace (%)"), min: 0, max: 100, step: 1, read: (state) => (state.params[`walk.${state.params.active}`] ?? 0) * 100, disabled: noObject },
        { key: "straight", label: t("拉直进度（%）", "Straightening (%)"), min: 0, max: 100, step: 1, read: (state) => (state.params[`straight.${state.params.active}`] ?? 0) * 100, disabled: noObject },
      ],
      actions: [progressAction("walk", t("绕一周／沿边退回", "Trace once around / retrace")), progressAction("straight", t("拉直边界／围回", "Straighten boundary / restore"))],
    },
    ...base.operations!.filter((operation) => operation.id !== "reflect").map((operation) => ({ ...operation, actions: operation.actions?.map(withProgress) })),
  ],
  setField: setPerimeterField,
  contextActions: (state, selected) => {
    const target = selected ? parseConstructionTarget(selected) : null;
    const object = target?.id === undefined ? null : constructionObject(state, target.id);
    return object ? { bounds: constructionBounds(object), items: [
      { kind: "operation", id: "perimeter" }, { kind: "action", id: "construction-edit" }, { kind: "action", id: "construction-duplicate" },
    ] } : null;
  },
  draw: (state, api) => <>
    {base.draw({ ...state, flags: { ...state.flags, measures: false } }, api)}
    {constructionObjects(state).map((object) => {
      const walk = state.params[`walk.${object.id}`], straight = state.params[`straight.${object.id}`];
      const vertices = perimeterVertices(object), bounds = constructionBounds(object), traced = walkPerimeter(object, walk);
      return <g key={object.id} data-perimeter-object={object.id} pointerEvents="none">
        {(state.flags.edges || walk > 0 || straight > 0) && polygonSegments(vertices).map((edge, index) => <line key={index} x1={edge.a.x} y1={edge.a.y} x2={edge.b.x} y2={edge.b.y} stroke={colors[index % colors.length]} strokeWidth="2" opacity="0.7" />)}
        {walk > 0 && <g data-perimeter-walk={object.id}>
          {traced.segments.map((edge, index) => <line key={index} x1={edge.a.x} y1={edge.a.y} x2={edge.b.x} y2={edge.b.y} stroke={colors[index % colors.length]} strokeWidth="5" strokeLinecap="round" />)}
          <circle data-perimeter-cursor cx={traced.cursor.x} cy={traced.cursor.y} r="6" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2.5" />
          {state.flags.measures && <Caption at={{ x: object.center.x, y: bounds.maxY + 44 }}>{fmt(traced.length / PERIMETER_UNIT)} / {fmt(traced.total / PERIMETER_UNIT)} u</Caption>}
        </g>}
        {state.flags.measures && <>
          {polygonSegments(vertices).map((edge, index) => <Caption key={index} at={{ x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 - 10 }}>{fmt(distance(edge.a, edge.b) / PERIMETER_UNIT)} u</Caption>)}
          <Caption at={{ x: object.center.x, y: bounds.maxY + 23 }}>P = {fmt(perimeterLength(object) / PERIMETER_UNIT)} u</Caption>
        </>}
        {(straight > 0 || api.operation === "perimeter" && state.params.active === object.id) && <Caption at={{ x: object.center.x, y: bounds.minY - 22 }}>{textFor(t(`材料 ${object.id + 1}`, `Shape ${object.id + 1}`), api.locale)}</Caption>}
      </g>;
    })}
    <BoundaryComparison state={state} api={api} />
  </>,
  drag: (start, target, point, delta, context) => {
    const parsed = parseConstructionTarget(target);
    const object = parsed?.type === "edge" && parsed.id !== undefined ? constructionObject(start, parsed.id) : null;
    const dragTarget = !start.flags.edit && object && parsed?.part !== undefined && parsed.part < object.vertices.length ? `object.${object.id}` : target;
    return syncPerimeterGeometry(start, base.drag!(start, dragTarget, point, delta, context));
  },
  summary: (state, locale) => textFor(t(`${constructionObjects(state).length} 个周长材料`, `${constructionObjects(state).length} perimeter shapes`), locale),
};
