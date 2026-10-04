import type { ReactNode, SVGProps } from "react";
import type { PlanarPoint, PlanarState, PlanarToolId } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField, type PlanarMaterial, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { LifeDetails } from "../plane-shapes/scene";
import {
  CONSTRUCTION_PRESETS, MAX_CONSTRUCTION_OBJECTS, MAX_OBJECT_VERTICES,
  addConstruction, addPreset, constructionBounds, constructionCorners, constructionDimensions, constructionLifeMatrix, constructionMatrix, constructionMeasurements,
  constructionObject, constructionObjects, constructionShapeKind, createConstructionState, duplicateConstruction,
  insertConstructionVertex, interpolateConstruction, moveConstruction, parseConstructionTarget, removeConstruction,
  removeConstructionVertex, setConstructionField, tapConstruction, toggleConstructionFlag,
  transformConstruction, worldVertices, type ConstructionObject, type ConstructionTool,
} from "./model";
import {
  constructionCorrespondences, constructionMotionOrigin, constructionRepeatParts, dragConstructionMotion,
  interpolateConstructionRepeat, parseConstructionMotionTarget, repeatConstruction, setConstructionRepeatParts, snapConstructionMotion,
} from "./motion";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const colors = ["var(--leaf)", "var(--moon)", "var(--cheek)", "var(--crater)"];
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const transform = (object: ConstructionObject) => `matrix(${constructionMatrix(object).join(" ")})`;
const selectedId = (target: string | null) => target ? parseConstructionMotionTarget(target)?.id ?? parseConstructionTarget(target)?.id : undefined;
const shapeLabels = { triangle: t("三角形", "Triangle"), square: t("正方形", "Square"), rectangle: t("长方形", "Rectangle"),
  circle: t("圆", "Circle"), ellipse: t("椭圆", "Ellipse"), rhombus: t("菱形", "Rhombus"),
  parallelogram: t("平行四边形", "Parallelogram"), trapezoid: t("梯形", "Trapezoid"), quadrilateral: t("四边形", "Quadrilateral"), polygon: t("多边形", "Polygon") };
const lifeLabels = [t("路牌正面", "Sign face"), t("窗框外轮廓", "Window outline"), t("门板正面", "Door panel face"), t("钟面", "Clock face"), t("镜面", "Mirror surface")];
const objectLabel = (object: ConstructionObject): PlanarText => {
  const shape = shapeLabels[constructionShapeKind(object)], life = lifeLabels[object.life - 1];
  return life ? t(`${life.zh} → ${shape.zh}`, `${life.en} → ${shape.en}`) : shape;
};
const noObject = (state: PlanarState) => !constructionObject(state);
const isConstructionTool = (id: string): id is ConstructionTool => ["rectangle", "circle", "ellipse", "polygon"].includes(id);

function Outline({ object, ...props }: { object: ConstructionObject } & SVGProps<SVGElement>) {
  if (object.kind <= 1) return <polygon points={coordinates(object.vertices)} {...props as SVGProps<SVGPolygonElement>} />;
  if (object.kind === 2) return <circle r={object.rx} {...props as SVGProps<SVGCircleElement>} />;
  return <ellipse rx={object.rx} ry={object.ry} {...props as SVGProps<SVGEllipseElement>} />;
}
function Caption({ at, children, size = 16 }: { at: PlanarPoint; children: ReactNode; size?: number }) {
  return <text x={at.x} y={at.y} textAnchor="middle" fontSize={size} fill="var(--ink)" stroke="var(--paper)" strokeWidth="5" paintOrder="stroke" pointerEvents="none">{children}</text>;
}
function localPoint(object: ConstructionObject, point: PlanarPoint): PlanarPoint {
  const [a, b, c, d, x, y] = constructionMatrix(object);
  return { x: a * point.x + c * point.y + x, y: b * point.x + d * point.y + y };
}
function LifeIllustration({ object }: { object: ConstructionObject }) {
  if (!object.life || object.detail <= 0) return null;
  return <g transform={`matrix(${constructionLifeMatrix(object).join(" ")})`}><LifeDetails kind={object.life + 6} detail={object.detail} /></g>;
}
function ObjectDrawing({ object, ghost = false }: { object: ConstructionObject; ghost?: boolean }) {
  return <>
    <g transform={transform(object)}><Outline object={object} fill={ghost ? "none" : colors[object.id % colors.length]} fillOpacity={ghost ? undefined : object.life ? 0.25 : 0.65} stroke={ghost ? "var(--muted)" : "var(--ink)"} strokeWidth={ghost ? 1.3 : 2.5} strokeDasharray={ghost ? "5 5" : undefined} strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></g>
    {!ghost && <LifeIllustration object={object} />}
  </>;
}
function EditingHandle({ target, at, api, label }: { target: string; at: PlanarPoint; api: PlanarDrawingApi; label: PlanarText }) {
  return <g {...api.bind(target, textFor(label, api.locale))} data-construction-edit-handle={target} style={{ cursor: "grab" }}>
    <circle cx={at.x} cy={at.y} r="17" fill="transparent" />
    <rect x={at.x - 5} y={at.y - 5} width="10" height="10" rx="2" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" pointerEvents="none" />
  </g>;
}
function Observations({ state, object, api, editing }: { state: PlanarState; object: ConstructionObject; api: PlanarDrawingApi; editing: boolean }) {
  const vertices = worldVertices(object), corners = constructionCorners(object);
  const boundary = editing ? vertices.map((point, index) => ({ point, index })) : corners;
  return <g data-construction-observations={object.id}>
    {(state.flags.edges || editing) && (boundary.length ? boundary.map(({ point: a, index }, ordinal) => {
      const b = boundary[(ordinal + 1) % boundary.length].point, target = `edge.${object.id}.${index}`, marked = state.marks.includes(target);
      return <g key={target} {...api.bind(target, textFor(t(`边 ${ordinal + 1}`, `Side ${ordinal + 1}`), api.locale))}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="24" pointerEvents="stroke" />
        {marked && <line data-construction-highlight="edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--rose)" strokeWidth="4" strokeLinecap="round" pointerEvents="none" />}
      </g>;
    }) : <g transform={transform(object)} {...api.bind(`boundary.${object.id}`, textFor(t("点亮曲线边界", "Highlight curved boundary"), api.locale))}>
      <Outline object={object} fill="none" stroke="transparent" strokeWidth="24" pointerEvents="stroke" vectorEffect="non-scaling-stroke" />
      {state.marks.includes(`boundary.${object.id}`) && <Outline data-construction-highlight="boundary" object={object} fill="none" stroke="var(--rose)" strokeWidth="4" pointerEvents="none" vectorEffect="non-scaling-stroke" />}
    </g>)}
    {state.flags.vertices && !editing && corners.map(({ point: at, index }, ordinal) => {
      const target = `vertex.${object.id}.${index}`, marked = state.marks.includes(target);
      return <g key={target} {...api.bind(target, textFor(t(`顶点 ${ordinal + 1}`, `Vertex ${ordinal + 1}`), api.locale))}>
        <circle cx={at.x} cy={at.y} r="17" fill="transparent" />
        <circle data-construction-highlight={marked ? "vertex" : undefined} cx={at.x} cy={at.y} r={marked ? 6 : 3.5} fill={marked ? "var(--rose)" : "var(--paper)"} stroke={marked ? "var(--rose-deep)" : "var(--muted)"} strokeWidth="1.7" pointerEvents="none" />
      </g>;
    })}
    {editing && (vertices.length ? vertices.map((at, index) => <EditingHandle key={index} target={`vertex.${object.id}.${index}`} at={at} api={api} label={t(`编辑点 ${index + 1}`, `Edit point ${index + 1}`)} />) : <>
      <EditingHandle target={`radius-x.${object.id}`} at={localPoint(object, { x: object.rx, y: 0 })} api={api} label={t(object.kind === 2 ? "调整半径" : "调整横向半轴", object.kind === 2 ? "Adjust radius" : "Adjust horizontal radius")} />
      <EditingHandle target={`radius-y.${object.id}`} at={localPoint(object, { x: 0, y: object.ry })} api={api} label={t(object.kind === 2 ? "调整半径" : "调整纵向半轴", object.kind === 2 ? "Adjust radius" : "Adjust vertical radius")} />
    </>)}
  </g>;
}
function OperationGuides({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  if (api.operation === "rotate") {
    const pivot = state.points.pivot, object = state.sceneId === "20-create" ? constructionObject(state) : null;
    const bounds = object ? constructionBounds(object) : null;
    const distance = object ? Math.hypot(object.center.x - pivot.x, object.center.y - pivot.y) : 0;
    const angle = object ? distance > 20 ? Math.atan2(object.center.y - pivot.y, object.center.x - pivot.x) : object.angle * Math.PI / 180 : 0;
    const radius = Math.max(65, distance, bounds ? Math.max(bounds.width, bounds.height) / 2 + 30 : 0);
    const handle = { x: pivot.x + radius * Math.cos(angle), y: pivot.y + radius * Math.sin(angle) };
    return <g data-construction-guide="rotate"><EditingHandle target="pivot" at={pivot} api={api} label={t("拖动旋转中心", "Move rotation center")} />
      <g pointerEvents="none" stroke="var(--rose)" strokeWidth="1.5"><line x1={pivot.x - 11} y1={pivot.y} x2={pivot.x + 11} y2={pivot.y} /><line x1={pivot.x} y1={pivot.y - 11} x2={pivot.x} y2={pivot.y + 11} /></g>
      {object && <><line x1={pivot.x} y1={pivot.y} x2={handle.x} y2={handle.y} stroke="var(--rose)" strokeWidth="1.2" strokeDasharray="5 5" pointerEvents="none" /><EditingHandle target={`motion-rotate.${object.id}`} at={handle} api={api} label={t("抓住手柄绕旋转中心转动当前图形", "Turn the current shape around the pivot")} /></>}
    </g>;
  }
  if (api.operation === "reflect") {
    const pivot = state.points.axis, angle = state.params.axisAngle * Math.PI / 180, direction = { x: Math.cos(angle), y: Math.sin(angle) };
    return <g data-construction-guide="reflect">
      <g {...api.bind("axis", textFor(t("搬动对称轴", "Move reflection axis"), api.locale))} style={{ cursor: "grab" }}>
        <line x1={pivot.x - 340 * direction.x} y1={pivot.y - 340 * direction.y} x2={pivot.x + 340 * direction.x} y2={pivot.y + 340 * direction.y} stroke="transparent" strokeWidth="25" />
        <line x1={pivot.x - 340 * direction.x} y1={pivot.y - 340 * direction.y} x2={pivot.x + 340 * direction.x} y2={pivot.y + 340 * direction.y} stroke="var(--rose)" strokeWidth="1.5" strokeDasharray="7 5" pointerEvents="none" />
      </g>
      <EditingHandle target="axis-handle" at={{ x: pivot.x + 220 * direction.x, y: pivot.y + 220 * direction.y }} api={api} label={t("转动对称轴", "Turn reflection axis")} />
    </g>;
  }
  return null;
}

function Correspondences({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  if (state.sceneId !== "20-create" || !state.flags.ghost || !state.flags.vertices) return null;
  const id = selectedId(api.selected) ?? state.params.active;
  if (!constructionObject(state, id)) return null;
  let before = constructionMotionOrigin(state) ?? api.ghostState, after = state, planned = false;
  let pairs = before ? constructionCorrespondences(before, after, id) : [];
  if (!pairs.length) {
    const operation = api.operation === "move" ? "translate" : api.operation === "rotate" ? "rotate" : api.operation === "reflect" ? "reflect" : null;
    if (!operation) return null;
    before = { ...state, params: { ...state.params, active: id } };
    after = transformConstruction(before, operation); pairs = constructionCorrespondences(before, after, id); planned = true;
  }
  if (!pairs.length) return null;
  return <g data-construction-correspondences={planned ? "planned" : "actual"} pointerEvents="none">
    {planned && <g data-construction-target-outline={id}><ObjectDrawing object={constructionObject(after, id)!} ghost /></g>}
    {pairs.map((pair) => <g key={pair.label} data-construction-correspondence={pair.label}>
      <line x1={pair.from.x} y1={pair.from.y} x2={pair.to.x} y2={pair.to.y} stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="4 4" />
      <circle cx={pair.from.x} cy={pair.from.y} r="3" fill="var(--paper)" stroke="var(--muted)" strokeWidth="1.5" />
      <circle cx={pair.to.x} cy={pair.to.y} r="4" fill="var(--rose)" />
      <Caption at={{ x: pair.from.x - 12, y: pair.from.y - 11 }} size={12}>{pair.label}</Caption>
      <Caption at={{ x: pair.to.x + 12, y: pair.to.y + 19 }} size={12}>{pair.label}′</Caption>
    </g>)}
  </g>;
}

function drawConstruction(state: PlanarState, api: PlanarDrawingApi) {
  const selected = selectedId(api.selected);
  const origin = constructionMotionOrigin(state) ?? api.ghostState;
  const motion = state.sceneId === "20-create" ? api.operation === "move" ? "translate" : api.operation === "rotate" || api.operation === "reflect" ? api.operation : null : null;
  const ghosts = state.flags.ghost && origin ? constructionObjects(origin).filter((before) => {
    const current = constructionObject(state, before.id);
    return current && JSON.stringify({ ...before, detail: 0 }) !== JSON.stringify({ ...current, detail: 0 });
  }) : [];
  return <>
    {ghosts.map((object) => <g key={object.id} data-construction-ghost={object.id} pointerEvents="none"><ObjectDrawing object={object} ghost /></g>)}
    {constructionObjects(state).map((object) => {
      const chosen = selected === object.id, editing = state.flags.edit && chosen && !motion;
      const target = motion ? `motion-${motion}.${object.id}` : `object.${object.id}`;
      const objectApi = motion ? { ...api, bind: (_target: string, label?: string) => api.bind(target, label) } : api;
      const bounds = constructionBounds(object), measurements = state.flags.measures || state.flags.counts ? constructionMeasurements(object) : null;
      const captions: ReactNode[] = [];
      if (state.flags.names) captions.push(textFor(objectLabel(object), api.locale));
      if (state.flags.counts && measurements) captions.push(api.locale === "en" ? `${measurements.straightEdges} straight sides · ${measurements.vertices} vertices` : `${measurements.straightEdges} 条直边 · ${measurements.vertices} 个顶点`);
      if (state.flags.measures && measurements) captions.push(api.locale === "en" ? `Perimeter ${measurements.perimeterApproximate ? "≈ " : ""}${measurements.perimeter.toFixed(1)} u · Area ${measurements.area.toFixed(1)} u²` : `周长${measurements.perimeterApproximate ? "约 " : " "}${measurements.perimeter.toFixed(1)} u · 面积 ${measurements.area.toFixed(1)} u²`);
      return <g key={object.id} data-construction-object={object.id}>
        <g data-construction-body={target} {...api.bind(target, textFor(objectLabel(object), api.locale))} style={{ cursor: "grab" }}>
          <ObjectDrawing object={object} />
          {chosen && <g transform={transform(object)}><Outline object={object} fill="none" stroke="var(--rose)" strokeWidth="1.4" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" pointerEvents="none" /></g>}
        </g>
        <Observations state={state} object={object} api={objectApi} editing={editing} />
        {captions.map((caption, index) => <Caption key={index} at={{ x: object.center.x, y: bounds.maxY + 27 + index * 23 }}>{caption}</Caption>)}
      </g>;
    })}
    <Correspondences state={state} api={api} />
    <OperationGuides state={state} api={api} />
  </>;
}

const toggleAction = (flag: string, icon: PlanarAction["icon"], label: PlanarText): PlanarAction => ({ id: `construction-${flag}`, icon, label, active: (state) => state.flags[flag], run: (state) => toggleConstructionFlag(state, flag) });
const actions: PlanarAction[] = [
  toggleAction("edit", "editShape", t("编辑当前图形", "Edit current shape")),
  toggleAction("edges", "edge", t("观察边界", "Observe boundaries")),
  toggleAction("vertices", "vertex", t("观察顶点", "Observe vertices")),
  toggleAction("counts", "number", t("显示边与顶点数量", "Show side and vertex counts")),
  toggleAction("measures", "measure", t("显示长度与面积", "Show lengths and areas")),
  toggleAction("names", "labels", t("显示图形名称", "Show shape names")),
  { id: "construction-life-outline", icon: "observe", label: t("生活实例：淡化／还原细节", "Everyday object: fade or restore details"), duration: 900,
    disabled: (state) => !constructionObject(state)?.life,
    active: (state) => !!constructionObject(state)?.life && constructionObject(state)!.detail < 0.5,
    run: (state) => { const object = constructionObject(state); return object ? setConstructionField(state, "detail", object.detail > 0.5 ? 0 : 1) : state; },
    interpolate: (from, to, progress) => {
      if (progress >= 1) return to;
      const before = constructionObject(from), after = before ? constructionObject(to, before.id) : null;
      return before && after ? setConstructionField(from, "detail", before.detail + (after.detail - before.detail) * progress) : from;
    } },
  { id: "construction-insert-vertex", icon: "increase", label: t("在选中边上添加编辑点", "Add an edit point to the selected side"),
    disabled: (state, context) => !state.flags.edit || !context.selected?.startsWith("edge.") || insertConstructionVertex(state, context.selected) === state,
    run: (state, context) => context.selected ? insertConstructionVertex(state, context.selected) : state },
  { id: "construction-remove-vertex", icon: "decrease", label: t("移去选中编辑点", "Remove selected edit point"),
    disabled: (state, context) => !state.flags.edit || !context.selected?.startsWith("vertex.") || removeConstructionVertex(state, context.selected) === state,
    run: (state, context) => context.selected ? removeConstructionVertex(state, context.selected) : state },
  { id: "construction-duplicate", icon: "duplicate", label: t("复制当前图形", "Duplicate current shape"), disabled: (state) => noObject(state) || duplicateConstruction(state) === state, run: duplicateConstruction },
  { id: "construction-remove", icon: "remove", label: t("移去当前图形", "Remove current shape"), disabled: noObject, run: removeConstruction },
];
const scalar = (key: string, label: PlanarText, min: number, max: number, step = 1): PlanarField => ({ key, label, min, max, step, read: (state) => state.params[key], disabled: noObject });
const auxiliary = (key: "pivot" | "axis", label: PlanarText): PlanarField[] => [
  { key: `${key}X`, label: t(`${label.zh} X`, `${label.en} X`), min: -1000, max: 2000, step: 1, read: (state) => state.points[key].x, disabled: noObject },
  { key: `${key}Y`, label: t(`${label.zh} Y`, `${label.en} Y`), min: -1000, max: 1720, step: 1, read: (state) => state.points[key].y, disabled: noObject },
];
const operationAction = (operation: "translate" | "rotate" | "reflect", icon: PlanarAction["icon"], label: PlanarText): PlanarAction => ({
  id: `construction-${operation}`, icon, label, duration: 1400, disabled: (state) => noObject(state) || transformConstruction(state, operation) === state,
  run: (state) => transformConstruction(state, operation),
  interpolate: (from, to, progress) => interpolateConstruction(from, to, progress, operation),
});
const operations: NonNullable<PlanarSceneDefinition["operations"]> = [
  { id: "move", icon: "move", label: t("准确平移", "Precise translation"), fields: [scalar("dx", t("向右位移", "Rightward offset"), -600, 600), scalar("dy", t("向下位移", "Downward offset"), -600, 600)], actions: [operationAction("translate", "play", t("播放平移", "Play translation"))] },
  { id: "rotate", icon: "rotate", label: t("绕点旋转", "Rotate around a point"), fields: [...auxiliary("pivot", t("旋转中心", "Pivot")), scalar("turn", t("顺时针转角（°）", "Clockwise turn (°)"), -360, 360)], actions: [operationAction("rotate", "play", t("播放旋转", "Play rotation"))] },
  { id: "reflect", icon: "mirror", label: t("沿轴镜像", "Reflect across an axis"), fields: [...auxiliary("axis", t("对称轴经过点", "Axis point")), scalar("axisAngle", t("对称轴方向（°）", "Axis direction (°)"), -180, 180)], actions: [operationAction("reflect", "mirror", t("翻到对称位置", "Fold to the reflected position"))] },
];
const correspondenceAction: PlanarAction = {
  id: "construction-correspondence", icon: "vertex", label: t("观察变换前后的对应点", "Observe corresponding points before and after a transformation"),
  active: (state) => state.flags.ghost && state.flags.vertices,
  run: (state) => { const value = !(state.flags.ghost && state.flags.vertices); return { ...state, flags: { ...state.flags, ghost: value, vertices: value } }; },
};
const repeatAction: PlanarAction = {
  id: "construction-repeat", icon: "duplicate", label: t("按总份数绕中心生成独立副本（含原片）", "Repeat around the pivot as independent copies (including the original)"),
  disabled: (state) => repeatConstruction(state) === state, run: (state) => repeatConstruction(state), duration: 1600, interpolate: interpolateConstructionRepeat,
};
const motionOperations = operations.map((operation) => ({ ...operation, fields: operation.fields?.map((field) => ({ ...field, step: undefined })) })).map((operation) => operation.id !== "rotate" ? operation : { ...operation,
  fields: [...operation.fields!, { key: "repeatParts", label: t("绕一周的总份数（含原片）", "Total parts around one turn (including the original)"), min: 0, max: MAX_CONSTRUCTION_OBJECTS, step: 1,
    options: [{ value: 0, label: t("按份数设定转角", "Choose parts to set the turn") }, ...Array.from({ length: MAX_CONSTRUCTION_OBJECTS - 1 }, (_, index) => ({ value: index + 2, label: t(`${index + 2} 份`, `${index + 2} parts`) }))],
    read: constructionRepeatParts, disabled: noObject }], actions: [...operation.actions!, repeatAction],
});
function constructionPreview(toolId: string, draft: readonly PlanarPoint[]) {
  if (!isConstructionTool(toolId)) return null;
  const empty = removeConstruction(createConstructionState("01-create")), next = addConstruction(empty, toolId, [...draft]);
  const object = next ? constructionObject(next) : null;
  return <g data-construction-draft="true" pointerEvents="none">
    {object ? <ObjectDrawing object={object} ghost /> : draft.length > 1 ? <polyline points={coordinates(draft)} fill="none" stroke="var(--muted)" strokeWidth="1.3" strokeDasharray="5 5" /> : null}
    {draft.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="3.5" fill="var(--paper)" stroke="var(--rose)" strokeWidth="1.5" />)}
  </g>;
}
const materials: PlanarMaterial[] = CONSTRUCTION_PRESETS.map((preset, index) => {
  const example = constructionObject(addPreset(removeConstruction(createConstructionState("01-create")), index))!;
  return {
    id: `construction-preset-${preset.id}`, label: t(preset.zh, preset.en), group: preset.life ? t("生活实例", "Everyday examples") : t("快捷图形", "Shape shortcuts"),
    preview: <svg viewBox="-175 -175 350 350" width="76" height="76" aria-hidden="true" focusable="false"><ObjectDrawing object={{ ...example, center: { x: 0, y: 0 } }} /></svg>,
    add: (state) => addPreset(state, index), disabled: (state) => constructionObjects(state).length >= MAX_CONSTRUCTION_OBJECTS || addPreset(state, index) === state,
  };
});
/** 材料编辑、选择与变换共享；各教具只补自己的数学观察和操作。 */
export function createConstructionDefinition(sceneId: string, toolId: PlanarToolId, title: PlanarText): PlanarSceneDefinition {
  const motion = sceneId === "20-create";
  return {
    id: sceneId, toolId, title,
    description: t("右侧画图或添加材料；拖动图形摆放，按需开启编辑或运动。", "Draw or add shapes on the right. Drag to arrange, then enable editing or transformations when needed."),
    create: () => createConstructionState(sceneId), materials, actions: motion ? [...actions, correspondenceAction] : actions, operations: motion ? motionOperations : operations,
    selectionAfterChange: (before, after, selected) => {
      if (after.params.active === -1) return null;
      if (before.params.active !== after.params.active) return `object.${after.params.active}`;
      const direct = parseConstructionMotionTarget(selected);
      if (direct) return constructionObject(after, direct.id) ? `object.${direct.id}` : null;
      const target = selected ? parseConstructionTarget(selected) : null;
      if (target?.id !== undefined) {
        const object = constructionObject(after, target.id);
        if (!object) return null;
        if (target.part !== undefined && target.part >= object.vertices.length) return `object.${object.id}`;
      }
      return selected;
    },
    fields: [
      { key: "width", label: t("当前图形宽", "Current shape width"), min: 12, max: 700, step: 1, read: (state) => { const object = constructionObject(state); return object ? constructionDimensions(object).width : 0; }, disabled: noObject },
      { key: "height", label: t("当前图形高", "Current shape height"), min: 12, max: 700, step: 1, read: (state) => { const object = constructionObject(state); return object ? constructionDimensions(object).height : 0; }, disabled: noObject },
      { key: "angle", label: t("当前图形方向（°）", "Current shape orientation (°)"), min: -36000, max: 36000, step: 1, read: (state) => constructionObject(state)?.angle ?? 0, disabled: noObject },
      { key: "detail", label: t("生活实例细节（0–1）", "Everyday details (0–1)"), min: 0, max: 1, step: 0.05, read: (state) => constructionObject(state)?.detail ?? 0, disabled: (state) => !constructionObject(state)?.life },
    ],
    toggles: [{ key: "ghost", label: t("保留上次变换前的轮廓", "Keep the outline before the last transformation") }, { key: "snap", label: t("吸附到网格", "Snap to grid") }],
    construction: {
      tools: [{ id: "rectangle", label: t("长方形", "Rectangle"), kind: "drag" }, { id: "circle", label: t("圆", "Circle"), kind: "drag" }, { id: "ellipse", label: t("椭圆", "Ellipse"), kind: "drag" }, { id: "polygon", label: t("多边形", "Polygon"), kind: "points" }],
      maxPoints: MAX_OBJECT_VERTICES,
      create: (state, toolId, draft) => { if (!isConstructionTool(toolId)) return null; const next = addConstruction(state, toolId, draft); return next === state ? null : next; },
      preview: constructionPreview,
    },
    setField: (state, key, value) => motion && key === "repeatParts" ? setConstructionRepeatParts(state, value) : setConstructionField(state, key, value), setFlag: toggleConstructionFlag, draw: drawConstruction,
    drag: (start, target, point, delta, context) => motion && parseConstructionMotionTarget(target) ? dragConstructionMotion(start, target, point, delta, context?.previous) : moveConstruction(start, target, point, delta),
    tap: (state, target) => { const direct = motion ? parseConstructionMotionTarget(target) : null; return tapConstruction(state, direct ? `object.${direct.id}` : target); },
    ...(motion ? { snap: snapConstructionMotion, contextActions: (state: PlanarState, selected: string | null) => {
      const id = selectedId(selected), object = id === undefined ? null : constructionObject(state, id);
      return object ? { bounds: constructionBounds(object), items: [{ kind: "operation" as const, id: "move" }, { kind: "operation" as const, id: "rotate" }, { kind: "operation" as const, id: "reflect" }, { kind: "action" as const, id: "construction-duplicate" }, { kind: "action" as const, id: "construction-remove" }] } : null;
    } } : {}),
  };
}

export const planeConstructionScenes: PlanarSceneDefinition[] = [
  createConstructionDefinition("01-create", "plane-shapes", t("基本图形认识", "Exploring basic shapes")),
  createConstructionDefinition("20-create", "plane-motion", t("平面图形运动", "Plane transformations")),
];
