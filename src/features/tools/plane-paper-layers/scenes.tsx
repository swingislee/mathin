import { useId } from "react";
import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarDrawingApi, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { constructionArea } from "../plane-construction/model";
import {
  activeCut, applyMatrix, canAddFold, canChangePaper, canCut, canEditFold, clearCuts, compose, constructPaperLayers, createPaperLayersState, cutEditingPose,
  cutIntersectsRegions, deleteCut, dragPaperLayers, foldStep, interpolateFold, inverse, isFlat, layerMatrix, orderedPaperLayers, paperCuts, paperVertices,
  removeLastFold, selectPaperLayerTarget, setPaperLayersField, sourceCut, type LayerCut,
} from "./model";
import { isValidPaperLayersState } from "./validation";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const points = (poly: readonly PlanarPoint[]) => poly.map((p) => `${p.x},${p.y}`).join(" ");
function CutShape({ cut, fill, stroke }: { cut: LayerCut; fill: string; stroke?: string }) {
  return cut.kind === "circle" ? <circle cx={cut.points[0].x} cy={cut.points[0].y} r={cut.radius} fill={fill} stroke={stroke} strokeWidth="2" /> : <polygon points={points(cut.points)} fill={fill} stroke={stroke} strokeWidth="2" />;
}
function Handle({ at, target, api, label }: { at: PlanarPoint; target: string; api: PlanarDrawingApi; label: PlanarText }) {
  return <g {...api.bind(target, textFor(label, api.locale))} data-paper-handle={target} style={{ cursor: "grab" }}><circle cx={at.x} cy={at.y} r="16" fill="transparent" /><circle cx={at.x} cy={at.y} r="5.5" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" /></g>;
}
function LayersDrawing({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const uid = useId(), vertices = paperVertices(state), cuts = paperCuts(state), layers = orderedPaperLayers(state), i = state.params.activeFold, selectedCut = activeCut(state);
  const minX = Math.min(...vertices.map((p) => p.x)) - 3, minY = Math.min(...vertices.map((p) => p.y)) - 3, width = Math.max(...vertices.map((p) => p.x)) - minX + 3, height = Math.max(...vertices.map((p) => p.y)) - minY + 3;
  return <g data-paper-layers="true">
    <defs>{layers.map((layer) => <g key={layer.bits}>
      <clipPath id={`${uid}-region-${layer.bits}`} clipPathUnits="userSpaceOnUse">{layer.sourceRegions.map((poly, j) => <polygon key={j} points={points(poly)} />)}</clipPath>
      <mask id={`${uid}-holes-${layer.bits}`} maskUnits="userSpaceOnUse" x={minX} y={minY} width={width} height={height} style={{ maskType: "luminance" }}><rect x={minX} y={minY} width={width} height={height} fill="white" />{cuts.map((cut) => <CutShape key={cut.id} cut={sourceCut(cut, layer)} fill="black" />)}</mask>
    </g>)}</defs>
    {layers.map((layer) => <g key={layer.bits} data-paper-layer={layer.bits} data-source-regions={layer.sourceRegions.length} transform={`matrix(${layerMatrix(state, layer).join(" ")})`}>
      <g clipPath={`url(#${uid}-region-${layer.bits})`}><g mask={`url(#${uid}-holes-${layer.bits})`} {...api.bind(`layer.${layer.bits}`, textFor(t("拖动纸层折起或展开", "Drag paper to fold or unfold"), api.locale))} style={{ cursor: i >= 0 && (layer.bits & (1 << i)) ? "grab" : "default" }}>
        <polygon points={points(vertices)} fill={layer.bits.toString(2).split("1").length % 2 === 0 ? "var(--leaf)" : "var(--moon)"} stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
        {cuts.map((cut) => <CutShape key={cut.id} cut={sourceCut(cut, layer)} fill="none" stroke="var(--ink)" />)}
      </g></g>
    </g>)}
    {i >= 0 && (state.flags.crease || api.operation === "fold") && (() => {
      const a = state.points[`foldA.${i}`], b = state.points[`foldB.${i}`], length = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / length, uy = (b.y - a.y) / length, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      return <g data-active-crease={i}><line x1={x - ux * 700} y1={y - uy * 700} x2={x + ux * 700} y2={y + uy * 700} stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="6 5" pointerEvents="none" />
        {api.editable && api.operation === "fold" && canEditFold(state) && <><g {...api.bind(`fold.${i}`, textFor(t("平移当前折痕", "Move the selected crease"), api.locale))}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="24" /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--rose)" strokeWidth="2" pointerEvents="none" /></g><Handle at={a} target={`foldA.${i}`} api={api} label={t("折痕起点 A", "Crease start A")} /><Handle at={b} target={`foldB.${i}`} api={api} label={t("折痕终点 B", "Crease end B")} /></>}
      </g>;
    })()}
    {api.editable && state.flags.edit && canChangePaper(state) && vertices.map((p, j) => <Handle key={j} at={p} target={`paper.${j}`} api={api} label={t(`纸张顶点 ${j + 1}`, `Paper vertex ${j + 1}`)} />)}
    {api.editable && state.flags.editCut && isFlat(state) && cuts.flatMap((cut) => layers.filter((layer) => cutIntersectsRegions(sourceCut(cut, layer), layer.sourceRegions)).map((layer) => {
      const map = compose(layerMatrix(state, layer), inverse(layer.maps[cut.depth])), at = (p: PlanarPoint) => applyMatrix(map, p), center = cut.kind === "circle" ? cut.points[0] : { x: cut.points.reduce((sum, p) => sum + p.x, 0) / cut.points.length, y: cut.points.reduce((sum, p) => sum + p.y, 0) / cut.points.length };
      return <g key={`${cut.id}-${layer.bits}`} data-cut-editor={`${cut.id}-${layer.bits}`}>
        <Handle at={at(center)} target={`cut-body.${cut.id}.0.${layer.bits}`} api={api} label={t(`移动剪口 ${cut.id}`, `Move cut ${cut.id}`)} />
        {selectedCut?.id === cut.id && (cut.kind === "circle" ? <Handle at={at({ x: center.x + cut.radius, y: center.y })} target={`cut-radius.${cut.id}.0.${layer.bits}`} api={api} label={t("调整剪口半径", "Adjust cut radius")} /> : cut.points.map((p, j) => <Handle key={j} at={at(p)} target={`cut-vertex.${cut.id}.${j}.${layer.bits}`} api={api} label={t(`剪口顶点 ${j + 1}`, `Cut vertex ${j + 1}`)} />))}
      </g>;
    }))}
    {state.flags.measures && <text x="480" y="662" textAnchor="middle" fill="var(--ink)" stroke="var(--paper)" strokeWidth="5" paintOrder="stroke" pointerEvents="none">{Array.from({ length: state.params.foldCount }, (_, j) => `${j + 1}: ${state.params[`foldAngle.${j}`].toFixed(0)}°`).join(" · ")}{!cuts.length && ` · ${textFor(t("纸张面积", "Paper area"), api.locale)} ${(constructionArea(vertices) / 1600).toFixed(1)} u²`}</text>}
  </g>;
}
function preview(tool: string, draft: readonly PlanarPoint[]) {
  const a = draft[0], b = draft[draft.length - 1];
  return <g data-paper-layers-draft="true" fill="none" stroke="var(--rose)" strokeWidth="1.4" strokeDasharray="5 5" pointerEvents="none">{a && b && tool === "cut-circle" ? <circle cx={a.x} cy={a.y} r={Math.hypot(b.x - a.x, b.y - a.y)} /> : a && b && tool === "paper-rectangle" ? <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} /> : <polyline points={points(draft)} />}</g>;
}
const foldLocked = (s: PlanarState) => !canEditFold(s);
const cutLocked = (s: PlanarState) => !activeCut(s) || !isFlat(s);
const foldMid = (s: PlanarState, axis: "x" | "y") => s.params.activeFold < 0 ? 0 : (s.points[`foldA.${s.params.activeFold}`][axis] + s.points[`foldB.${s.params.activeFold}`][axis]) / 2;
export const planePaperLayersScene: PlanarSceneDefinition = {
  id: "32-layers", toolId: "plane-folding", title: t("双折与剪纸", "Two folds and paper cuts"), description: t("在同一张纸上逐次画两条折痕、折合与剪切，再逐层展开。剪口可单独移动、编辑和移除。", "Draw up to two successive creases on one sheet, fold and cut, then unfold each layer. Move, edit or remove individual cuts."),
  create: createPaperLayersState, isExact: isValidPaperLayersState,
  construction: { maxPoints: 32, create: constructPaperLayers, preview, invalidHint: t("折痕须穿过当前纸层内部；前一折完全折合后可画下一折。剪口须碰到完全折合的纸层；轮廓保持简单、不交叉。", "A crease must split the current paper layers. Finish the previous fold before adding another. Cuts must touch flat folded paper; use a simple, non-crossing outline."), tools: [
    { id: "paper-rectangle", label: t("画长方形纸", "Draw rectangle paper"), kind: "drag", hint: t("替换当前纸张与折痕；可以撤销。先展开并移除剪口。", "Replace the paper and creases; undo is available. First unfold and remove cuts."), disabled: (s) => !canChangePaper(s) },
    { id: "paper-polygon", label: t("画多边形纸", "Draw polygon paper"), kind: "points", hint: t("逐点围出新纸张，确认后替换当前纸张与折痕。", "Outline a new sheet, then confirm to replace the paper and creases."), disabled: (s) => !canChangePaper(s) },
    { id: "crease", label: t("添加下一条折痕", "Add the next crease"), kind: "drag", once: true, hint: t("由 A 拖向 B，穿过当前纸层；最多两折。", "Drag from A to B through the current paper layers, for up to two folds."), disabled: (s) => !canAddFold(s) },
    { id: "cut-circle", label: t("圆形剪口", "Circular cut"), kind: "drag", once: true, hint: t("由中心拖至圆周，可跨过纸边。", "Drag from center to rim; the cut may cross an edge."), disabled: (s) => !canCut(s) },
    { id: "cut-polygon", label: t("多边形剪口", "Polygon cut"), kind: "points", once: true, hint: t("围出剪口，剪穿此处实际叠着的纸层。", "Outline a cut through the paper layers actually present here."), disabled: (s) => !canCut(s) },
  ] },
  operations: [
    { id: "fold", icon: "fold", label: t("折痕与折角", "Creases and fold angles"), fields: [
      { key: "activeFold", label: t("当前折痕", "Selected crease"), min: 0, max: 1, options: [{ value: 0, label: t("第一折", "First fold") }, { value: 1, label: t("第二折", "Second fold") }], read: (s) => s.params.activeFold, disabled: (s) => s.params.foldCount === 0 },
      { key: "foldAngle", label: t("折角（°）", "Fold angle (°)"), min: 0, max: 180, read: (s) => s.params[`foldAngle.${s.params.activeFold}`] ?? 0, disabled: (s) => s.params.activeFold < 0 || s.params.activeFold > 0 && s.params["foldAngle.0"] !== 180 || s.params.activeFold === 0 && (s.params["foldAngle.1"] ?? 0) > 0 },
      { key: "axisX", label: t("折痕中点 X", "Crease midpoint X"), min: -5000, max: 5000, read: (s) => foldMid(s, "x"), disabled: foldLocked },
      { key: "axisY", label: t("折痕中点 Y", "Crease midpoint Y"), min: -5000, max: 5000, read: (s) => foldMid(s, "y"), disabled: foldLocked },
      { key: "axisAngle", label: t("折痕方向（°）", "Crease direction (°)"), min: -180, max: 180, read: (s) => { const a = s.points[`foldA.${s.params.activeFold}`], b = s.points[`foldB.${s.params.activeFold}`]; return a && b ? Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI : 0; }, disabled: foldLocked },
      { key: "foldSide", label: t("折起侧", "Side to fold"), min: -1, max: 1, options: [{ value: 1, label: t("A→B 左侧", "Left of A→B") }, { value: -1, label: t("A→B 右侧", "Right of A→B") }], read: (s) => s.params[`foldSide.${s.params.activeFold}`] ?? 1, disabled: foldLocked },
    ] },
    { id: "cut", icon: "editShape", label: t("独立编辑剪口", "Edit an individual cut"), fields: [
      { key: "activeCut", label: t("剪口编号", "Cut ID"), min: 1, max: 99998, step: 1, read: (s) => s.params.activeCut, disabled: (s) => !paperCuts(s).length },
      { key: "activeVertex", label: t("顶点编号（从 0 起）", "Vertex index (from 0)"), min: 0, max: 31, step: 1, read: (s) => s.params.activeVertex, disabled: (s) => cutLocked(s) || activeCut(s)?.kind !== "polygon" },
      { key: "cutX", label: t("剪切时坐标 X", "X at cutting depth"), min: -5000, max: 5000, read: (s) => activeCut(s)?.points[s.params.activeVertex]?.x ?? 0, disabled: cutLocked },
      { key: "cutY", label: t("剪切时坐标 Y", "Y at cutting depth"), min: -5000, max: 5000, read: (s) => activeCut(s)?.points[s.params.activeVertex]?.y ?? 0, disabled: cutLocked },
      { key: "cutRadius", label: t("圆剪口半径", "Circular cut radius"), min: 3, max: 350, read: (s) => activeCut(s)?.radius ?? 3, disabled: (s) => cutLocked(s) || activeCut(s)?.kind !== "circle" },
    ] },
  ],
  actions: [
    { id: "paper-fold-next", icon: "fold", label: t("慢慢折合一层", "Fold one step gradually"), duration: 1800, disabled: (s) => foldStep(s) === s, run: (s) => foldStep(s), interpolate: interpolateFold },
    { id: "paper-unfold-next", icon: "unfold", label: t("慢慢展开一层", "Unfold one step gradually"), duration: 1800, disabled: (s) => foldStep(s, true) === s, run: (s) => foldStep(s, true), interpolate: interpolateFold },
    { id: "paper-edit", icon: "editShape", label: t("编辑纸张轮廓", "Edit paper outline"), active: (s) => s.flags.edit, disabled: (s) => !canChangePaper(s), run: (s) => ({ ...s, flags: { ...s.flags, edit: !s.flags.edit } }) },
    { id: "cut-edit", icon: "editShape", label: t("显示剪口手柄", "Show cut handles"), active: (s) => s.flags.editCut, disabled: (s) => !paperCuts(s).length, run: (s) => ({ ...s, flags: { ...s.flags, editCut: !s.flags.editCut } }) },
    { id: "cut-pose", icon: "fold", label: t("回到当前剪口的剪切层", "Return to selected cut depth"), disabled: (s) => !activeCut(s), run: cutEditingPose },
    { id: "cut-delete", icon: "remove", label: t("移除当前剪口", "Remove selected cut"), disabled: (s) => !activeCut(s), run: (s) => deleteCut(s) },
    { id: "fold-delete-last", icon: "remove", label: t("移除已展开的最后折痕", "Remove the last unfolded crease"), disabled: (s) => removeLastFold(s) === s, run: removeLastFold },
    { id: "cut-clear-all", icon: "clear", label: t("移除全部剪口", "Remove all cuts"), disabled: (s) => !paperCuts(s).length, run: clearCuts },
  ],
  toggles: [{ key: "crease", label: t("保留细折痕", "Keep thin crease") }], setField: setPaperLayersField,
  setFlag: (s, key, value) => ["grid", "measures", "crease", "edit", "editCut"].includes(key) ? { ...s, flags: { ...s.flags, [key]: value } } : s,
  draw: (state, api) => <LayersDrawing state={state} api={api} />, drag: dragPaperLayers, tap: selectPaperLayerTarget,
  selectionAfterChange: (before, after, selected) => before.params.activeCut !== after.params.activeCut && after.params.activeCut >= 0 ? `cut-body.${after.params.activeCut}.0.0` : selected,
};
