import { useId } from "react";
import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarDrawingApi, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { constructionArea } from "../plane-construction/model";
import {
  MAX_PAPER_CUTS, canChangePaper, clearPaperCuts, clipHalfPlane, constructPaper, createPaperFoldingState,
  dragPaper, paperAxis, paperCuts, paperFoldMatrix, paperVertices, setPaperField, sourceCut, type PaperCut,
} from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const points = (vertices: readonly PlanarPoint[]) => vertices.map((point) => `${point.x},${point.y}`).join(" ");
const canCut = (state: PlanarState) => state.phase === 1 && !!state.params.creaseSet && state.params.cutCount < MAX_PAPER_CUTS;
function CutShape({ cut, fill, stroke }: { cut: PaperCut; fill: string; stroke?: string }) {
  return cut.kind === "circle" ? <circle cx={cut.points[0].x} cy={cut.points[0].y} r={cut.radius} fill={fill} stroke={stroke} strokeWidth="2" /> : <polygon points={points(cut.points)} fill={fill} stroke={stroke} strokeWidth="2" />;
}
function Handle({ at, target, api, label }: { at: PlanarPoint; target: string; api: PlanarDrawingApi; label: PlanarText }) {
  return <g {...api.bind(target, textFor(label, api.locale))} data-paper-handle={target} style={{ cursor: "grab" }}><circle cx={at.x} cy={at.y} r="18" fill="transparent" /><circle cx={at.x} cy={at.y} r="5.5" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" /></g>;
}
function PaperDrawing({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const uid = useId(), vertices = paperVertices(state), cuts = paperCuts(state), a = state.points.creaseA, b = state.points.creaseB;
  const minX = Math.min(...vertices.map((point) => point.x)) - 2, maxX = Math.max(...vertices.map((point) => point.x)) + 2;
  const minY = Math.min(...vertices.map((point) => point.y)) - 2, maxY = Math.max(...vertices.map((point) => point.y)) + 2;
  const box = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
  const operation = api.operation === "fold", showCrease = !!state.params.creaseSet && (state.flags.crease || operation), handles = operation && canChangePaper(state);
  const length = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / length, uy = (b.y - a.y) / length, middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return <g data-paper-folding="true">
    <defs><clipPath id={`${uid}-paper`} clipPathUnits="userSpaceOnUse"><polygon points={points(vertices)} /></clipPath>
      {[false, true].map((moving) => <g key={String(moving)}>
        <clipPath id={`${uid}-side-${moving}`} clipPathUnits="userSpaceOnUse"><polygon points={points(state.params.creaseSet ? clipHalfPlane(box, a, b, moving ? state.params.side : -state.params.side) : box)} /></clipPath>
        <mask id={`${uid}-holes-${moving}`} maskUnits="userSpaceOnUse" x={minX} y={minY} width={maxX - minX} height={maxY - minY} style={{ maskType: "luminance" }}><rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="white" />{cuts.map((cut, i) => <CutShape key={i} cut={sourceCut(state, cut, moving)} fill="black" />)}</mask>
      </g>)}
    </defs>
    {[false, true].filter((moving) => !moving || state.params.creaseSet).map((moving) => <g key={String(moving)} data-paper-layer={moving ? "moving" : "fixed"} transform={moving ? `matrix(${paperFoldMatrix(state).join(" ")})` : undefined}>
      <g clipPath={`url(#${uid}-side-${moving})`}><g clipPath={`url(#${uid}-paper)`} mask={`url(#${uid}-holes-${moving})`} {...api.bind(moving ? "paper-moving" : "paper-fixed", textFor(t(moving ? "拖动这侧纸张折起或展开" : "固定纸张", moving ? "Drag this paper side to fold or unfold" : "Stationary paper"), api.locale))} style={{ cursor: moving ? "grab" : "default" }}>
        <polygon points={points(vertices)} fill={moving ? "var(--leaf)" : "var(--moon)"} stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
        {cuts.map((cut, i) => <CutShape key={i} cut={sourceCut(state, cut, moving)} fill="none" stroke="var(--ink)" />)}
      </g></g>
    </g>)}
    {showCrease && <g data-paper-crease="true">
      <line x1={middle.x - 650 * ux} y1={middle.y - 650 * uy} x2={middle.x + 650 * ux} y2={middle.y + 650 * uy} stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="6 5" pointerEvents="none" />
      {handles && <><g {...api.bind("crease", textFor(t("平移折痕", "Move crease"), api.locale))}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="24" /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--rose)" strokeWidth="2" pointerEvents="none" /></g><Handle target="creaseA" at={a} api={api} label={t("折痕起点 A", "Crease start A")} /><Handle target="creaseB" at={b} api={api} label={t("折痕终点 B", "Crease end B")} /><polygon points={points([{ x: b.x - ux * 14 + uy * 5, y: b.y - uy * 14 - ux * 5 }, b, { x: b.x - ux * 14 - uy * 5, y: b.y - uy * 14 + ux * 5 }])} fill="var(--rose)" pointerEvents="none" /></>}
    </g>}
    {state.flags.edit && canChangePaper(state) && api.selected && vertices.map((point, i) => <Handle key={i} at={point} target={`paper.${i}`} api={api} label={t(`编辑纸张顶点 ${i + 1}`, `Edit paper vertex ${i + 1}`)} />)}
    {state.flags.measures && <text x="480" y="650" textAnchor="middle" fill="var(--ink)" stroke="var(--paper)" strokeWidth="5" paintOrder="stroke" pointerEvents="none">{textFor(t("折角", "Fold angle"), api.locale)} {(state.phase * 180).toFixed(0)}°{!cuts.length && ` · ${textFor(t("纸张面积", "Paper area"), api.locale)} ${(constructionArea(vertices) / 1600).toFixed(1)} u²`}</text>}
  </g>;
}
function preview(tool: string, draft: readonly PlanarPoint[]) {
  const a = draft[0], b = draft[draft.length - 1];
  return <g data-paper-draft="true" fill="none" stroke="var(--rose)" strokeWidth="1.4" strokeDasharray="5 5" pointerEvents="none">
    {a && b && tool === "cut-circle" ? <circle cx={a.x} cy={a.y} r={Math.hypot(b.x - a.x, b.y - a.y)} /> : a && b && tool === "paper-rectangle" ? <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} /> : <polyline points={points(draft)} />}
  </g>;
}
const locked = (state: PlanarState) => !canChangePaper(state) || !state.params.creaseSet;
export const planePaperFoldingScene: PlanarSceneDefinition = {
  id: "32-create", toolId: "plane-folding", title: t("折纸与剪纸", "Fold and cut paper"),
  description: t("画纸张与一条折痕，折合后画剪口；展开观察剪穿的各层。", "Draw paper and one crease, fold, then draw a cut. Unfold to observe the cuts through each layer."),
  create: createPaperFoldingState,
  construction: {
    maxPoints: 32, create: constructPaper, preview,
    invalidHint: t("纸张和剪口需要不交叉的有效轮廓；折痕须分出两侧。剪口需完全折合且碰到纸张；重画前先展开并收起剪口。", "Use a valid non-crossing outline. A crease must split the paper. Cuts must touch fully folded paper. Unfold and remove cuts before replacing paper."),
    tools: [
      { id: "paper-rectangle", label: t("替换为长方形纸", "Replace with rectangle paper"), kind: "drag", hint: t("拖出新纸张，替换当前纸张和折痕；可以撤销。", "Drag new paper to replace the current paper and crease. Undo restores them."), disabled: (state) => !canChangePaper(state) },
      { id: "paper-polygon", label: t("替换为多边形纸", "Replace with polygon paper"), kind: "points", hint: t("逐点围成新纸张；确认后替换当前纸张，可撤销。", "Place the outline vertices. Confirm to replace the paper; the change can be undone."), disabled: (state) => !canChangePaper(state) },
      { id: "crease", label: t("折痕", "Crease"), kind: "drag", once: true, hint: t("拖一条直线，方向从 A 指向 B；它需要穿过纸张内部。", "Drag a line from A to B through the paper's interior."), disabled: (state) => !canChangePaper(state) },
      { id: "cut-circle", label: t("圆形剪口", "Circular cut"), kind: "drag", once: true, hint: t("从剪口中心拖向圆周，剪穿此处实际叠着的纸层；可跨纸边。", "Drag from cut center to rim through the layers present here. Cuts may cross the paper edge."), disabled: (state) => !canCut(state) },
      { id: "cut-polygon", label: t("多边形剪口", "Polygon cut"), kind: "points", once: true, hint: t("逐点围出剪口；确认后剪穿实际纸层，可跨纸边。", "Outline the cut, then confirm to cut through the actual paper layers, including across an edge."), disabled: (state) => !canCut(state) },
    ],
  },
  operations: [{ id: "fold", icon: "fold", label: t("调整折痕与折起侧", "Adjust crease and folding side"), fields: [
    { key: "foldAngle", label: t("折角（°）", "Fold angle (°)"), min: 0, max: 180, read: (state) => state.phase * 180, disabled: (state) => !state.params.creaseSet },
    { key: "axisX", label: t("折痕中点 X", "Crease midpoint X"), min: 0, max: 960, read: (state) => (state.points.creaseA.x + state.points.creaseB.x) / 2, disabled: locked },
    { key: "axisY", label: t("折痕中点 Y", "Crease midpoint Y"), min: 0, max: 720, read: (state) => (state.points.creaseA.y + state.points.creaseB.y) / 2, disabled: locked },
    { key: "axisAngle", label: t("折痕方向（°）", "Crease direction (°)"), min: -180, max: 180, read: (state) => paperAxis(state).angle, disabled: locked },
    { key: "side", label: t("折起的一侧", "Side to fold"), min: -1, max: 1, options: [{ value: 1, label: t("A→B 左侧", "Left of A→B") }, { value: -1, label: t("A→B 右侧", "Right of A→B") }], read: (state) => state.params.side, disabled: locked },
  ] }],
  actions: [
    { id: "paper-fold", icon: "fold", label: t("慢慢折合", "Fold gradually"), duration: 1800, disabled: (state) => !state.params.creaseSet || state.phase === 1, run: (state) => ({ ...state, phase: 1 }), interpolate: (from, to, progress) => ({ ...to, phase: from.phase + (to.phase - from.phase) * progress }) },
    { id: "paper-unfold", icon: "unfold", label: t("慢慢展开", "Unfold gradually"), duration: 1800, disabled: (state) => !state.params.creaseSet || state.phase === 0, run: (state) => ({ ...state, phase: 0 }), interpolate: (from, to, progress) => ({ ...to, phase: from.phase + (to.phase - from.phase) * progress }) },
    { id: "paper-edit", icon: "editShape", label: t("编辑纸张轮廓", "Edit paper outline"), active: (state) => state.flags.edit, disabled: (state) => !canChangePaper(state), run: (state) => ({ ...state, flags: { ...state.flags, edit: !state.flags.edit } }) },
    { id: "paper-remove-cuts", icon: "clear", label: t("收起剪口，保留纸张与折痕", "Remove cuts, keeping paper and crease"), disabled: (state) => !state.params.cutCount, run: clearPaperCuts },
  ],
  toggles: [{ key: "crease", label: t("保留细折痕", "Keep the thin crease") }],
  setField: setPaperField,
  setFlag: (state, key, value) => ["grid", "measures", "crease", "edit"].includes(key) ? { ...state, flags: { ...state.flags, [key]: value } } : state,
  draw: (state, api) => <PaperDrawing state={state} api={api} />, drag: dragPaper,
  selectionAfterChange: (before, after, selected) => before.points !== after.points ? "paper-moving" : selected,
};
