import type { ReactNode } from "react";
import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField, type PlanarSceneDefinition } from "../planar-kit/types";
import { ROLLING_ANGLE_LIMIT, ROLLING_LIMIT, ROLLING_RADIUS_MAX, ROLLING_RADIUS_MIN, ROLLING_SCENE } from "./constants";
import { addRollingPair, constructRollingPair, createRollingWorkbenchState, dragRollingPair, duplicateRollingPair, fitRollingView, interpolateRolling, removeRollingPair, rollCurrentPair, rollingExtent, rollingFromStage, rollingIds, rollingPair, rollingPairs, rollingPose, rollingScale, rollingTarget, rollingToStage, rollingTracePoints, selectRollingPair, setRollingField, setRollingFlag, type RollingPair } from "./model";
import { isValidRollingWorkbenchState } from "./validation";

const t = (zh: string, en: string) => ({ zh, en });
const fmt = (value: number) => Number(value.toFixed(3)).toString();
const colors = ["var(--leaf)", "var(--cheek)", "var(--moon)", "var(--crater)"];
const unavailable = (state: PlanarState) => !rollingPair(state);
const line = (points: readonly Point[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
function Caption({ at, children, anchor = "middle", size = 14 }: { at: Point; children: ReactNode; anchor?: "start" | "middle"; size?: number }) {
  return <text x={at.x} y={at.y} fontSize={size} textAnchor={anchor} fill="var(--ink)" stroke="var(--paper)" strokeWidth="4" paintOrder="stroke" pointerEvents="none">{children}</text>;
}
function Handle({ at, target, label, api }: { at: Point; target: string; label: string; api: PlanarDrawingApi }) {
  return <g {...api.bind(target, label)} style={{ cursor: "grab" }} data-rolling-handle={target}>
    <circle cx={at.x} cy={at.y} r="18" fill="transparent" />
    <circle cx={at.x} cy={at.y} r="7" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" pointerEvents="none" />
  </g>;
}
function PairDrawing({ state, pair, api }: { state: PlanarState; pair: RollingPair; api: PlanarDrawingApi }) {
  const scale = rollingScale(state), c = rollingToStage(pair.center, state), pose = rollingPose(pair), moving = rollingToStage(pose.center, state);
  const marker = rollingToStage(pose.marker, state), contact = rollingToStage(pose.contact, state), selected = rollingTarget(api.selected)?.id === pair.id;
  const translate = (text: ReturnType<typeof t>) => textFor(text, api.locale), selectedStroke = selected ? "var(--rose)" : "var(--crater)";
  const trace = state.flags[`trace.${pair.id}`] ? rollingTracePoints(pair) : null;
  const radians = pair.angle * Math.PI / 180, handleDistance = pair.R + (pair.inside ? -2 : 2) * pair.r;
  const rollerHandle = rollingToStage({ x: pair.center.x + handleDistance * Math.cos(radians), y: pair.center.y + handleDistance * Math.sin(radians) }, state);
  return <g data-rolling-pair={pair.id}>
    <g {...api.bind(`pair.${pair.id}`, translate(t(`搬动圆对 ${pair.id + 1}`, `Move circle pair ${pair.id + 1}`)))} style={{ cursor: api.editable ? "grab" : undefined }}>
      <circle cx={c.x} cy={c.y} r={pair.R * scale} fill={colors[pair.id % colors.length]} fillOpacity="0.13" stroke={selectedStroke} strokeWidth={selected ? 2.5 : 1.8} />
    </g>
    {state.flags[`orbit.${pair.id}`] && <circle data-rolling-orbit={pair.id} cx={c.x} cy={c.y} r={pose.orbitRadius * scale} fill="none" stroke="var(--muted)" strokeWidth="1.3" strokeDasharray="5 5" pointerEvents="none" />}
    {trace && !trace.tooDense && <polyline data-rolling-trace={pair.id} points={line(trace.points.map((point) => rollingToStage(point, state)))} fill="none" stroke="var(--rose)" strokeWidth="1.5" pointerEvents="none" />}
    {state.flags[`links.${pair.id}`] && <g data-rolling-links={pair.id} pointerEvents="none">
      <line x1={c.x} y1={c.y} x2={moving.x} y2={moving.y} stroke="var(--muted)" strokeWidth="1.4" strokeDasharray="4 4" />
      <circle cx={c.x} cy={c.y} r="4" fill="var(--paper)" stroke="var(--ink)" />
      <circle cx={contact.x} cy={contact.y} r="4" fill="var(--leaf-deep)" />
    </g>}
    <g {...api.bind(`roll.${pair.id}`, translate(t(`双向滚动小圆 ${pair.id + 1}`, `Roll circle ${pair.id + 1} in either direction`)))} style={{ cursor: api.editable ? "grab" : undefined }} data-rolling-body={pair.id}>
      <circle cx={moving.x} cy={moving.y} r={pair.r * scale} fill={colors[pair.id % colors.length]} fillOpacity="0.55" stroke="var(--ink)" strokeWidth="2" />
      <line x1={moving.x} y1={moving.y} x2={marker.x} y2={marker.y} stroke="var(--rose)" strokeWidth="3" pointerEvents="none" />
      <circle cx={marker.x} cy={marker.y} r="4.5" fill="var(--rose)" pointerEvents="none" />
      <circle cx={moving.x} cy={moving.y} r="2.5" fill="var(--ink)" pointerEvents="none" />
    </g>
    {state.flags.names && <g data-rolling-names={pair.id} pointerEvents="none">
      <Caption at={{ x: c.x, y: c.y - pair.R * scale - 14 }}>{translate(t(`圆对 ${pair.id + 1}`, `Circle pair ${pair.id + 1}`))}</Caption>
      <Caption at={{ x: moving.x + 12, y: moving.y - 10 }} size={12}>C</Caption>
      <Caption at={{ x: c.x - 12, y: c.y - 10 }} size={12}>O</Caption>
    </g>}
    {selected && api.editable && api.operation === "rolling-position" && <Handle at={c} target={`center.${pair.id}`} label={translate(t("移动固定圆心", "Move the fixed center"))} api={api} />}
    {selected && api.editable && api.operation === "rolling-radii" && <g data-rolling-radius-handles={pair.id}>
      <Handle at={rollingToStage({ x: pair.center.x, y: pair.center.y + pair.R }, state)} target={`radius.${pair.id}`} label={translate(t("调整固定圆半径", "Adjust the fixed radius"))} api={api} />
      <Handle at={rollerHandle} target={`roller.${pair.id}`} label={translate(t("沿接触方向调整滚动圆半径", "Adjust the rolling radius along the contact direction"))} api={api} />
    </g>}
    {trace?.tooDense && <Caption at={{ x: 28, y: 540 + rollingIds(state).indexOf(pair.id) * 21 }} anchor="start" size={12}>
      {translate(t(`圆对 ${pair.id + 1}：轨迹采样过密，可减少累计角度或调整半径比后观察。`, `Pair ${pair.id + 1}: trace sampling is too dense; reduce the accumulated angle or adjust the radius ratio.`))}
    </Caption>}
  </g>;
}
function RollingDrawing({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const pairs = rollingPairs(state), selected = rollingTarget(api.selected)?.id, ordered = [...pairs.filter((pair) => pair.id !== selected), ...pairs.filter((pair) => pair.id === selected)];
  return <g data-rolling-workbench="true">
    {ordered.map((pair) => <PairDrawing key={pair.id} state={state} pair={pair} api={api} />)}
    {pairs.map((pair, index) => <g key={pair.id} {...api.bind(`pair.${pair.id}`, textFor(t(`选择圆对 ${pair.id + 1}`, `Select circle pair ${pair.id + 1}`), api.locale))} data-rolling-label={pair.id}>
      <rect x={35 + index * 213} y="654" width="196" height="34" rx="5" fill={colors[pair.id % colors.length]} fillOpacity={selected === pair.id ? 0.6 : 0.23} stroke={selected === pair.id ? "var(--rose)" : "var(--line)"} />
      <Caption at={{ x: 133 + index * 213, y: 676 }} size={13}>{textFor(t(`圆对 ${pair.id + 1} · ${pair.inside ? "内滚" : "外滚"}`, `Pair ${pair.id + 1} · ${pair.inside ? "inside" : "outside"}`), api.locale)}</Caption>
    </g>)}
    {state.flags.measures && pairs.map((pair, index) => <g key={pair.id} data-rolling-measures={pair.id}>
      <Caption at={{ x: 28, y: 46 + 22 * index }} anchor="start" size={13}>
        {textFor(t(`圆对 ${pair.id + 1}`, `Pair ${pair.id + 1}`), api.locale)} · R ≈ {fmt(pair.R)} u · r ≈ {fmt(pair.r)} u · {textFor(t("绕行", "orbit"), api.locale)} ≈ {fmt(pair.angle)}° · {textFor(t("自转", "spin"), api.locale)} ≈ {fmt(rollingPose(pair).rotation)}°
      </Caption>
    </g>)}
    {!pairs.length && <Caption at={{ x: 450, y: 340 }}>{textFor(t("绘制或追加圆对，建立自己的滚动现场", "Draw or add a circle pair to build your rolling scene"), api.locale)}</Caption>}
  </g>;
}

const field = (key: string, label: ReturnType<typeof t>, min: number, max: number, read: (state: PlanarState) => number): PlanarField => ({ key, label, min, max, read, disabled: unavailable });
const play: PlanarAction = { id: "rolling-play", icon: "play", label: t("从当前位置按设定角度滚动", "Roll by the set angle from here"), duration: 1800,
  run: (state) => rollCurrentPair(state), disabled: (state) => rollCurrentPair(state) === state, interpolate: interpolateRolling };
const rewind: PlanarAction = { id: "rolling-origin", icon: "previousStep", label: t("沿原路滚回零位", "Roll back along the path to zero"), duration: 1800,
  run: (state) => rollCurrentPair(state, -(rollingPair(state)?.angle ?? 0)), disabled: (state) => !rollingPair(state)?.angle, interpolate: interpolateRolling };
const observation = (key: "orbit" | "links" | "trace", icon: PlanarAction["icon"], label: ReturnType<typeof t>): PlanarAction => ({ id: `rolling-${key}`, icon, label,
  active: (state) => !!state.flags[`${key}.${state.params.active}`], disabled: unavailable, run: (state) => setRollingFlag(state, key, !state.flags[`${key}.${state.params.active}`]) });

export const planeRollingWorkbenchScene: PlanarSceneDefinition = {
  id: ROLLING_SCENE, toolId: "plane-rolling", title: t("圆的内外滚动", "Rolling circles"), referenceGrid: false,
  description: t("同台绘制或追加独立圆对。固定圆可搬动，小圆可以从任意位置双向连续滚动；准确设置半径与累计绕行角，再按需观察自转、圆心轨道、接触连线和采样轨迹。逆时针角度为正，顺时针为负。", "Draw or add independent circle pairs. Move a fixed circle and roll its partner continuously in either direction. Set exact radii and accumulated orbit angles, then reveal spin, center orbits, contact links and sampled traces as needed. Counterclockwise is positive; clockwise is negative."),
  create: createRollingWorkbenchState, isExact: isValidRollingWorkbenchState,
  materials: [{ id: "rolling-pair", label: t("追加一个圆对", "Add a circle pair"), group: t("独立滚动材料", "Independent rolling materials"),
    preview: <svg viewBox="0 0 110 70" width="76" height="55" aria-hidden="true"><circle cx="37" cy="35" r="25" fill="var(--moon)" fillOpacity="0.4" stroke="var(--crater)" strokeWidth="2" /><circle cx="76" cy="35" r="14" fill="var(--leaf)" stroke="var(--ink)" strokeWidth="2" /><path d="M76 35H62" stroke="var(--rose)" strokeWidth="3" /></svg>,
    add: (state) => addRollingPair(state), disabled: (state) => rollingIds(state).length >= ROLLING_LIMIT || state.params.nextId >= 99999 }],
  toggles: [{ key: "names", label: t("显示圆心与材料名称", "Show center and material names") }],
  actions: [
    { id: "rolling-duplicate", icon: "duplicate", label: t("复制当前圆对", "Duplicate the current pair"), run: duplicateRollingPair, disabled: (state) => duplicateRollingPair(state) === state },
    { id: "rolling-remove", icon: "remove", label: t("移去当前圆对", "Remove the current pair"), run: removeRollingPair, disabled: unavailable },
    { id: "rolling-fit", icon: "fit", label: t("适配所有圆对的完整绕行范围", "Fit the full orbit of every pair"), run: fitRollingView, disabled: (state) => !rollingIds(state).length },
  ],
  operations: [
    { id: "rolling-position", icon: "move", label: t("圆对的准确位置", "Exact pair position"), fields: [
      field("x", t("固定圆心 X（u）", "Fixed center X (u)"), -1000, 1000, (state) => rollingPair(state)?.center.x ?? 0),
      field("y", t("固定圆心 Y（u，向上为正）", "Fixed center Y (u, positive up)"), -1000, 1000, (state) => rollingPair(state)?.center.y ?? 0),
    ] },
    { id: "rolling-radii", icon: "dimensions", label: t("半径与内外滚动", "Radii and rolling mode"), fields: [
      field("R", t("固定圆半径 R（u）", "Fixed radius R (u)"), ROLLING_RADIUS_MIN, ROLLING_RADIUS_MAX, (state) => rollingPair(state)?.R ?? 1),
      field("r", t("滚动圆半径 r（u）", "Rolling radius r (u)"), ROLLING_RADIUS_MIN, ROLLING_RADIUS_MAX, (state) => rollingPair(state)?.r ?? 1),
      { ...field("mode", t("接触方式（内滚需要 R 大于 r）", "Contact mode (inside needs R greater than r)"), 0, 1, (state) => rollingPair(state)?.inside ? 1 : 0), options: [{ value: 0, label: t("外滚", "Outside") }, { value: 1, label: t("内滚", "Inside") }] },
    ] },
    { id: "rolling-roll", icon: "rotate", label: t("累计绕行与相对播放", "Accumulated orbit and relative playback"), fields: [
      field("angle", t("累计绕行角（°，逆时针为正）", "Accumulated orbit (°, counterclockwise positive)"), -ROLLING_ANGLE_LIMIT, ROLLING_ANGLE_LIMIT, (state) => rollingPair(state)?.angle ?? 0),
      { key: "rollBy", label: t("本次增加的绕行角（°）", "Orbit angle to add (°)"), min: -36000, max: 36000 },
    ], actions: [play, rewind] },
    { id: "rolling-observe", icon: "measure", label: t("当前圆对的观察", "Observations for the current pair"), actions: [
      observation("orbit", "layers", t("显示圆心绕行轨道", "Show the center orbit")), observation("links", "edge", t("显示圆心连线与接触点", "Show center links and contact")), observation("trace", "mark", t("显示标记点采样轨迹", "Show the sampled marker trace")),
    ] },
  ],
  construction: { maxPoints: 2, tools: [{ id: "rolling-draw", label: t("拖出固定圆，建立圆对", "Draw a fixed circle to create a pair"), kind: "drag", disabled: (state) => rollingIds(state).length >= ROLLING_LIMIT || state.params.nextId >= 99999 }],
    create: (state, tool, points) => tool === "rolling-draw" ? constructRollingPair(state, points) : null,
    preview: (_tool, points, state) => { if (!state || points.length !== 2) return null; const center = rollingFromStage(points[0], state), end = rollingFromStage(points[1], state), R = Math.hypot(end.x - center.x, end.y - center.y), radius = R * rollingScale(state); return <g pointerEvents="none" data-rolling-draft><circle cx={points[0].x} cy={points[0].y} r={radius} fill="none" stroke="var(--muted)" strokeDasharray="5 5" /><circle cx={points[0].x + radius * 4 / 3} cy={points[0].y} r={radius / 3} fill="none" stroke="var(--muted)" strokeDasharray="5 5" /></g>; },
    invalidHint: t("固定圆半径需为 0.3–1000 u，新滚动圆取其三分之一；舞台最多四组圆对。", "The fixed radius must be 0.3–1000 u. The new rolling radius is one third of it; keep up to four pairs."),
  },
  setField: setRollingField, setFlag: setRollingFlag, tap: selectRollingPair, drag: dragRollingPair,
  selectionAfterChange: (before, after, selected) => {
    if (before.params.active !== after.params.active || before.params.nextId !== after.params.nextId) return after.params.active < 0 ? null : `pair.${after.params.active}`;
    const parsed = rollingTarget(selected); return parsed && rollingPair(after, parsed.id) ? `pair.${parsed.id}` : null;
  },
  contextActions: (state, selected) => {
    const target = rollingTarget(selected), pair = target && rollingPair(state, target.id);
    if (!pair) return null;
    const c = rollingToStage(pair.center, state), radius = rollingExtent(pair) * rollingScale(state);
    return { bounds: { minX: c.x - radius, maxX: c.x + radius, minY: c.y - radius, maxY: c.y + radius }, items: [{ kind: "operation", id: "rolling-position" }, { kind: "operation", id: "rolling-radii" }, { kind: "operation", id: "rolling-roll" }, { kind: "action", id: "rolling-duplicate" }, { kind: "action", id: "rolling-remove" }] };
  },
  draw: (state, api) => <RollingDrawing state={state} api={api} />,
  summary: (state, locale) => `${rollingIds(state).length} ${locale === "en" ? "independent circle pairs" : "组独立圆对"}`,
};
