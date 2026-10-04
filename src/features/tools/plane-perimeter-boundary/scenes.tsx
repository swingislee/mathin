import { useMemo } from "react";
import type { PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { constructionObject, constructionObjects, worldVertices } from "../plane-construction/model";
import { PERIMETER_UNIT } from "../plane-perimeter/model";
import { planePerimeterScene as base } from "../plane-perimeter/scenes";
import {
  addStaircaseMaterial, changePerimeterBase, clearEdgeCopies, collectEdgeCopies, createBoundaryGeometry, createPerimeterBoundaryState, dragEdgeCopy, edgeCopies,
  edgeCopySource, extractEdgeCopies, interpolateEdgeCopies, isValidPerimeterBoundaryState, liftPerimeterState, orthogonalEdgeFrame, parseEdgeCopyTarget,
  perimeterBaseState, polygonUnionBoundary, restoreEdgeCopies, selectEdgeCopy, setAllUnionMembers, setPerimeterBoundaryField, setPerimeterBoundaryFlag, setUnionMember,
  type BoundaryMaterial, type BoundarySegment,
} from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const fmt = (n: number) => Number(n.toFixed(2)).toString();
const colors = ["var(--leaf-deep)", "var(--crater)", "var(--rose)", "var(--muted)"];
const noPaper = (s: PlanarState) => !constructionObject(s);
const noCopies = (s: PlanarState) => !edgeCopySource(s);
function Caption({ x, y, text }: { x: number; y: number; text: string }) { return <text x={x} y={y} textAnchor="middle" fontSize="13" fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">{text}</text>; }
function Lines({ segments, color, dashed, kind }: { segments: readonly BoundarySegment[]; color: string; dashed?: boolean; kind: string }) {
  return <g data-boundary-kind={kind} pointerEvents="none">{segments.map((edge, i) => <line key={i} x1={edge.a.x} y1={edge.a.y} x2={edge.b.x} y2={edge.b.y} stroke={color} strokeWidth={kind === "covered" ? 1.6 : 3.4} strokeDasharray={dashed ? "6 4" : undefined} />)}</g>;
}
function BoundaryDrawing({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const enabled = state.flags.unionBoundary || state.flags.unionSeams || state.flags.unionCovered || state.flags.unionHoles;
  const signature = JSON.stringify(constructionObjects(state).filter((object) => state.params[`unionMember.${object.id}`]).map((object) => ({ id: object.id, points: worldVertices(object) })));
  const union = useMemo(() => enabled ? polygonUnionBoundary(JSON.parse(signature) as BoundaryMaterial[]) : null, [enabled, signature]);
  const copies = edgeCopies(state), frame = orthogonalEdgeFrame(state);
  return <g data-perimeter-boundary="true">
    {union && <>
      {state.flags.unionBoundary && <Lines kind="outer" segments={union.outer.flatMap((loop) => loop.segments)} color="var(--leaf-deep)" />}
      {state.flags.unionHoles && <Lines kind="holes" segments={union.holes.flatMap((loop) => loop.segments)} color="var(--crater)" />}
      {state.flags.unionSeams && <Lines kind="seams" segments={union.seams} color="var(--rose)" dashed />}
      {state.flags.unionCovered && <Lines kind="covered" segments={union.covered} color="var(--muted)" dashed />}
      {state.flags.measures && union.valid && <Caption x={480} y={690} text={`${textFor(t("组合外环", "Outer rings"), api.locale)} ${fmt(union.outerPerimeter / PERIMETER_UNIT)} u · ${textFor(t("孔边界", "Hole boundaries"), api.locale)} ${fmt(union.holePerimeter / PERIMETER_UNIT)} u · ${textFor(t("全部边界", "All boundaries"), api.locale)} ${fmt(union.perimeter / PERIMETER_UNIT)} u · ${textFor(t("连通部分", "Connected parts"), api.locale)} ${union.components}`} />}
      {!union.valid && <Caption x={480} y={690} text={textFor(t("当前边界尚不能闭合，保留原材料继续调整", "The current boundary cannot be closed; keep adjusting the original pieces"), api.locale)} />}
    </>}
    {copies.map((edge) => {
      const target = `edge-copy.${edge.index}`, active = state.params.edgeActive === edge.index, x = (edge.a.x + edge.b.x) / 2, y = (edge.a.y + edge.b.y) / 2;
      return <g key={edge.index} data-edge-copy={edge.index} {...api.bind(target, textFor(t(`平移边段副本 ${edge.index + 1}`, `Translate edge copy ${edge.index + 1}`), api.locale))} style={{ cursor: "grab" }}>
        <line x1={edge.a.x} y1={edge.a.y} x2={edge.b.x} y2={edge.b.y} stroke="transparent" strokeWidth="20" />
        <line data-rigid-edge="true" x1={edge.a.x} y1={edge.a.y} x2={edge.b.x} y2={edge.b.y} stroke={colors[edge.index % colors.length]} strokeWidth={active ? 4 : 3} strokeLinecap="round" pointerEvents="none" />
        {api.editable && active && (api.operation === "edge-translate" || api.selected === target) && <circle data-edge-copy-handle="true" cx={x} cy={y} r="6" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" pointerEvents="none" />}
        {state.flags.measures && <Caption x={x} y={y - 12} text={`${edge.index + 1}: ${fmt(edge.length / PERIMETER_UNIT)} u`} />}
      </g>;
    })}
    {copies.length > 0 && state.flags.measures && <Caption x={480} y={enabled ? 670 : 690} text={frame
      ? `${textFor(t("两组平行边", "Two edge directions"), api.locale)} ${fmt(frame.horizontal / PERIMETER_UNIT)} + ${fmt(frame.vertical / PERIMETER_UNIT)} = ${fmt(frame.perimeter / PERIMETER_UNIT)} u`
      : `${textFor(t("边段总长", "Total edge length"), api.locale)} ${fmt(copies.reduce((sum, edge) => sum + edge.length, 0) / PERIMETER_UNIT)} u`} />}
  </g>;
}
function wrapField(field: PlanarField): PlanarField { return { ...field, ...(field.read ? { read: (s: PlanarState) => field.read!(perimeterBaseState(s)) } : {}), ...(field.disabled ? { disabled: (s: PlanarState) => field.disabled!(perimeterBaseState(s)) } : {}) }; }
function wrapAction(action: PlanarAction): PlanarAction {
  return { ...action, run: (s, context) => changePerimeterBase(s, (old) => action.run(old, context)),
    ...(action.active ? { active: (s: PlanarState) => action.active!(perimeterBaseState(s)) } : {}),
    ...(action.disabled ? { disabled: (s, context) => action.disabled!(perimeterBaseState(s), context) } : {}),
    ...(action.interpolate ? { interpolate: (from, to, progress) => progress >= 1 ? to : progress <= 0 ? from : liftPerimeterState(from, action.interpolate!(perimeterBaseState(from), perimeterBaseState(to), progress)) } : {}),
  };
}
const selectedPaper = (s: PlanarState, target: string | null) => target && parseEdgeCopyTarget(target) !== null ? s.params.edgeSource >= 0 ? `object.${s.params.edgeSource}` : null : target;
const edgeAction = (id: string, label: PlanarText, run: (s: PlanarState) => PlanarState, disabled = noCopies): PlanarAction => ({ id, icon: "move", label, duration: 1500, run, disabled, interpolate: interpolateEdgeCopies });
const newActions: PlanarAction[] = [
  { id: "union-toggle-member", icon: "group", label: t("加入／移出当前组合", "Include or exclude the selected piece"), disabled: noPaper, active: (s) => s.params[`unionMember.${s.params.active}`] === 1, run: (s) => setUnionMember(s) },
  { id: "union-include-all", icon: "selectAll", label: t("组合全部纸片", "Include all pieces"), disabled: (s) => constructionObjects(s).every((object) => s.params[`unionMember.${object.id}`] === 1), run: (s) => setAllUnionMembers(s, true) },
  { id: "union-clear-members", icon: "deselect", label: t("清空组合选择，保留纸片", "Clear the group selection, keeping all pieces"), disabled: (s) => !constructionObjects(s).some((object) => s.params[`unionMember.${object.id}`] === 1), run: (s) => setAllUnionMembers(s, false) },
  { id: "edge-copy-extract", icon: "duplicate", label: t("取出当前纸片的边段副本", "Take edge copies from the selected piece"), disabled: noPaper, run: extractEdgeCopies },
  edgeAction("edge-copy-collect", t("两组边段分别平移排齐", "Translate the two edge groups into lines"), collectEdgeCopies, (s) => !orthogonalEdgeFrame(s)),
  edgeAction("edge-copy-restore-one", t("当前边段平移回原位", "Translate this edge back"), (s) => restoreEdgeCopies(s, true), (s) => noCopies(s) || restoreEdgeCopies(s, true) === s),
  edgeAction("edge-copy-restore-all", t("全部边段平移回原位", "Translate every edge back"), (s) => restoreEdgeCopies(s), (s) => noCopies(s) || restoreEdgeCopies(s) === s),
  { id: "edge-copy-clear", icon: "clear", label: t("收起边段副本，保留原纸", "Remove edge copies, keeping the paper"), disabled: noCopies, run: clearEdgeCopies },
];
export const planePerimeterBoundaryScene: PlanarSceneDefinition = {
  ...base, id: "10-boundary", create: createPerimeterBoundaryState, isExact: isValidPerimeterBoundaryState,
  description: t("在当前纸片上观察组合外环、孔边界与公共接缝；取出真实边段副本自由平移或按两方向排齐。原纸、自绘、拉直及定量调整继续保留。", "Observe outer rings, holes and shared seams of your current pieces. Translate copies of real edges freely or collect two perpendicular directions, keeping the original paper and all existing perimeter tools."),
  fields: base.fields?.map(wrapField), actions: [...(base.actions ?? []).map(wrapAction), ...newActions],
  materials: [...(base.materials ?? []).map((material) => ({ ...material, add: (s: PlanarState) => changePerimeterBase(s, material.add), ...(material.disabled ? { disabled: (s: PlanarState) => material.disabled!(perimeterBaseState(s)) } : {}) })),
    ...[false, true].map((notch) => ({ id: notch ? "notched-staircase" : "staircase", label: notch ? t("带凹口的台阶纸", "Notched staircase paper") : t("台阶纸", "Staircase paper"), group: t("追加台阶材料", "Add staircase material"), preview: <svg viewBox="0 0 80 56" aria-hidden="true"><path d={notch ? "M10 8H70V20H50V32H30V46H10V34H19V24H10Z" : "M10 8H70V20H50V32H30V46H10Z"} fill="var(--moon)" stroke="var(--ink)" strokeWidth="2" /></svg>, add: (s: PlanarState) => addStaircaseMaterial(s, notch), disabled: (s: PlanarState) => addStaircaseMaterial(s, notch) === s }))],
  construction: { ...base.construction!, create: createBoundaryGeometry, tools: base.construction!.tools.map((tool) => ({ ...tool, ...(tool.disabled ? { disabled: (s: PlanarState) => tool.disabled!(perimeterBaseState(s)) } : {}) })) },
  operations: [...(base.operations ?? []).map((operation) => ({ ...operation, fields: operation.fields?.map(wrapField), actions: operation.actions?.map(wrapAction) })),
    { id: "union-boundary", icon: "group", label: t("组合外边界与接缝", "Union boundaries and seams"), fields: [{ key: "unionMember", label: t("当前纸片参与组合", "Include the selected piece"), min: 0, max: 1, options: [{ value: 0, label: t("保留在组合外", "Outside this group") }, { value: 1, label: t("加入当前组合", "In this group") }], read: (s) => s.params[`unionMember.${s.params.active}`] ?? 0, disabled: noPaper }], actions: newActions.filter((action) => action.id.startsWith("union-")) },
    { id: "edge-translate", icon: "move", label: t("独立边段平移", "Translate individual edges"), fields: [
      { key: "edgeActive", label: t("边段编号（从 0 起）", "Edge index (from 0)"), min: 0, max: 31, step: 1, read: (s) => s.params.edgeActive, disabled: noCopies },
      { key: "edgeDx", label: t("向右位移（u）", "Rightward offset (u)"), min: -2400, max: 2400, read: (s) => (edgeCopies(s)[s.params.edgeActive]?.offset.x ?? 0) / PERIMETER_UNIT, disabled: noCopies },
      { key: "edgeDy", label: t("向下位移（u）", "Downward offset (u)"), min: -2400, max: 2400, read: (s) => (edgeCopies(s)[s.params.edgeActive]?.offset.y ?? 0) / PERIMETER_UNIT, disabled: noCopies },
    ], actions: newActions.filter((action) => action.id.startsWith("edge-copy-")) },
  ],
  toggles: [...(base.toggles ?? []), { key: "unionBoundary", label: t("显示组合外环", "Show outer union rings") }, { key: "unionHoles", label: t("显示孔边界", "Show hole boundaries") }, { key: "unionSeams", label: t("显示公共接缝", "Show shared seams") }, { key: "unionCovered", label: t("显示被遮住的原边", "Show covered original edges") }],
  setField: setPerimeterBoundaryField, setFlag: (s, key, value) => setPerimeterBoundaryFlag(s, key, value, base.setFlag!),
  draw: (state, api) => <>{base.draw(perimeterBaseState(state), { ...api, selected: selectedPaper(state, api.selected), ghostState: api.ghostState ? perimeterBaseState(api.ghostState) : undefined })}<BoundaryDrawing state={state} api={api} /></>,
  tap: (s, target) => parseEdgeCopyTarget(target) !== null ? selectEdgeCopy(s, target) : changePerimeterBase(s, (old) => base.tap!(old, target)),
  drag: (s, target, point, delta, context) => parseEdgeCopyTarget(target) !== null ? dragEdgeCopy(s, target, delta) : changePerimeterBase(s, (old) => base.drag!(old, target, point, delta, context?.previous ? { previous: perimeterBaseState(context.previous) } : undefined)),
  selectionAfterChange: (before, after, selected) => {
    if (after.params.edgeSource >= 0 && (before.params.edgeSource !== after.params.edgeSource || before.params.edgeActive !== after.params.edgeActive || selected && parseEdgeCopyTarget(selected) !== null && after.params.active === after.params.edgeSource)) return `edge-copy.${after.params.edgeActive}`;
    return base.selectionAfterChange ? base.selectionAfterChange(perimeterBaseState(before), perimeterBaseState(after), selectedPaper(before, selected)) : selected;
  },
  contextActions: (s, selected) => {
    const index = selected ? parseEdgeCopyTarget(selected) : null, edge = index === null ? null : edgeCopies(s)[index];
    return edge ? { bounds: { minX: Math.min(edge.a.x, edge.b.x) - 8, maxX: Math.max(edge.a.x, edge.b.x) + 8, minY: Math.min(edge.a.y, edge.b.y) - 8, maxY: Math.max(edge.a.y, edge.b.y) + 8 }, items: [{ kind: "operation", id: "edge-translate" }, { kind: "action", id: "edge-copy-restore-one" }, { kind: "action", id: "edge-copy-clear" }] } : base.contextActions?.(perimeterBaseState(s), selected) ?? null;
  },
};
