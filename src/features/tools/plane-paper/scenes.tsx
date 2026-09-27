import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { HeightMark } from "../planar-kit/geometry";
import type { PlanarMaterial, PlanarSceneDefinition, PlanarText } from "../planar-kit/types";
import { constructionObject, constructionObjects, parseConstructionTarget, worldVertices } from "../plane-construction/model";
import { createConstructionDefinition } from "../plane-construction/scenes";
import {
  PAPER_MATERIALS, PAPER_SCENE_ID, addPaperMaterial, createPaperGeometry, createPaperState,
  cutAlongPaperAltitude, cutPaper, paperAltitude, tapPaper,
} from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const coordinates = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const base = createConstructionDefinition(PAPER_SCENE_ID, "plane-area", t("剪拼与面积转化", "Paper dissection and area"));

const materials: PlanarMaterial[] = PAPER_MATERIALS.map((material) => ({
  id: `paper-${material.id}`, label: t(material.zh, material.en), group: t("添加纸片", "Add paper"),
  preview: <svg viewBox="0 0 160 110" width="76" height="60" aria-hidden="true" focusable="false">
    {material.polygons.map((polygon, index) => {
      const multiple = material.polygons.length > 1, scale = multiple ? 0.18 : 0.3;
      const x = multiple ? 42 + index % 2 * 75 : 80, y = material.polygons.length > 2 ? 29 + Math.floor(index / 2) * 52 : 55;
      return <polygon key={index} transform={`translate(${x} ${y}) scale(${scale})`} points={coordinates(polygon)} fill="var(--leaf)" fillOpacity="0.65" stroke="var(--ink)" strokeWidth="1.3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
    })}
  </svg>,
  add: (state) => addPaperMaterial(state, material.id),
  disabled: (state) => addPaperMaterial(state, material.id) === state,
}));

function cutPreview(draft: readonly PlanarPoint[], state?: PlanarState) {
  if (!draft.length) return null;
  const a = draft[0], b = draft[1] ?? a, length = Math.hypot(b.x - a.x, b.y - a.y);
  const next = state && length >= 12 ? cutPaper(state, a, b) : null;
  const object = state ? constructionObject(state) : null, vertices = object ? worldVertices(object) : [];
  const unit = length > 1e-7 ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 1, y: 0 };
  const projections = vertices.map((point) => (point.x - a.x) * unit.x + (point.y - a.y) * unit.y);
  const low = Math.min(-80, ...projections) - 45, high = Math.max(length + 80, ...projections) + 45;
  return <g data-paper-cut-preview={next ? "valid" : "incomplete"} pointerEvents="none">
    {!!vertices.length && <polygon points={coordinates(vertices)} fill="none" stroke="var(--rose)" strokeWidth="1.4" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />}
    {length > 1e-7 && <line data-paper-cut-extension="true" x1={a.x + low * unit.x} y1={a.y + low * unit.y} x2={a.x + high * unit.x} y2={a.y + high * unit.y} stroke="var(--muted)" strokeWidth="1.4" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--rose)" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    {draft.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="4" fill="var(--paper)" stroke="var(--rose)" strokeWidth="1.5" />)}
  </g>;
}

export const planePaperScene: PlanarSceneDefinition = {
  ...base,
  description: t("画出或添加纸片，选择后拖出切线。切开的每片仍在原位，可分别拖动、旋转、复制和再次剪开。", "Draw or add paper, select it, then drag a cutting line. Cut pieces stay in place and can be moved, rotated, copied or cut again."),
  create: createPaperState,
  fields: base.fields?.filter((field) => field.key !== "detail"),
  actions: base.actions?.filter((action) => action.id !== "construction-life-outline"),
  materials,
  construction: {
    maxPoints: base.construction!.maxPoints,
    tools: [
      { id: "rectangle", label: t("画长方形纸片", "Draw rectangular paper"), kind: "drag" },
      { id: "polygon", label: t("画多边形纸片", "Draw polygonal paper"), kind: "points" },
      {
        id: "cut-line", label: t("拖出切线", "Draw cutting line"), kind: "drag", once: true,
        disabled: (state) => !constructionObject(state),
        hint: t("拖出直线穿过当前纸片，松手剪开；虚线为切线延长线。切后可直接拖动纸片，点“拖出切线”可再剪。关闭切线后可点底边显示高。", "Drag a straight line across the current paper and release to cut. Dashes extend the line. Move pieces after cutting, or choose Draw cutting line again. Close drawing to select a base and show its altitude."),
      },
    ],
    invalidHint: t("请让切线穿过纸片内部；沿边、相切、过小碎片或超过纸片数量上限时保留原纸片。新画轮廓应闭合且不自交。", "Cross the paper interior. Edge-only cuts, tangencies, tiny fragments or exceeding the paper limit leave the original intact. New outlines must close without crossing themselves."),
    create: createPaperGeometry,
    preview: (toolId, draft, state) => toolId === "cut-line" ? cutPreview(draft, state) : base.construction!.preview(toolId, draft, state),
  },
  operations: [
    {
      id: "cut", icon: "cut", label: t("剪开纸片", "Cut paper"), constructionTool: "cut-line",
      actions: [{
        id: "paper-cut-altitude", icon: "cut", label: t("沿当前高剪开", "Cut along current altitude"),
        disabled: (state, context) => !cutAlongPaperAltitude(state, context.selected),
        run: (state, context) => cutAlongPaperAltitude(state, context.selected) ?? state,
      }],
    },
    ...base.operations!,
  ],
  draw: (state, api) => {
    const cutting = api.operation === "cut", altitude = cutting || state.flags.measures ? paperAltitude(state, api.selected) : null;
    return <>
      {base.draw(cutting ? { ...state, flags: { ...state.flags, edges: true } } : state, api)}
      {altitude && <g data-paper-altitude="true"><HeightMark vertex={altitude.vertex} baseA={altitude.baseA} baseB={altitude.baseB} label={api.locale === "en" ? "h" : "高"} /></g>}
    </>;
  },
  tap: tapPaper,
  drag: (start, target, point, delta, context) => {
    const parsed = parseConstructionTarget(target);
    const object = parsed?.type === "edge" && parsed.id !== undefined ? constructionObject(start, parsed.id) : null;
    // 边缘热区保留轻点选底边；拖动则搬整张纸，窄纸片也能直接抓取。
    const dragTarget = !start.flags.edit && object && parsed?.part !== undefined && parsed.part < object.vertices.length ? `object.${object.id}` : target;
    return base.drag!(start, dragTarget, point, delta, context);
  },
  summary: (state, locale) => locale === "en" ? `${constructionObjects(state).length} paper pieces` : `${constructionObjects(state).length} 张纸片`,
};

export const planePaperScenes: PlanarSceneDefinition[] = [planePaperScene];
