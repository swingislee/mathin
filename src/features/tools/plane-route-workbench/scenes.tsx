import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { RightAngleMark } from "../planar-kit/geometry";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { addGridCandidate, addReflectionCandidate, constructReflectionRoute, createGridRouteState, createReflectionRouteState, cycleGridCandidate, cycleReflectionCandidate, dragGridRoute, dragReflectionRoute, fitReflectionView, gridCandidate, gridCandidateIds, gridFromStage, gridPointKey, gridRoadClosed, gridRouteAnalysis, gridToStage, openGridRoads, reflectionCandidateIds, reflectionCandidateLength, reflectionContact, reflectionDirection, reflectionFoldPoint, reflectionFoot, reflectionMinimum, reflectionToStage, removeGridCandidate, removeReflectionCandidate, revealGridNumber, routeTargetId, sameGridPoint, setGridPoint, setGridRouteField, setGridRouteFlag, setReflectionRouteField, setReflectionRouteFlag, shortenGridCandidate, tapGridRoute, tapReflectionRoute } from "./model";

const text = (zh: string, en: string): PlanarText => ({ zh, en });
const colors = ["var(--rose)", "var(--leaf-deep)", "var(--crater)", "var(--ink)", "var(--muted)", "var(--rose)", "var(--leaf-deep)", "var(--crater)"];
const caption = { fill: "var(--ink)", stroke: "var(--paper)", strokeWidth: 4, paintOrder: "stroke" as const, fontSize: 15 };
const polyline = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const bounds = (points: readonly PlanarPoint[]) => ({ minX: Math.min(...points.map((point) => point.x)) - 14, minY: Math.min(...points.map((point) => point.y)) - 14, maxX: Math.max(...points.map((point) => point.x)) + 14, maxY: Math.max(...points.map((point) => point.y)) + 14 });
const decimal = (number: number) => Number(number.toFixed(3)).toString();
const candidateField: PlanarField = { key: "candidate", label: text("当前候选编号", "Current candidate number"), min: 1, max: 99999, step: 1, read: (state) => state.params.active + 1, disabled: (state) => state.params.active === -1 };

function CandidateLabels({ state, api, ids, length }: { state: PlanarState; api: PlanarDrawingApi; ids: readonly number[]; length: (id: number) => string }) {
  return <g data-route-candidates="true">
    {ids.map((id, index) => <g key={id} transform={`translate(${96 + index % 4 * 192} ${591 + Math.floor(index / 4) * 38})`} {...api.bind(`route.${id}`, `${textFor(text("选择候选路线", "Select candidate route"), api.locale)} ${id + 1}`)}>
      <rect width={180} height={31} rx={6} fill="var(--paper)" fillOpacity={0.94} stroke={state.params.active === id ? colors[index] : "var(--line)"} strokeWidth={state.params.active === id ? 2 : 1} />
      <path d="M10 16H29" stroke={colors[index]} strokeWidth={4} />
      <text x={37} y={21} style={{ ...caption, fontSize: 13 }} pointerEvents="none">R{id + 1}{state.flags.measures ? ` · ${length(id)}` : ""}</text>
    </g>)}
    {!ids.length && <text x={450} y={608} textAnchor="middle" style={caption}>{textFor(text("从右侧添加候选路线，已有点线保留", "Add a candidate from the right; the points and roads remain"), api.locale)}</text>}
  </g>;
}
function PointHandle({ at, target, label, api, fill = "var(--rose)", showLabel = true }: { at: PlanarPoint; target: string; label: string; api: PlanarDrawingApi; fill?: string; showLabel?: boolean }) {
  return <g {...api.bind(target, label)}><circle cx={at.x} cy={at.y} r={19} fill="transparent" /><circle cx={at.x} cy={at.y} r={7} fill={fill} stroke="var(--paper)" strokeWidth={2} />{showLabel && <text x={at.x + 11} y={at.y - 12} style={caption} pointerEvents="none">{label}</text>}</g>;
}

function GridDrawing({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const ids = gridCandidateIds(state), analysis = state.flags.shortest || state.params.numberStep >= 0 ? gridRouteAnalysis(state) : null;
  const numbered = new Map(analysis?.nodes.slice(0, state.params.numberStep + 1).map((entry) => [gridPointKey(entry.point), entry.count.toString()]));
  const roads: { a: PlanarPoint; b: PlanarPoint }[] = [], nodes: PlanarPoint[] = [];
  for (let y = 0; y <= state.params.rows; y++) for (let x = 0; x <= state.params.columns; x++) {
    nodes.push({ x, y });
    if (x < state.params.columns) roads.push({ a: { x, y }, b: { x: x + 1, y } });
    if (y < state.params.rows) roads.push({ a: { x, y }, b: { x, y: y + 1 } });
  }
  const ordered = [...ids.filter((id) => id !== state.params.active), ...ids.filter((id) => id === state.params.active)];
  return <g data-plane-route="grid-v2">
    <text x={58} y={42} style={caption} pointerEvents="none">{textFor(text("A 为起点，B 为终点；点选或沿道路拖动当前候选", "A is the start, B the destination; tap or trace roads for the current candidate"), api.locale)}</text>
    {api.operation === "roads" && <text x={58} y={69} style={caption} pointerEvents="none">{textFor(text("点道路封闭／还原；受影响候选保留到首个失效路段前", "Tap roads to close or reopen; affected candidates keep their valid prefix"), api.locale)}</text>}
    {roads.map(({ a, b }) => {
      const from = gridToStage(state, a), to = gridToStage(state, b), closed = gridRoadClosed(state, a, b);
      return <g key={`${gridPointKey(a)}.${gridPointKey(b)}`} {...(api.operation === "roads" ? api.bind(`road.${gridPointKey(a)}.${gridPointKey(b)}`, textFor(text("封闭或还原道路", "Close or reopen a road"), api.locale)) : {})}>
        {api.operation === "roads" && <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={23} />}
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={closed ? "var(--muted)" : "var(--ink)"} strokeWidth={1.8} opacity={closed ? 0.45 : 0.7} strokeDasharray={closed ? "3 5" : undefined} />
        {closed && <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 + 5} textAnchor="middle" style={{ ...caption, fill: "var(--rose)" }} pointerEvents="none">×</text>}
      </g>;
    })}
    {state.flags.highlights && ordered.map((id) => {
      const points = gridCandidate(state, id).map((point) => gridToStage(state, point)), steps = points.length - 1, progress = id === state.params.active ? state.phase : 1;
      return <g key={id} data-grid-candidate={id} {...api.bind(`route.${id}`, `${textFor(text("候选路线", "Candidate route"), api.locale)} ${id + 1}`)}>
        {points.slice(1).map((to, step) => { const from = points[step], visible = Math.max(0, Math.min(1, progress * steps - step)); return <line key={step} x1={from.x} y1={from.y} x2={from.x + (to.x - from.x) * visible} y2={from.y + (to.y - from.y) * visible} stroke={colors[ids.indexOf(id)]} strokeWidth={id === state.params.active ? 7 : 4} strokeOpacity={id === state.params.active ? 0.82 : 0.52} strokeLinecap="round" />; })}
        {points.length > 0 && <rect x={points.at(-1)!.x - 8} y={points.at(-1)!.y - 8} width={16} height={16} fill="none" stroke={colors[ids.indexOf(id)]} strokeWidth={2} />}
      </g>;
    })}
    {state.flags.shortest && analysis && <g data-grid-shortest="true" pointerEvents="none">
      {analysis.shortest.length > 0 && <polyline points={polyline(analysis.shortest.map((point) => gridToStage(state, point)))} fill="none" stroke="var(--leaf-deep)" strokeWidth={3} strokeDasharray="7 5" />}
      <text x={58} y={state.params.numberStep >= 0 ? 91 : 69} style={caption}>{analysis.distance === null ? textFor(text("当前条件下没有可达路线", "No route satisfies the current conditions"), api.locale) : `${textFor(text("一条最短路线", "One shortest route"), api.locale)}${state.flags.measures ? ` · ${analysis.distance} u` : ""}`}</text>
    </g>}
    {nodes.map((point) => {
      const at = gridToStage(state, point), start = sameGridPoint(point, state.points.start), end = sameGridPoint(point, state.points.end), required = state.flags.required && sameGridPoint(point, state.points.required), value = numbered.get(gridPointKey(point));
      return <g key={gridPointKey(point)} {...api.bind(`node.${gridPointKey(point)}`, `${textFor(text("格点", "Lattice point"), api.locale)} (${point.x}, ${point.y})`)}>
        <circle cx={at.x} cy={at.y} r={16} fill="transparent" />
        {(start || end || required) && <circle cx={at.x} cy={at.y} r={10} fill="var(--paper)" stroke={required ? "var(--leaf-deep)" : "var(--rose)"} strokeWidth={2} />}
        <circle cx={at.x} cy={at.y} r={start || end || required ? 5 : 3.8} fill={start || end ? "var(--rose)" : "var(--ink)"} />
        {(start || end || required || state.flags.names) && <text x={at.x + 10} y={at.y + 21} style={{ ...caption, fontSize: 12 }} pointerEvents="none">{[start ? "A" : "", end ? "B" : "", required ? "W" : ""].filter(Boolean).join("/") || `${point.x},${point.y}`}</text>}
        {value !== undefined && <text data-grid-count={gridPointKey(point)} x={at.x - 8} y={at.y - 10} textAnchor="end" style={{ ...caption, fontSize: 12 }} pointerEvents="none">{value}</text>}
      </g>;
    })}
    {api.editable && api.operation === "endpoints" && (["start", "end", ...(state.flags.required ? ["required"] : [])] as ("start" | "end" | "required")[]).map((key) => <PointHandle key={key} at={gridToStage(state, state.points[key])} target={key} label={key === "start" ? "A" : key === "end" ? "B" : "W"} api={api} />)}
    {state.params.numberStep >= 0 && <text x={58} y={69} style={caption} pointerEvents="none">{textFor(state.flags.required ? text("标数：经过 W 后到该点的最短路线数", "Counts: shortest routes to each point after visiting W") : text("标数：从 A 到该点的最短路线数", "Counts: shortest routes from A to each point"), api.locale)}</text>}
    <CandidateLabels state={state} api={api} ids={ids} length={(id) => `${gridCandidate(state, id).length - 1} u`} />
    <text x={96} y={686} style={{ ...caption, fontSize: 12 }} pointerEvents="none">{textFor(text("各候选可复用道路；长度一格为 1 u。更改范围或方向后，仅收起失效部分。", "Candidates may share roads; one edge is 1 u. Range or direction edits trim only invalid parts."), api.locale)}</text>
  </g>;
}

const gridActions: PlanarAction[] = [
  { id: "grid-route-add", icon: "add", label: text("添加独立候选路线", "Add an independent route candidate"), run: (state) => addGridCandidate(state), disabled: (state) => addGridCandidate(state) === state },
  { id: "grid-route-copy", icon: "duplicate", label: text("复制当前候选", "Duplicate the current candidate"), run: (state) => addGridCandidate(state, true), disabled: (state) => addGridCandidate(state, true) === state },
  { id: "grid-route-remove", icon: "remove", label: text("移除当前候选", "Remove the current candidate"), run: removeGridCandidate, disabled: (state) => state.params.active === -1 },
  { id: "grid-route-previous", icon: "previousStep", label: text("选择上一条候选", "Select the previous candidate"), run: (state) => cycleGridCandidate(state, -1), disabled: (state) => gridCandidateIds(state).length < 2 },
  { id: "grid-route-next", icon: "nextStep", label: text("选择下一条候选", "Select the next candidate"), run: (state) => cycleGridCandidate(state, 1), disabled: (state) => gridCandidateIds(state).length < 2 },
  { id: "grid-route-back", icon: "previousStep", label: text("当前候选退一格", "Step back on the current candidate"), run: (state) => shortenGridCandidate(state), disabled: (state) => gridCandidate(state).length <= 1 },
  { id: "grid-route-clear", icon: "clear", label: text("当前候选重新从 A 出发", "Restart the current candidate at A"), run: (state) => shortenGridCandidate(state, true), disabled: (state) => gridCandidate(state).length <= 1 },
  { id: "grid-route-replay", icon: "play", label: text("回放当前候选", "Replay the current candidate"), duration: 2400, run: (state) => ({ ...state, phase: 1 }), interpolate: (_from, to, progress) => ({ ...to, phase: progress }), disabled: (state) => gridCandidate(state).length <= 1 },
];
const gridScene: PlanarSceneDefinition = {
  id: "53-create", toolId: "plane-grid-path", title: text("格点路线与候选比较", "Lattice routes and candidate comparison"),
  description: text("自定格网、起终点、道路与必经点；多条候选可走同一条边。先自行走线，再按需展开长度、逐点标数或最短路线观察。", "Choose the grid, endpoints, roads and an optional required point. Candidates may share edges. Trace first, then reveal lengths, counts or a shortest route when useful."),
  create: createGridRouteState, referenceGrid: false, progress: true,
  materials: [{ id: "grid-route", label: text("一条新的候选路线", "A new route candidate"), group: text("添加到当前格网", "Add to this grid"), preview: <svg viewBox="0 0 100 70" width={80} height={56} aria-hidden="true"><path d="M16 54H45V20H83" fill="none" stroke="var(--leaf-deep)" strokeWidth={4} /><circle cx={16} cy={54} r={5} fill="var(--rose)" /><circle cx={83} cy={20} r={5} fill="var(--rose)" /></svg>, add: (state) => addGridCandidate(state), disabled: (state) => addGridCandidate(state) === state }],
  toggles: [{ key: "required", label: text("经过必经点 W", "Require a visit to W") }, { key: "names", label: text("显示格点坐标", "Show lattice coordinates") }, { key: "highlights", label: text("显示候选路线", "Show candidate routes") }, { key: "shortest", label: text("观察一条最短路线", "Inspect one shortest route") }],
  actions: [gridActions[0]],
  operations: [
    { id: "board", icon: "dimensions", label: text("格网尺寸与通行方向", "Grid size and travel directions"), fields: [
      { key: "columns", label: text("列数", "Columns"), min: 1, max: 12, step: 1 }, { key: "rows", label: text("行数", "Rows"), min: 1, max: 12, step: 1 },
      { key: "direction", label: text("通行方向", "Travel directions"), min: 0, max: 1, step: 1, options: [{ value: 0, label: text("只朝向终点（横纵单向）", "Toward the destination only") }, { value: 1, label: text("四向道路，允许绕行", "Four directions, including detours") }] },
    ] },
    { id: "endpoints", icon: "move", label: text("准确设置 A、B 与 W", "Set A, B and W precisely"), fields: (["start", "end", "required"] as const).flatMap((point) => (["X", "Y"] as const).map((axis) => ({ key: `${point}${axis}`, label: text(`${point === "start" ? "起点 A" : point === "end" ? "终点 B" : "必经点 W"} ${axis === "X" ? "列" : "行"}（从 0 计）`, `${point === "start" ? "Start A" : point === "end" ? "Destination B" : "Required W"} ${axis === "X" ? "column" : "row"} (zero-based)`), min: 0, max: 12, step: 1, read: (state: PlanarState) => state.points[point][axis === "X" ? "x" : "y"] }))) },
    { id: "roads", icon: "editShape", label: text("封路与还原道路", "Close or reopen roads"), actions: [{ id: "grid-roads-open", icon: "clear", label: text("还原全部道路", "Reopen every road"), run: openGridRoads, disabled: (state) => !Object.entries(state.params).some(([key, value]) => /^[hv]\./.test(key) && value !== 0) }] },
    { id: "routes", icon: "objects", label: text("候选路线与回放", "Candidate routes and replay"), fields: [candidateField], actions: gridActions.slice(1) },
    { id: "numbers", icon: "number", label: text("逐点展开最短路线条数", "Reveal shortest-route counts step by step"), actions: [
      { id: "grid-number-next", icon: "number", label: text("再标一个格点", "Reveal the next point count"), run: revealGridNumber, disabled: (state) => state.params.numberStep >= (state.params.columns + 1) * (state.params.rows + 1) - 1 },
      { id: "grid-number-clear", icon: "clear", label: text("收起所有标数", "Hide all point counts"), run: (state) => ({ ...state, params: { ...state.params, numberStep: -1 } }), disabled: (state) => state.params.numberStep < 0 },
    ] },
  ],
  construction: {
    maxPoints: 1, projectPoint: (point, state) => gridToStage(state, gridFromStage(state, point)),
    tools: (["start", "end", "required"] as const).map((id) => ({ id, kind: "point" as const, once: true, label: id === "start" ? text("指定起点 A", "Place start A") : id === "end" ? text("指定终点 B", "Place destination B") : text("指定必经点 W", "Place required point W"), hint: text("轻点格点；候选保留仍有效的部分，撤销可恢复原现场。", "Tap a lattice point. Candidates retain valid parts; undo restores the previous scene.") })),
    create: (state, tool, points) => { if (!["start", "end", "required"].includes(tool) || !points[0]) return null; const next = setGridPoint(state, tool as "start" | "end" | "required", gridFromStage(state, points[0])); return tool === "required" ? setGridRouteFlag(next, "required", true) : next === state ? null : next; },
    preview: (_tool, points) => points[0] ? <circle cx={points[0].x} cy={points[0].y} r={10} fill="none" stroke="var(--rose)" strokeDasharray="3 3" /> : null,
  },
  setField: setGridRouteField, setFlag: setGridRouteFlag, tap: tapGridRoute,
  drag: (start, target, at, _delta, context) => dragGridRoute(start, target, at, context?.previous),
  draw: (state, api) => <GridDrawing state={state} api={api} />,
  selectionAfterChange: (before, after, selected) => before.params.active !== after.params.active ? after.params.active < 0 ? null : `route.${after.params.active}` : selected,
  contextActions: (state, selected) => { const id = routeTargetId(selected), points = id === null ? [] : gridCandidate(state, id); return points.length ? { bounds: bounds(points.map((point) => gridToStage(state, point))), items: [{ kind: "operation", id: "routes" }, { kind: "action", id: "grid-route-copy" }, { kind: "action", id: "grid-route-remove" }] } : null; },
  summary: (state, locale) => `${state.params.columns} × ${state.params.rows} · ${gridCandidateIds(state).length} ${locale === "en" ? "route candidates" : "条候选路线"}`,
};

function ReflectionDrawing({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const ids = reflectionCandidateIds(state), axis = reflectionToStage(state, state.points.axis), a = reflectionToStage(state, state.points.a), b = reflectionToStage(state, state.points.b), direction = reflectionDirection(state);
  const visibleMirror = state.flags.mirror || state.phase > 0, folded = reflectionToStage(state, reflectionFoldPoint(state)), foot = reflectionToStage(state, reflectionFoot(state, state.points.b));
  const minimum = state.flags.shortest ? reflectionMinimum(state) : null;
  return <g data-plane-route="reflection-v2">
    <text x={58} y={42} style={caption} pointerEvents="none">{textFor(text("拖 A、B、直线或接触点；每条候选保持自己的接触位置", "Drag A, B, the line or a contact point; each candidate keeps its own contact"), api.locale)}</text>
    <g {...api.bind("axis", textFor(text("移动反射直线", "Move the reflection line"), api.locale))}>
      <line x1={axis.x - 1200 * direction.x} y1={axis.y + 1200 * direction.y} x2={axis.x + 1200 * direction.x} y2={axis.y - 1200 * direction.y} stroke="transparent" strokeWidth={24} />
      <line x1={axis.x - 1200 * direction.x} y1={axis.y + 1200 * direction.y} x2={axis.x + 1200 * direction.x} y2={axis.y - 1200 * direction.y} stroke="var(--muted)" strokeWidth={2} strokeDasharray="7 5" />
    </g>
    {state.flags.highlights && [...ids.filter((id) => id !== state.params.active), ...ids.filter((id) => id === state.params.active)].map((id) => {
      const contact = reflectionToStage(state, reflectionContact(state, state.params[`contact.${id}`])), color = colors[ids.indexOf(id)];
      return <g key={id} data-reflection-candidate={id}>
        <polyline {...api.bind(`route.${id}`, `${textFor(text("候选路线", "Candidate route"), api.locale)} ${id + 1}`)} points={polyline([a, contact, b])} fill="none" stroke={color} strokeWidth={id === state.params.active ? 4 : 2.2} opacity={id === state.params.active ? 0.9 : 0.55} />
        {visibleMirror && <polyline points={polyline([a, contact, folded])} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.55} pointerEvents="none" />}
        <PointHandle at={contact} target={`contact.${id}`} label={`P${id + 1}`} api={api} fill={color} showLabel={state.flags.names} />
      </g>;
    })}
    {visibleMirror && <g data-reflection-mirror="true" pointerEvents="none">
      <line x1={b.x} y1={b.y} x2={folded.x} y2={folded.y} stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="3 4" />
      {Math.hypot(b.x - foot.x, b.y - foot.y) > 1e-8 && <RightAngleMark vertex={foot} along={{ x: foot.x + direction.x * 30, y: foot.y - direction.y * 30 }} toward={b} size={11} />}
      <circle cx={folded.x} cy={folded.y} r={6} fill="var(--rose)" /><text x={folded.x + 10} y={folded.y + 20} style={caption}>{state.phase === 1 ? "B′" : textFor(text("翻折中的 B", "B during reflection"), api.locale)}</text>
    </g>}
    {minimum && <g data-reflection-shortest="true" pointerEvents="none">
      {minimum.from === minimum.to ? <><polyline points={polyline([a, reflectionToStage(state, reflectionContact(state, minimum.from)), b])} fill="none" stroke="var(--leaf-deep)" strokeWidth={3} strokeDasharray="8 4" /><circle cx={reflectionToStage(state, reflectionContact(state, minimum.from)).x} cy={reflectionToStage(state, reflectionContact(state, minimum.from)).y} r={12} fill="none" stroke="var(--leaf-deep)" strokeWidth={2} /></> : <line x1={reflectionToStage(state, reflectionContact(state, minimum.from)).x} y1={reflectionToStage(state, reflectionContact(state, minimum.from)).y} x2={reflectionToStage(state, reflectionContact(state, minimum.to)).x} y2={reflectionToStage(state, reflectionContact(state, minimum.to)).y} stroke="var(--leaf-deep)" strokeWidth={7} opacity={0.6} />}
      <text x={58} y={69} style={caption}>{textFor(minimum.from !== minimum.to ? text("绿色整段都是最短接触位置", "Every contact on the green interval is shortest") : minimum.relation === "opposite-side" ? text("两点分居直线两侧：直连经过的接触点", "Points on opposite sides: the crossing of their straight connection") : text("最短接触位置", "Shortest contact position"), api.locale)}{state.flags.measures ? ` · ≈ ${decimal(minimum.length)} u` : ""}</text>
    </g>}
    <PointHandle at={a} target="a" label="A" api={api} showLabel={state.flags.names} /><PointHandle at={b} target="b" label="B" api={api} showLabel={state.flags.names} />
    {api.editable && api.operation === "axis" && <g data-route-axis-handles="true">
      <PointHandle at={axis} target="axis" label="L" api={api} fill="var(--muted)" />
      <line x1={axis.x} y1={axis.y} x2={axis.x + direction.x * 92} y2={axis.y - direction.y * 92} stroke="var(--rose)" strokeDasharray="3 3" pointerEvents="none" />
      <PointHandle at={{ x: axis.x + direction.x * 92, y: axis.y - direction.y * 92 }} target="axis-turn" label={textFor(text("转轴", "Turn axis"), api.locale)} api={api} />
    </g>}
    <CandidateLabels state={state} api={api} ids={ids} length={(id) => `≈ ${decimal(reflectionCandidateLength(state, id))} u`} />
    <text x={96} y={686} style={{ ...caption, fontSize: 12 }} pointerEvents="none">{textFor(text("准确输入使用数学坐标 u；“适合画面”只调整观察窗，不改变点位或长度。", "Exact inputs use mathematical units u. Fit view changes only the window, not the points or lengths."), api.locale)}</text>
  </g>;
}
const reflectionActions: PlanarAction[] = [
  { id: "reflection-route-add", icon: "add", label: text("添加另一条候选路线", "Add another route candidate"), run: (state) => fitReflectionView(addReflectionCandidate(state)), disabled: (state) => addReflectionCandidate(state) === state },
  { id: "reflection-route-copy", icon: "duplicate", label: text("复制当前候选", "Duplicate the current candidate"), run: (state) => addReflectionCandidate(state, true), disabled: (state) => addReflectionCandidate(state, true) === state },
  { id: "reflection-route-remove", icon: "remove", label: text("移除当前候选", "Remove the current candidate"), run: removeReflectionCandidate, disabled: (state) => state.params.active === -1 },
  { id: "reflection-route-previous", icon: "previousStep", label: text("选择上一条候选", "Select the previous candidate"), run: (state) => cycleReflectionCandidate(state, -1), disabled: (state) => reflectionCandidateIds(state).length < 2 },
  { id: "reflection-route-next", icon: "nextStep", label: text("选择下一条候选", "Select the next candidate"), run: (state) => cycleReflectionCandidate(state, 1), disabled: (state) => reflectionCandidateIds(state).length < 2 },
];
const reflectionScene: PlanarSceneDefinition = {
  id: "54-create", toolId: "plane-reflection-path", title: text("反射路线与候选比较", "Reflection routes and candidate comparison"),
  description: text("自己指定 A、B 和任意方向直线，追加不同接触点的候选路线。先移动、比较，再按需翻出镜像、显示长度或观察最短位置。", "Place A, B and a line in any direction, then add candidates with different contact points. Move and compare first; reveal reflection, lengths or shortest contacts when useful."),
  create: createReflectionRouteState, referenceGrid: false, progress: true,
  materials: [{ id: "reflection-route", label: text("一个独立接触点与路线", "An independent contact and route"), group: text("保留当前 A、B 与直线", "Keep the current A, B and line"), preview: <svg viewBox="0 0 100 70" width={80} height={56} aria-hidden="true"><path d="M8 55H92M16 12L45 55L82 18" fill="none" stroke="var(--leaf-deep)" strokeWidth={3} /><circle cx={45} cy={55} r={5} fill="var(--rose)" /></svg>, add: (state) => fitReflectionView(addReflectionCandidate(state)), disabled: (state) => addReflectionCandidate(state) === state }],
  toggles: [{ key: "mirror", label: text("显示终点镜像", "Show the destination reflection") }, { key: "shortest", label: text("观察最短接触位置", "Inspect shortest contact positions") }, { key: "highlights", label: text("显示候选路线", "Show candidate routes") }, { key: "names", label: text("显示点的名称", "Show point names") }],
  actions: [reflectionActions[0], { id: "reflection-fit", icon: "fit", label: text("让全部材料适合画面", "Fit all materials in the view"), run: fitReflectionView }],
  operations: [
    { id: "points", icon: "move", label: text("准确编辑 A 与 B", "Edit A and B precisely"), fields: (["a", "b"] as const).flatMap((key) => (["X", "Y"] as const).map((axis) => ({ key: `${key}${axis}`, label: text(`${key.toUpperCase()} ${axis}（u）`, `${key.toUpperCase()} ${axis} (u)`), min: -1000, max: 1000, step: 0.1, read: (state: PlanarState) => state.points[key][axis === "X" ? "x" : "y"] }))) },
    { id: "axis", icon: "rotate", label: text("直线位置与任意方向", "Line position and direction"), fields: [
      ...(["X", "Y"] as const).map((axis) => ({ key: `axis${axis}`, label: text(`线上点 L ${axis}（u）`, `Point L on the line ${axis} (u)`), min: -1000, max: 1000, step: 0.1, read: (state: PlanarState) => state.points.axis[axis === "X" ? "x" : "y"] })),
      { key: "axisAngle", label: text("直线方向（°，逆时针为正）", "Line direction (°, counterclockwise positive)"), min: -180, max: 180, step: 1 },
    ] },
    { id: "routes", icon: "objects", label: text("候选接触点与路线", "Candidate contacts and routes"), fields: [candidateField, { key: "contact", label: text("当前接触点距 L 的沿线距离（u）", "Current contact distance along the line from L (u)"), min: -5000, max: 5000, step: 0.1, read: (state) => state.params[`contact.${state.params.active}`] ?? 0, disabled: (state) => state.params.active === -1 }], actions: reflectionActions.slice(1) },
    { id: "mirror", icon: "mirror", label: text("翻折终点，比较对应路线", "Reflect the destination and compare routes"), actions: ([true, false] as const).map((show): PlanarAction => ({
      id: show ? "reflection-show-mirror" : "reflection-return-mirror", icon: show ? "mirror" : "previousStep", label: show ? text("翻出 B 的镜像", "Reflect B across the line") : text("收回终点镜像", "Return the destination reflection"), duration: 1600,
      run: (state) => setReflectionRouteFlag(state, "mirror", show), interpolate: (from, to, progress) => progress >= 1 ? to : { ...to, phase: from.phase + (to.phase - from.phase) * progress },
    })) },
  ],
  construction: {
    maxPoints: 2,
    tools: [
      { id: "a", kind: "point", once: true, label: text("指定起点 A", "Place A") }, { id: "b", kind: "point", once: true, label: text("指定终点 B", "Place B") },
      { id: "axis", kind: "drag", once: true, label: text("画出反射直线", "Draw the reflection line"), hint: text("从线上一点沿所需方向拖动；候选沿线距离保留。", "Drag from a point on the line in the desired direction. Candidate distances along the line are retained.") },
      { id: "contact", kind: "point", once: true, label: text("点选新增接触路线", "Add a route at a contact"), hint: text("轻点位置垂直投到直线上，作为独立候选。", "The tapped position projects onto the line as an independent candidate."), disabled: (state) => addReflectionCandidate(state) === state },
    ],
    create: constructReflectionRoute,
    preview: (tool, points) => tool === "axis" && points.length > 1 ? <line x1={points[0].x} y1={points[0].y} x2={points.at(-1)!.x} y2={points.at(-1)!.y} stroke="var(--rose)" strokeWidth={2} strokeDasharray="5 4" /> : points[0] ? <circle cx={points[0].x} cy={points[0].y} r={8} fill="none" stroke="var(--rose)" /> : null,
    invalidHint: text("直线需要两个不同位置；材料数量最多 8 条候选，点坐标在 ±1000 u 内。", "Use two distinct positions for a line. Up to 8 candidates are supported; point coordinates stay within ±1000 u."),
  },
  setField: setReflectionRouteField, setFlag: setReflectionRouteFlag, tap: tapReflectionRoute, drag: dragReflectionRoute,
  draw: (state, api) => <ReflectionDrawing state={state} api={api} />,
  selectionAfterChange: (before, after, selected) => before.params.active !== after.params.active ? after.params.active < 0 ? null : `route.${after.params.active}` : selected,
  contextActions: (state, selected) => {
    if (selected === "a" || selected === "b") return { bounds: bounds([reflectionToStage(state, state.points[selected])]), items: [{ kind: "operation", id: "points" }] };
    const id = routeTargetId(selected);
    return id !== null && reflectionCandidateIds(state).includes(id) ? { bounds: bounds([reflectionToStage(state, reflectionContact(state, state.params[`contact.${id}`]))]), items: [{ kind: "operation", id: "routes" }, { kind: "action", id: "reflection-route-copy" }, { kind: "action", id: "reflection-route-remove" }] } : null;
  },
  summary: (state, locale) => `${reflectionCandidateIds(state).length} ${locale === "en" ? "independent contact candidates" : "个独立接触候选"}`,
};

export const planeRouteScenes: PlanarSceneDefinition[] = [gridScene, reflectionScene];
