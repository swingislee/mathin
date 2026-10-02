import type { PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { matchEndpoints } from "../plane-patterns/model";
import { addMatchMaterial, captureMatchReference, clearMatchReference, clearMatches, createMatchState, dragMatch, duplicateMatch, liveMatches, matchBounds, matchFor, matchIds, matchTarget, referenceIds, removeMatch, selectMatch, setMatchField, settleMatch, turnMatch, type MatchMaterial } from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const caption = { fill: "var(--ink)", stroke: "var(--paper)", strokeWidth: 5, paintOrder: "stroke" as const, fontSize: 16 };
const noStick = (state: PlanarState) => !matchFor(state);
const hasSelected = (state: PlanarState, selected: string | null) => { const id = matchTarget(selected); return id !== null && !!matchFor(state, id); };
const turnAction: PlanarAction = { id: "match-turn", icon: "rotate", label: t("按设定角度转动", "Turn by the set angle"), duration: 900,
  disabled: (state, context) => !hasSelected(state, context.selected) || state.params.turn === 0,
  run: (state, context) => turnMatch(state, context.selected, state.params.turn),
};

function MatchDrawing({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const selectedId = matchTarget(api.selected), selected = selectedId === null ? null : matchFor(state, selectedId);
  const handle = selected && { x: selected.center.x + 78 * Math.cos(selected.angle * Math.PI / 180), y: selected.center.y + 78 * Math.sin(selected.angle * Math.PI / 180) };
  return <g data-matchsticks="open-materials">
    {state.flags.reference && referenceIds(state).map((id) => { const [a, b] = matchEndpoints(matchFor(state, id, true)!); return <line data-match-reference={id} key={id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 5" pointerEvents="none" />; })}
    {liveMatches(state).map((piece) => {
      const [a, b] = matchEndpoints(piece), id = matchTarget(piece.id)!;
      return <g key={piece.id} {...api.bind(piece.id, `${textFor(t("火柴棒", "Matchstick"), api.locale)} ${id + 1}`)} style={{ cursor: "grab" }}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={28} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selectedId === id ? "var(--rose)" : "var(--crater)"} strokeWidth={8} strokeLinecap="round" />
        <circle cx={a.x} cy={a.y} r={6.5} fill="var(--rose)" />
        {state.flags.labels && <text x={piece.center.x} y={piece.center.y - 18} textAnchor="middle" style={caption} pointerEvents="none">{id + 1}</text>}
      </g>;
    })}
    {selected && handle && api.editable && api.operation === "rotate" && <g data-match-turn-handle="true">
      <line x1={selected.center.x} y1={selected.center.y} x2={handle.x} y2={handle.y} stroke="var(--rose)" strokeDasharray="3 4" pointerEvents="none" />
      <circle cx={selected.center.x} cy={selected.center.y} r={4} fill="var(--paper)" stroke="var(--rose)" pointerEvents="none" />
      <g {...api.bind(`turn.${selectedId}`, textFor(t("拖动转柄，连续旋转", "Drag the handle to rotate continuously"), api.locale))} style={{ cursor: "grab" }}>
        <circle cx={handle.x} cy={handle.y} r={18} fill="transparent" />
        <circle cx={handle.x} cy={handle.y} r={8} fill="var(--paper)" stroke="var(--rose)" strokeWidth={2} />
      </g>
    </g>}
    {state.flags.measures && <text x={40} y={687} style={caption} pointerEvents="none">{api.locale === "en" ? "Equal-length sticks" : "等长火柴棒"}：{matchIds(state).length}{selected ? ` · ${api.locale === "en" ? "Angle" : "转角"} ${Number(selected.angle.toFixed(1))}°` : ""}</text>}
    {!matchIds(state).length && <text x={480} y={350} textAnchor="middle" style={caption} pointerEvents="none">{textFor(t("从右侧添加火柴棒，搭出自己的现场", "Add sticks from the right to build your own arrangement"), api.locale)}</text>}
  </g>;
}

export const planeMatchsticksScene: PlanarSceneDefinition = {
  id: "51-create", toolId: "plane-matchsticks", title: t("火柴棒拼摆", "Matchstick arrangements"),
  description: t("从一根棒开始，或追加三角形、方形与共边材料。每根始终等长，可独立拖动、复制、移除和连续转动；留影由你选定，不自动数图形或判题。", "Start with one stick or add a triangle, square or shared-side arrangement. Sticks remain equal in length and can be moved, copied, removed and rotated. Capture your own reference; shapes are not automatically counted or judged."),
  create: createMatchState,
  materials: ([["single", t("一根火柴棒", "One matchstick")], ["triangle", t("三角形：3 根", "Triangle: 3 sticks")], ["square", t("正方形：4 根", "Square: 4 sticks")], ["shared", t("三个共边正方形：10 根", "Three shared-side squares: 10 sticks")]] as const).map(([id, label]) => ({
    id, label, group: t("追加等长材料", "Add equal-length materials"),
    preview: <svg viewBox="0 0 100 70" width="76" height="55" aria-hidden="true"><path d={({ single: "M15 35H85", triangle: "M20 57L50 5L80 57Z", square: "M25 10H75V60H25Z", shared: "M5 20H95V50H5ZM35 20V50M65 20V50" } satisfies Record<MatchMaterial, string>)[id]} fill="none" stroke="var(--crater)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    add: (state) => addMatchMaterial(state, id), disabled: (state) => addMatchMaterial(state, id) === state,
  })),
  toggles: [{ key: "snap", label: t("松手时端点吸附", "Snap endpoints on release") }, { key: "reference", label: t("显示已留的参考轮廓", "Show captured reference outlines") }, { key: "labels", label: t("显示火柴编号", "Show stick numbers") }],
  actions: [
    { id: "match-duplicate", icon: "duplicate", label: t("复制所选火柴棒", "Duplicate selected stick"), run: (state, context) => duplicateMatch(state, context.selected), disabled: (state, context) => duplicateMatch(state, context.selected) === state },
    { id: "match-remove", icon: "remove", label: t("移除所选火柴棒", "Remove selected stick"), run: (state, context) => removeMatch(state, context.selected), disabled: (state, context) => !hasSelected(state, context.selected) },
  ],
  operations: [
    { id: "move", icon: "move", label: t("准确移动火柴棒", "Position a stick precisely"), fields: (["x", "y"] as const).map((key) => ({ key, label: t(`中心 ${key.toUpperCase()}`, `Center ${key.toUpperCase()}`), min: 40, max: key === "x" ? 920 : 680, step: 1, read: (state) => matchFor(state)?.center[key] ?? 40, disabled: noStick })) },
    { id: "rotate", icon: "rotate", label: t("转动火柴棒", "Rotate a stick"), fields: [
      { key: "angle", label: t("当前转角（°）", "Current angle (°)"), min: -36000, max: 36000, step: 1, read: (state) => matchFor(state)?.angle ?? 0, disabled: noStick },
      { key: "turn", label: t("本次转动（°）", "Turn by (°)"), min: -360, max: 360, step: 1 },
    ], actions: [turnAction] },
    { id: "reference", icon: "mark", label: t("材料与参考留影", "Materials and reference outlines"), actions: [
      { id: "match-capture", icon: "mark", label: t("把当前摆法留作参考", "Capture this arrangement as reference"), run: captureMatchReference, disabled: (state) => !matchIds(state).length },
      { id: "match-clear-reference", icon: "clear", label: t("擦除参考轮廓", "Erase reference outlines"), run: clearMatchReference, disabled: (state) => !referenceIds(state).length },
      { id: "match-clear", icon: "remove", label: t("清空火柴和留影", "Clear sticks and reference outlines"), run: clearMatches, disabled: (state) => !matchIds(state).length && !referenceIds(state).length },
    ] },
  ],
  setField: setMatchField,
  tap: selectMatch,
  drag: (state, target, at, delta, context) => dragMatch(state, target, at, delta, context?.previous),
  snap: settleMatch,
  selectionAfterChange: (before, after, selected) => before.params.active !== after.params.active || before.params.nextId !== after.params.nextId ? after.params.active < 0 ? null : `stick.${after.params.active}` : selected && hasSelected(after, selected) ? selected : null,
  contextActions: (state, selected) => {
    const id = matchTarget(selected), piece = id === null ? null : matchFor(state, id);
    return piece ? { bounds: matchBounds(piece), items: [{ kind: "operation", id: "move" }, { kind: "operation", id: "rotate" }, { kind: "action", id: "match-duplicate" }, { kind: "action", id: "match-remove" }] } : null;
  },
  draw: (state, api) => <MatchDrawing state={state} api={api} />,
  summary: (state, locale) => `${matchIds(state).length} ${locale === "en" ? "equal-length sticks" : "根等长火柴棒"}`,
};
