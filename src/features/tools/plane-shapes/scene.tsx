import type { ReactNode, SVGProps } from "react";
import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarMaterial, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import {
  MAX_SHAPE_OBJECTS, SHAPE_KINDS, addShapeObject, createPlaneShapesState, duplicateShapeObject, moveShapeObject,
  parseShapeTarget, removeShapeObject, rotateShapeObject, selectShapeTarget, setShapeField, shapeBounds, shapeCounts,
  shapeObject, shapeOutline, shapeVertices, toggleShapeDetail, toggleShapeFlag, type ShapeObject, type ShapeOutline,
} from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const colors = ["var(--leaf)", "var(--moon)", "var(--cheek)", "var(--crater)"];
const points = (vertices: readonly PlanarPoint[]) => vertices.map((point) => `${point.x},${point.y}`).join(" ");
const shapeName = (kind: number, locale: string) => textFor(SHAPE_KINDS[kind], locale);
const basicKind = (kind: number) => ({ 7: 0, 8: 1, 9: 2, 10: 5, 11: 6 })[kind] ?? kind;

function Outline({ outline, ...props }: { outline: ShapeOutline } & SVGProps<SVGElement>) {
  if (outline.type === "polygon") return <polygon points={points(outline.vertices)} {...props as SVGProps<SVGPolygonElement>} />;
  if (outline.type === "circle") return <circle r={outline.rx} {...props as SVGProps<SVGCircleElement>} />;
  return <ellipse rx={outline.rx} ry={outline.ry} {...props as SVGProps<SVGEllipseElement>} />;
}

/** 生活物体细节与被研究的同一个正面轮廓共用局部坐标，淡化时不更换模型。 */
function LifeDetails({ kind, detail }: { kind: number; detail: number }) {
  if (!SHAPE_KINDS[kind].life || detail <= 0) return null;
  let drawing: ReactNode;
  if (kind === 7) drawing = <>
    <polygon points="0,-96 105,87 -105,87" fill="var(--paper)" stroke="var(--rose)" strokeWidth="13" strokeLinejoin="round" />
    <path d="M0,-34V26" stroke="var(--ink)" strokeWidth="10" strokeLinecap="round" />
    <circle cy="48" r="6" fill="var(--ink)" />
  </>;
  if (kind === 8) drawing = <>
    <rect x="-92" y="-92" width="184" height="184" fill="var(--moon)" fillOpacity="0.45" stroke="var(--crater)" strokeWidth="12" />
    <path d="M-92,0H92M0,-92V92" stroke="var(--crater)" strokeWidth="11" />
    <path d="M-76,-23L-26,-74M20,72L72,20" stroke="var(--paper)" strokeWidth="8" strokeLinecap="round" />
  </>;
  if (kind === 9) drawing = <>
    <rect x="-83" y="-133" width="166" height="266" fill="var(--crater)" fillOpacity="0.42" />
    <rect x="-66" y="-116" width="132" height="105" fill="var(--paper)" fillOpacity="0.35" stroke="var(--muted)" strokeWidth="2" />
    <rect x="-66" y="24" width="132" height="98" fill="var(--paper)" fillOpacity="0.35" stroke="var(--muted)" strokeWidth="2" />
    <circle cx="58" cy="6" r="6" fill="var(--ink)" /><path d="M58,6H37" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" />
  </>;
  if (kind === 10) drawing = <>
    <circle r="97" fill="var(--paper)" stroke="var(--crater)" strokeWidth="9" />
    {Array.from({ length: 12 }, (_, i) => {
      const angle = i * Math.PI / 6;
      return <line key={i} x1={Math.sin(angle) * 80} y1={-Math.cos(angle) * 80} x2={Math.sin(angle) * 88} y2={-Math.cos(angle) * 88} stroke="var(--ink)" strokeWidth="2.5" />;
    })}
    <path d="M0,0L-38,-23M0,0L45,-49" fill="none" stroke="var(--ink)" strokeWidth="6" strokeLinecap="round" />
    <circle r="6" fill="var(--rose)" />
  </>;
  if (kind === 11) drawing = <>
    <ellipse rx="85" ry="133" fill="var(--paper)" stroke="var(--crater)" strokeWidth="11" />
    <ellipse rx="76" ry="124" fill="var(--moon)" fillOpacity="0.35" />
    <path d="M-49,34L33,-54M-31,65L48,-20" stroke="var(--paper)" strokeWidth="10" strokeLinecap="round" />
  </>;
  return <g data-life-details={SHAPE_KINDS[kind].id} opacity={detail} pointerEvents="none">{drawing}</g>;
}

function ShapeIllustration({ object }: { object: ShapeObject }) {
  const outline = shapeOutline(object.kind), life = SHAPE_KINDS[object.kind].life;
  return <>
    <Outline outline={outline} fill={life ? "var(--moon)" : colors[object.index % colors.length]} fillOpacity={life ? 0.12 + (1 - object.detail) * 0.44 : 0.7} stroke="var(--ink)" strokeWidth="2.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    <LifeDetails kind={object.kind} detail={object.detail} />
    {life && <Outline outline={outline} fill="none" stroke="var(--leaf-deep)" strokeWidth="3" opacity={1 - object.detail} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
  </>;
}

function Caption({ point, children, size = 17 }: { point: PlanarPoint; children: ReactNode; size?: number }) {
  return <text x={point.x} y={point.y} textAnchor="middle" fontSize={size} fill="var(--ink)" stroke="var(--paper)" strokeWidth="5" strokeLinejoin="round" paintOrder="stroke" pointerEvents="none">{children}</text>;
}

function outward(from: PlanarPoint, center: PlanarPoint, amount: number): PlanarPoint {
  const length = Math.hypot(from.x - center.x, from.y - center.y) || 1;
  return { x: from.x + (from.x - center.x) / length * amount, y: from.y + (from.y - center.y) / length * amount };
}

function observationText(state: PlanarState, object: ShapeObject, locale: string) {
  const counts = shapeCounts(object.kind), en = locale === "en";
  if (counts.curvedBoundary) return en ? "Continuous curve · 0 straight sides · 0 vertices" : "连续曲线 · 0 条直边 · 0 个顶点";
  return [state.flags.edges ? (en ? `${counts.straightEdges} straight sides` : `${counts.straightEdges} 条直边`) : "", state.flags.vertices ? (en ? `${counts.vertices} vertices` : `${counts.vertices} 个顶点`) : ""].filter(Boolean).join(" · ");
}

function ShapeObservation({ state, object, api }: { state: PlanarState; object: ShapeObject; api: PlanarDrawingApi }) {
  const vertices = shapeVertices(object), en = api.locale === "en", transform = `translate(${object.center.x} ${object.center.y}) rotate(${object.angle}) scale(${object.scale})`;
  return <g data-shape-observation={object.index}>
    {state.flags.edges && (vertices.length ? vertices.map((a, part) => {
      const b = vertices[(part + 1) % vertices.length], target = `edge.${object.index}.${part}`, marked = state.marks.includes(target);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return <g key={target} {...api.bind(target, `${shapeName(object.kind, api.locale)} · ${en ? "side" : "边"} ${part + 1}`)} style={{ cursor: "pointer" }}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="24" pointerEvents="stroke" />
        {marked && <>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--rose)" strokeWidth="4" strokeLinecap="round" pointerEvents="none" />
          <Caption point={outward(center, object.center, 24)}>{en ? `s${part + 1}` : `边${part + 1}`}</Caption>
        </>}
      </g>;
    }) : <g transform={transform} {...api.bind(`boundary.${object.index}`, textFor(t("点亮连续曲线轮廓", "Highlight the continuous curved boundary"), api.locale))} style={{ cursor: "pointer" }}>
      <Outline outline={shapeOutline(object.kind)} fill="none" stroke="transparent" strokeWidth="24" pointerEvents="stroke" vectorEffect="non-scaling-stroke" />
      {state.marks.includes(`boundary.${object.index}`) && <Outline outline={shapeOutline(object.kind)} fill="none" stroke="var(--rose)" strokeWidth="4" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    </g>)}
    {state.flags.vertices && vertices.map((at, part) => {
      const target = `vertex.${object.index}.${part}`, marked = state.marks.includes(target);
      return <g key={target} {...api.bind(target, `${shapeName(object.kind, api.locale)} · ${en ? "vertex" : "顶点"} ${part + 1}`)} style={{ cursor: "pointer" }}>
        <circle cx={at.x} cy={at.y} r="18" fill="transparent" />
        <circle cx={at.x} cy={at.y} r={marked ? 6 : 4} fill={marked ? "var(--rose)" : "var(--paper)"} stroke={marked ? "var(--rose-deep)" : "var(--muted)"} strokeWidth="1.8" pointerEvents="none" />
        {marked && <Caption point={outward(at, object.center, 25)}>{en ? `v${part + 1}` : `点${part + 1}`}</Caption>}
      </g>;
    })}
  </g>;
}

function drawShapes(state: PlanarState, api: PlanarDrawingApi) {
  if (!state.params.count) return <Caption point={{ x: 480, y: 360 }}>{textFor(t("从右侧“添加”选择一个图形或生活实例", "Choose a shape or real-life outline with Add on the right"), api.locale)}</Caption>;
  const selected = api.selected ? parseShapeTarget(api.selected) : null;
  return <>{Array.from({ length: state.params.count }, (_, index) => {
    const object = shapeObject(state, index)!, bounds = shapeBounds(object), kind = SHAPE_KINDS[object.kind], active = state.params.active === index;
    const showName = state.flags.names || (kind.life && active), showCount = active && state.flags.measures && (state.flags.edges || state.flags.vertices);
    const name = kind.life ? `${shapeName(object.kind, api.locale)} → ${shapeName(basicKind(object.kind), api.locale)}` : shapeName(object.kind, api.locale);
    return <g key={index} data-shape-object={index} data-shape-kind={kind.id}>
      <g {...api.bind(`object.${index}`, `${index + 1} · ${shapeName(object.kind, api.locale)}`)} transform={`translate(${object.center.x} ${object.center.y}) rotate(${object.angle}) scale(${object.scale})`} style={{ cursor: "grab" }}>
        <ShapeIllustration object={object} />
        {selected?.index === index && <Outline outline={shapeOutline(object.kind)} fill="none" stroke="var(--rose)" strokeWidth="1.6" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      </g>
      <ShapeObservation state={state} object={object} api={api} />
      {showName && <Caption point={{ x: object.center.x, y: bounds.maxY + 26 }}>{state.flags.names ? `${index + 1} · ${name}` : name}</Caption>}
      {showCount && <Caption point={{ x: object.center.x, y: bounds.maxY + (showName ? 49 : 26) }} size={15}>{observationText(state, object, api.locale)}</Caption>}
    </g>;
  })}</>;
}

const materials: PlanarMaterial[] = SHAPE_KINDS.map((kind, index) => ({
  id: `shape-material-${kind.id}`,
  label: t(kind.zh, kind.en),
  group: kind.life ? t("生活中的平面轮廓", "Flat outlines in everyday objects") : t("基本图形", "Basic shapes"),
  preview: <svg viewBox="-165 -160 330 320" width="76" height="76" aria-hidden="true" focusable="false"><ShapeIllustration object={{ index: 0, kind: index, center: { x: 0, y: 0 }, scale: 1, angle: 0, detail: kind.life ? 1 : 0 }} /></svg>,
  add: (state) => addShapeObject(state, index),
  disabled: (state) => state.params.count >= MAX_SHAPE_OBJECTS,
}));

const actions: PlanarAction[] = [
  { id: "basic-shapes-edges", icon: "edge", label: t("观察边界", "Observe boundaries"), active: (state) => state.flags.edges, run: (state) => toggleShapeFlag(state, "edges") },
  { id: "basic-shapes-vertices", icon: "vertex", label: t("观察顶点", "Observe vertices"), active: (state) => state.flags.vertices, run: (state) => toggleShapeFlag(state, "vertices") },
  { id: "basic-shapes-names", icon: "labels", label: t("显示图形名称", "Show shape names"), active: (state) => state.flags.names, run: (state) => toggleShapeFlag(state, "names") },
  { id: "basic-shapes-outline", icon: "observe", label: t("生活实例：提取轮廓／还原细节", "Everyday object: reveal outline or restore details"), duration: 900,
    disabled: (state) => { const object = shapeObject(state); return !object || !SHAPE_KINDS[object.kind].life; },
    active: (state) => { const object = shapeObject(state); return !!object && SHAPE_KINDS[object.kind].life && object.detail < 0.5; },
    run: toggleShapeDetail },
  { id: "basic-shapes-left", icon: "positiveTurn", label: t("当前图形逆时针 45°", "Turn the current shape 45° counterclockwise"), duration: 450, disabled: (state) => !shapeObject(state) || shapeObject(state)!.angle < -35955, run: (state) => rotateShapeObject(state, -45) },
  { id: "basic-shapes-right", icon: "negativeTurn", label: t("当前图形顺时针 45°", "Turn the current shape 45° clockwise"), duration: 450, disabled: (state) => !shapeObject(state) || shapeObject(state)!.angle > 35955, run: (state) => rotateShapeObject(state, 45) },
  { id: "basic-shapes-duplicate", icon: "duplicate", label: t("复制当前图形", "Duplicate the current shape"), disabled: (state) => !shapeObject(state) || state.params.count >= MAX_SHAPE_OBJECTS, run: duplicateShapeObject },
  { id: "basic-shapes-remove", icon: "remove", label: t("移去当前图形", "Remove the current shape"), disabled: (state) => !shapeObject(state), run: removeShapeObject },
];

export const planeShapesScene: PlanarSceneDefinition = {
  id: "01-basic", toolId: "plane-shapes", title: t("基本图形认识", "Exploring basic shapes"),
  description: t("从右侧逐个添加材料；直接拖动整体，按需观察边界、顶点与名称。生活实例可渐渐淡化细节，保留对应轮廓。", "Add materials one at a time on the right. Drag whole objects and observe boundaries, vertices and names. Fade real-life details while retaining the same outline."),
  create: createPlaneShapesState,
  materials, actions,
  fields: [
    { key: "scale", label: t("当前图形大小（倍）", "Current shape size (×)"), min: 0.5, max: 2, step: 0.05, read: (state) => shapeObject(state)?.scale ?? 1, disabled: (state) => !shapeObject(state) },
    { key: "angle", label: t("当前图形方向（°）", "Current shape orientation (°)"), min: -36000, max: 36000, step: 1, read: (state) => shapeObject(state)?.angle ?? 0, disabled: (state) => !shapeObject(state) },
    { key: "detail", label: t("当前生活实例细节（0–1）", "Current real-life detail (0–1)"), min: 0, max: 1, step: 0.05, read: (state) => shapeObject(state)?.detail ?? 0, disabled: (state) => { const object = shapeObject(state); return !object || !SHAPE_KINDS[object.kind].life; } },
  ],
  setField: setShapeField, setFlag: toggleShapeFlag, draw: drawShapes,
  drag: (start, target, _point, delta) => moveShapeObject(start, target, delta),
  tap: selectShapeTarget,
  summary: (state, locale) => {
    const object = shapeObject(state), en = locale === "en";
    return object ? `${state.params.count} ${en ? "objects · current" : "个对象 · 当前"} ${object.index + 1} · ${shapeName(object.kind, locale)}` : textFor(t("空舞台 · 从右侧添加材料", "Empty stage · add materials on the right"), locale);
  },
};
