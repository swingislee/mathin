import type { ReactNode } from "react";
import type { PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { add, distance, polygonRegion, regionArea, regionBounds, regionEdges, regionPath, regionPerimeter, transformRegion, type Point } from "./geometry";
import { circleIntersections } from "./intersections";
import { activateCurveMaterial, addCurveMaterial, addSquareForCircle, assignCurvePair, createCurveGeometry, createCurveOverlapState, curveMaterial, curveMaterials, curveOverlapModel, curveTarget, curveWorldRegion, dragCurveMaterial, duplicateCurveMaterial, extractCurveRegion, extractLeafSegments, interpolateCurvePose, moveCurveAside, reflectCurveMaterial, removeCurveMaterial, returnCurveMaterial, rotateCurveMaterial, setCurveField, splitCurveComponents, toggleCurveReference } from "./model";
import { CURVE_BOUND, CURVE_LIMIT, CURVE_RADIUS_MAX, CURVE_RADIUS_MIN, CURVE_SCENE, type CurveMaterial } from "./state";
import { isValidCurveOverlapState } from "./validation";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const names = [t("原材料", "Original materials"), t("交集 A∩B", "Intersection A∩B"), t("并集 A∪B", "Union A∪B"), t("差集 A−B", "Difference A−B"), t("差集 B−A", "Difference B−A")];
const materials = [
  ["circle", t("圆形纸片", "Circle paper")], ["square", t("正方形起点", "Square starting paper")], ["triangle", t("三角形纸片", "Triangle paper")], ["concave", t("L 形凹纸片", "Concave L paper")],
  ["leaf", t("叶形两圆对照", "Two-circle leaf reference")], ["outer", t("方中圆对照", "Circle in a square")], ["inner", t("圆中方对照", "Square in a circle")],
] as const;
const colors = ["var(--moon)", "var(--leaf)", "var(--cheek)", "var(--crater)"];
const fmt = (value: number) => value !== 0 && Math.abs(value) < .01 ? value.toPrecision(4) : Number(value.toFixed(2)).toString();
const absent = (state: PlanarState) => !curveMaterial(state);
const notPolygon = (state: PlanarState) => curveMaterial(state)?.kind !== 0;
const notCircle = (state: PlanarState) => curveMaterial(state)?.kind !== 1;
const field = (key: string, label: PlanarText, min: number, max: number, read: (state: PlanarState) => number, disabled = absent): PlanarField => ({ key, label, min, max, read, disabled });
const action = (id: string, icon: PlanarAction["icon"], label: PlanarText, run: (state: PlanarState) => PlanarState, duration?: number): PlanarAction => ({
  id, icon, label, run: (state) => run(state), disabled: (state) => run(state) === state, ...(duration ? { duration, interpolate: interpolateCurvePose } : {}),
});
const worldPoint = (material: CurveMaterial, point: Point) => {
  const angle = material.angle * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return add(material.origin, { x: c * point.x * material.flip - s * point.y, y: s * point.x * material.flip + c * point.y });
};
function Caption({ at, children }: { at: Point; children: ReactNode }) {
  return <text x={at.x} y={at.y} textAnchor="middle" fontSize="15" fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">{children}</text>;
}
function Handle({ at, target, label, api, active = false }: { at: Point; target: string; label: PlanarText; api: PlanarDrawingApi; active?: boolean }) {
  return <g {...api.bind(target, textFor(label, api.locale))} data-curve-handle={target} style={{ cursor: "grab" }}>
    <circle cx={at.x} cy={at.y} r="16" fill="transparent" /><circle cx={at.x} cy={at.y} r="5" fill={active ? "var(--rose)" : "var(--paper)"} stroke="var(--rose)" strokeWidth="2" />
  </g>;
}
function Guides({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const model = curveOverlapModel(state), a = curveMaterial(state, state.params.pairA), b = curveMaterial(state, state.params.pairB);
  const chord = model && a?.kind === 1 && b?.kind === 1 ? circleIntersections(model.a.loops[0][0].circle!, model.b.loops[0][0].circle!) : [];
  return <g pointerEvents="none" data-curve-guides>
    {curveMaterials(state).filter((material) => material.kind === 1).map((material) => {
      const circle = curveWorldRegion(material).loops[0][0].circle!, endpoint = worldPoint(material, { x: circle.radius, y: 0 });
      return <g key={material.id}><circle cx={circle.center.x} cy={circle.center.y} r="3" fill="var(--muted)" /><line x1={circle.center.x} y1={circle.center.y} x2={endpoint.x} y2={endpoint.y} stroke="var(--muted)" strokeDasharray="5 4" />
        {state.flags.measures && <Caption at={{ x: (circle.center.x + endpoint.x) / 2, y: (circle.center.y + endpoint.y) / 2 - 10 }}>r = {fmt(circle.radius)} u</Caption>}</g>;
    })}
    {chord.length === 2 && <><line data-curve-common-chord x1={chord[0].x} y1={chord[0].y} x2={chord[1].x} y2={chord[1].y} stroke="var(--rose)" strokeWidth="1.5" strokeDasharray="6 4" />
      <Caption at={{ x: (chord[0].x + chord[1].x) / 2, y: (chord[0].y + chord[1].y) / 2 - 12 }}>{textFor(t("公共弦", "Common chord"), api.locale)}</Caption></>}
  </g>;
}

export const planeCurveOverlapScene: PlanarSceneDefinition = {
  id: CURVE_SCENE, toolId: "plane-overlap", title: t("重叠、圆弧与区域", "Overlaps, circular arcs and regions"),
  description: t("添加或自绘圆和凹凸纸片，指定 A/B 后观察真实交并差。复制曲边区域、沿弦拆叶形或直线剪开纸片，继续独立移动与拼合。", "Add or draw circles and concave or convex papers, then assign A/B to inspect their true regions. Copy curved regions, split a leaf along its chord, or cut a paper and move the pieces independently."),
  create: createCurveOverlapState, isExact: isValidCurveOverlapState,
  materials: materials.map(([id, label]) => ({ id: `curves-add-${id}`, label, group: t("添加到当前舞台", "Add to the current stage"),
    preview: <svg viewBox="0 0 80 58" width="72" height="52" aria-hidden="true" focusable="false">
      {id === "triangle" ? <path d="M10 48L70 48L28 8Z" fill="var(--moon)" stroke="currentColor" />
        : id === "concave" ? <path d="M10 8H68V26H30V50H10Z" fill="var(--moon)" stroke="currentColor" />
          : id === "square" ? <rect x="17" y="7" width="44" height="44" fill="var(--moon)" stroke="currentColor" />
            : <><circle cx={id === "leaf" ? 29 : 40} cy="29" r="22" fill="var(--moon)" fillOpacity=".7" stroke="currentColor" />
              {id === "leaf" && <circle cx="50" cy="29" r="22" fill="var(--leaf)" fillOpacity=".6" stroke="currentColor" />}
              {id === "outer" && <rect x="18" y="7" width="44" height="44" fill="none" stroke="currentColor" />}
              {id === "inner" && <path d="M40 7L62 29L40 51L18 29Z" fill="none" stroke="currentColor" />}</>}
    </svg>, add: (state) => addCurveMaterial(state, id), disabled: (state) => addCurveMaterial(state, id) === state })),
  fields: [
    field("x", t("位置 X（u）", "Position X (u)"), -CURVE_BOUND, CURVE_BOUND, (state) => curveMaterial(state)?.origin.x ?? 0),
    field("y", t("位置 Y（u）", "Position Y (u)"), -CURVE_BOUND, CURVE_BOUND, (state) => curveMaterial(state)?.origin.y ?? 0),
    field("angle", t("整体方向（°）", "Orientation (°)"), -180, 180, (state) => curveMaterial(state)?.angle ?? 0),
    field("radius", t("圆半径（u）", "Circle radius (u)"), CURVE_RADIUS_MIN, CURVE_RADIUS_MAX, (state) => curveMaterial(state)?.region.loops[0][0].circle?.radius ?? 0, notCircle),
    field("width", t("纸片本地宽（u）", "Paper local width (u)"), 1, 8000, (state) => curveMaterial(state) ? regionBounds(curveMaterial(state)!.region).width : 0, notPolygon),
    field("height", t("纸片本地高（u）", "Paper local height (u)"), 1, 8000, (state) => curveMaterial(state) ? regionBounds(curveMaterial(state)!.region).height : 0, notPolygon),
  ],
  toggles: [{ key: "guides", label: t("圆心、半径与公共弦", "Centers, radii and common chord") }, { key: "ghost", label: t("材料原位轮廓", "Material home outlines") }],
  actions: [
    action("curves-copy", "duplicate", t("复制当前材料", "Copy current material"), duplicateCurveMaterial),
    action("curves-remove", "remove", t("移除当前材料", "Remove current material"), removeCurveMaterial),
    { ...action("curves-reference", "mark", t("当前材料仅作参照轮廓", "Use current material as an outline reference"), toggleCurveReference), active: (state) => !!curveMaterial(state)?.reference },
    { id: "curves-edit", icon: "editShape", label: t("编辑直边纸片顶点", "Edit straight-paper vertices"), disabled: notPolygon, active: (state) => state.flags.edit,
      run: (state) => ({ ...state, flags: { ...state.flags, edit: !state.flags.edit } }) },
  ],
  operations: [
    { id: "curves-regions", icon: "compareContents", label: t("观察与取出 A/B 区域", "Inspect and extract A/B regions"),
      fields: [{ key: "region", label: t("观察区域", "Region to inspect"), min: 0, max: 4, step: 1, options: names.map((label, value) => ({ value, label })), disabled: (state) => !curveOverlapModel(state) }],
      actions: [
        ...(["pairA", "pairB"] as const).map((slot): PlanarAction => ({ id: `curves-${slot}`, icon: "select", label: t(`当前材料作为 ${slot.at(-1)}`, `Use current material as ${slot.at(-1)}`),
          run: (state) => assignCurvePair(state, slot), disabled: (state) => absent(state) || state.params.active === state.params[slot === "pairA" ? "pairB" : "pairA"], active: (state) => state.params.active >= 0 && state.params.active === state.params[slot] })),
        action("curves-extract", "extractContents", t("复制所示区域为独立纸片，原片留轮廓", "Copy the shown region as papers; retain source outlines"), extractCurveRegion),
        action("curves-leaf", "cut", t("沿公共弦复制叶形两弓片，原圆留轮廓", "Copy two leaf segments along the common chord; retain circle outlines"), extractLeafSegments),
      ] },
    { id: "curves-move", icon: "move", label: t("移动、转动与复位", "Move, rotate and return"), actions: [
      action("curves-aside", "separate", t("移开当前纸片", "Move current paper aside"), moveCurveAside, 900),
      action("curves-turn", "rotate", t("当前材料转过 90°", "Rotate current material by 90°"), rotateCurveMaterial, 900),
      action("curves-mirror", "mirror", t("翻转当前材料", "Reflect current material"), reflectCurveMaterial),
      action("curves-return", "recenter", t("材料位置与方向复位", "Return material position and orientation"), returnCurveMaterial, 1000),
    ] },
    { id: "curves-cut", icon: "cut", label: t("用直线剪开当前材料", "Cut current material along a straight line"), constructionTool: "cut",
      actions: [action("curves-components", "ungroup", t("拆成独立连通片", "Separate connected components"), splitCurveComponents)] },
    { id: "curves-square", icon: "dimensions", label: t("为当前圆添加准确正方形", "Add an exact square for the current circle"), actions: [
      action("curves-outer-square", "add", t("添外切正方形并指定方−圆", "Add a circumscribed square and assign square−circle"), (state) => addSquareForCircle(state, false)),
      action("curves-inner-square", "add", t("添内接正方形并指定圆−方", "Add an inscribed square and assign circle−square"), (state) => addSquareForCircle(state, true)),
    ] },
    { id: "curves-vertices", icon: "editShape", label: t("准确修改直边纸片顶点", "Set straight-paper vertices precisely"), fields: [
      { key: "vertex", label: t("顶点序号（从 0 开始）", "Vertex index (from 0)"), min: 0, max: 31, step: 1, disabled: notPolygon },
      field("vertexX", t("本地顶点 X（u）", "Local vertex X (u)"), -CURVE_BOUND, CURVE_BOUND, (state) => curveMaterial(state)?.region.loops[0][state.params.vertex]?.a.x ?? 0, notPolygon),
      field("vertexY", t("本地顶点 Y（u）", "Local vertex Y (u)"), -CURVE_BOUND, CURVE_BOUND, (state) => curveMaterial(state)?.region.loops[0][state.params.vertex]?.a.y ?? 0, notPolygon),
    ] },
  ],
  construction: { maxPoints: 32, tools: [
    { id: "circle", kind: "drag", label: t("定圆心拖半径", "Draw a circle from its center") },
    { id: "rectangle", kind: "drag", label: t("画长方形纸片", "Draw rectangular paper") },
    { id: "polygon", kind: "points", label: t("画凹凸多边形纸片", "Draw concave or convex paper"), hint: t("沿真实边界依次取点并闭合。", "Choose points along the real boundary and close it.") },
    { id: "cut", kind: "drag", label: t("直线剪开当前材料", "Cut current material with a straight line"), once: true, disabled: absent },
  ], create: createCurveGeometry,
  preview: (tool, points) => {
    if (!points.length) return null;
    const end = points.at(-1)!;
    if (tool === "circle") return <circle cx={points[0].x} cy={points[0].y} r={distance(points[0], end)} fill="none" stroke="var(--rose)" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none" />;
    const region = tool === "rectangle" && points.length >= 2 ? polygonRegion([points[0], { x: end.x, y: points[0].y }, end, { x: points[0].x, y: end.y }]) : null;
    return region ? <path d={regionPath(region)} fill="none" stroke="var(--rose)" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none" />
      : <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--rose)" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none" />;
  }, invalidHint: t("围出不自交的纸片或有效圆；剪线须分出两侧。最多 16 份材料，超出边界或容量时保留原现场。", "Enclose a simple paper or valid circle; a cut must leave both sides. Use up to 16 materials; unsupported geometry or capacity leaves the stage unchanged.") },
  setField: setCurveField, drag: dragCurveMaterial,
  tap: (state, target) => { const parsed = curveTarget(target); return parsed ? activateCurveMaterial(state, parsed.id, parsed.vertex) : state; },
  selectionAfterChange: (before, after, selected) => after.params.active !== before.params.active ? after.params.active < 0 ? null : `curve.${after.params.active}` : selected,
  contextActions: (state, selected) => {
    const parsed = selected && curveTarget(selected), material = parsed ? curveMaterial(state, parsed.id) : null;
    return material ? { bounds: regionBounds(curveWorldRegion(material)), items: [
      { kind: "operation", id: "curves-regions" }, { kind: "operation", id: "curves-cut" }, { kind: "operation", id: "curves-move" },
      { kind: "action", id: "curves-copy" }, { kind: "action", id: "curves-edit" },
    ] } : null;
  },
  draw: (state, api) => {
    const model = curveOverlapModel(state), mode = state.params.region, selected = api.selected && curveTarget(api.selected);
    return <g data-plane-overlap="curves">
      {curveMaterials(state).map((material) => {
        const world = curveWorldRegion(material), bounds = regionBounds(world), selectedHere = selected && selected.id === material.id;
        const reference = material.reference || mode > 0 && (state.params.pairA === material.id || state.params.pairB === material.id);
        const slot = state.params.pairA === material.id ? "A · " : state.params.pairB === material.id ? "B · " : "";
        const localBounds = regionBounds(material.region), rotateAt = worldPoint(material, { x: 0, y: localBounds.minY - 40 });
        return <g key={material.id} data-curve-material={material.id}>
          {state.flags.ghost && <path data-curve-home d={regionPath(transformRegion(material.region, material.home, 0, material.flip))} fill="none" stroke="var(--muted)" strokeDasharray="5 5" strokeOpacity=".5" pointerEvents="none" />}
          <path {...api.bind(`curve.${material.id}`, textFor(t(`材料 ${material.id + 1}`, `Material ${material.id + 1}`), api.locale))}
            data-curve-body d={regionPath(world)} fill={reference ? "transparent" : colors[material.id % colors.length]} fillOpacity=".72" fillRule="nonzero"
            stroke={selectedHere ? "var(--rose)" : "var(--ink)"} strokeWidth={selectedHere ? 2.5 : 1.6} style={{ cursor: api.editable ? "grab" : undefined }} />
          <Caption at={{ x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY - 13 }}>{slot}{material.id + 1}</Caption>
          {state.flags.measures && <Caption at={{ x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY + 20 }}>S {fmt(regionArea(material.region))} u² · P {fmt(regionPerimeter(material.region))} u</Caption>}
          {api.editable && selectedHere && <>
            {material.kind === 1 && <Handle at={worldPoint(material, { x: material.region.loops[0][0].circle!.radius, y: 0 })} target={`curve.${material.id}.radius`} label={t("调整圆半径", "Adjust circle radius")} api={api} />}
            {material.kind === 0 && state.flags.edit && regionEdges(material.region).map((edge, index) => <Handle key={index} at={worldPoint(material, edge.a)} target={`curve.${material.id}.vertex.${index}`} label={t(`顶点 ${index}`, `Vertex ${index}`)} api={api} active={state.params.vertex === index} />)}
            {api.operation === "curves-move" && <><line x1={material.origin.x} y1={material.origin.y} x2={rotateAt.x} y2={rotateAt.y} stroke="var(--muted)" strokeDasharray="4 4" pointerEvents="none" />
              <Handle at={rotateAt} target={`curve.${material.id}.rotate`} label={t("绕材料中心转动", "Rotate around the material center")} api={api} /></>}
          </>}
        </g>;
      })}
      {model && mode > 0 && <path data-curve-result={mode} d={regionPath(model.regions[mode])} fill="var(--rose)" fillOpacity=".55" fillRule="nonzero" stroke="none" pointerEvents="none" />}
      {state.flags.guides && <Guides state={state} api={api} />}
      <text x="38" y="654" fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" fontSize="15" pointerEvents="none">A: {state.params.pairA < 0 ? "—" : state.params.pairA + 1} · B: {state.params.pairB < 0 ? "—" : state.params.pairB + 1} · {textFor(names[mode], api.locale)}</text>
      {model && state.flags.measures && <text data-curve-region-measures x="38" y="682" fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" fontSize="14" pointerEvents="none">A∩B {fmt(model.intersectionArea)} · A∪B {fmt(model.unionArea)} · A−B {fmt(model.differenceArea)} · B−A {fmt(model.reverseDifferenceArea)} u²</text>}
    </g>;
  },
  summary: (state, locale) => `${curveMaterials(state).length}/${CURVE_LIMIT} ${textFor(t("份材料", "materials"), locale)} · ${textFor(names[state.params.region], locale)}`,
};
