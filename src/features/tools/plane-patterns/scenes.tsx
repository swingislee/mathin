import { emptyPlanarState, type PlanarPoint, type PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarActionContext, type PlanarDrawingApi, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { appendPath, boardColorCounts, dominoCells, edgeKey, figureFromVertices, graphDegree, gridGraph, gridRouteCounts, initialMatches, matchEndpoints, placeDomino, rectangleVertices, sceneGraph, snapMatch, triangleGraph, type Domino, type Matchstick, type PlaneGraph } from "./model";

const text = (zh: string, en: string): PlanarText => ({ zh, en });
const encode = (id: string) => id.replaceAll(",", "_");
const decode = (id: string) => id.replaceAll("_", ",");
const linePoints = (points: readonly PlanarPoint[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
const labelStyle = { fill: "var(--ink)", stroke: "var(--paper)", strokeWidth: 5, paintOrder: "stroke" as const, fontSize: 17 };
const colors = ["var(--rose)", "var(--leaf-deep)", "var(--crater)", "var(--muted)"];
const selectedIndex = (state: PlanarState, context: PlanarActionContext, kind: "match" | "domino") => context.selected?.startsWith(`${kind}-`) && Number(context.selected.slice(kind.length + 1)) < state.params.count ? Number(context.selected.slice(kind.length + 1)) : null;
const recordOf = (state: PlanarState, prefix: string) => state.marks.filter((mark) => mark.startsWith(`${prefix}.`)).map((mark) => mark.slice(prefix.length + 1).split(".").filter(Boolean).map(decode));
const picked = (state: PlanarState) => recordOf(state, "pick")[0] ?? [];
const figureMarks = (state: PlanarState) => recordOf(state, "figure");
const replaceRecords = (state: PlanarState, prefix: string, records: string[][]) => ({ ...state, marks: [...state.marks.filter((mark) => !mark.startsWith(`${prefix}.`)), ...records.map((record) => `${prefix}.${record.map(encode).join(".")}`)].filter((mark) => mark !== `${prefix}.`) });
const initial = (id: string): PlanarState => ({ ...emptyPlanarState(id), params: { numberStep: -1, selected: 0, angle: 0 }, flags: { grid: false, measures: false, origin: true, highlights: true, snap: true }, phase: 1 });
const blockedEdges = (state: PlanarState) => recordOf(state, "closed").map(([a, b]) => edgeKey(a, b));
function graphFor(state: PlanarState): PlaneGraph {
  const source = state.sceneId === "47" ? sceneGraph(state.flags.angles ? "angles" : "segments") : state.sceneId === "48" ? triangleGraph(state.params.levels ?? 3) : state.sceneId === "49" || state.sceneId === "53" ? gridGraph(state.params.columns ?? 4, state.params.rows ?? 3, 70, { x: 270, y: 490 }) : sceneGraph("oneStroke");
  const blocked = blockedEdges(state);
  return { ...source, edges: source.edges.filter((edge) => !blocked.includes(edgeKey(edge.a, edge.b))) };
}
function countingSelection(state: PlanarState): string[] | null {
  const graph = graphFor(state), selected = picked(state);
  if (state.sceneId === "47" && state.flags.angles) return selected.length === 2 && selected.every((id) => id !== "O") ? [selected[0], "O", selected[1]] : null;
  if (state.sceneId === "49") return selected.length === 2 ? rectangleVertices(graph, selected[0], selected[1]) : null;
  return selected.length === (state.sceneId === "48" ? 3 : 2) ? selected : null;
}
function recordFigure(state: PlanarState): PlanarState {
  const vertices = countingSelection(state);
  if (!vertices || !figureFromVertices(graphFor(state), vertices, state.sceneId !== "47")) return state;
  const existing = figureMarks(state), key = [...vertices].sort().join("|");
  if (existing.some((mark) => [...mark].sort().join("|") === key)) return replaceRecords(state, "pick", []);
  if (existing.length >= 64) return state;
  return replaceRecords(replaceRecords(state, "figure", [...existing, vertices]), "pick", []);
}
function toggleEdge(state: PlanarState, target: string): PlanarState {
  const ids = target.slice(5).split(".").map(decode), [a, b] = ids, current = recordOf(state, "closed"), key = edgeKey(a, b);
  const updated = replaceRecords(state, "closed", current.some(([from, to]) => edgeKey(from, to) === key) ? current.filter(([from, to]) => edgeKey(from, to) !== key) : [...current, ids]);
  return { ...updated, marks: updated.marks.filter((mark) => !/^(figure|pick|stroke)\./.test(mark)), params: { ...updated.params, numberStep: -1 } };
}
function selectCountingPoint(state: PlanarState, target: string): PlanarState {
  if (target.startsWith("edge.") && state.flags.editEdges) return toggleEdge(state, target);
  if (!target.startsWith("point.")) return state;
  const id = decode(target.slice(6));
  if (state.sceneId === "47" && state.flags.angles && id === "O") return state;
  const previous = picked(state), max = state.sceneId === "48" ? 3 : 2;
  const next = previous.includes(id) ? previous.filter((item) => item !== id) : [...(previous.length >= max ? [] : previous), id];
  return replaceRecords(state, "pick", [next]);
}
function fullGraphFor(state: PlanarState) { return graphFor({ ...state, marks: state.marks.filter((mark) => !mark.startsWith("closed.")) }); }
function GraphDrawing({ state, api, paths = false }: { state: PlanarState; api: PlanarDrawingApi; paths?: boolean }) {
  const graph = fullGraphFor(state), lookup = new Map(graph.points.map((point) => [point.id, point])), blocked = blockedEdges(state), selection = picked(state);
  const selectedVertices = countingSelection(state), selectedFigure = selectedVertices && figureFromVertices(graphFor(state), selectedVertices, state.sceneId !== "47") ? selectedVertices : null, marks = state.flags.highlights ? figureMarks(state) : [];
  const strokes = recordOf(state, "stroke"), steps = strokes.reduce((sum, stroke) => sum + Math.max(0, stroke.length - 1), 0), visibleSteps = steps * state.phase;
  const angle = state.sceneId === "49" && state.flags.tilted ? -35 : 0;
  const numbered = state.sceneId === "53" ? [...graph.points].sort((a, b) => { const [ax, ay] = a.id.split(",").map(Number), [bx, by] = b.id.split(",").map(Number); return ax + ay - bx - by || ax - bx; }).slice(0, state.params.numberStep + 1).map((p) => p.id) : [];
  const through = recordOf(state, "through")[0]?.[0], counts = state.sceneId === "53" ? gridRouteCounts(state.params.columns ?? 4, state.params.rows ?? 3, blocked, through) : {};
  let offset = 0;
  return <g transform={`rotate(${angle} 455 380)`}>
    {graph.edges.map((edge) => { const a = lookup.get(edge.a)!, b = lookup.get(edge.b)!, closed = blocked.includes(edgeKey(edge.a, edge.b)); return <g key={edgeKey(edge.a, edge.b)} {...(state.flags.editEdges ? api.bind(`edge.${encode(edge.a)}.${encode(edge.b)}`, textFor(text("切换这条边", "Toggle this edge"), api.locale)) : {})}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={25} /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={closed ? "var(--line)" : "var(--ink)"} strokeDasharray={closed ? "4 5" : undefined} strokeWidth={2} />{closed && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 5} fill="var(--rose)" textAnchor="middle">×</text>}</g>; })}
    {[...marks, ...(selectedFigure ? [selectedFigure] : [])].map((vertices, index) => { const points = vertices.map((id) => lookup.get(id)).filter((p): p is NonNullable<typeof p> => p !== undefined); const close = state.sceneId !== "47"; return close ? <polygon key={`figure-${index}`} points={linePoints(points)} fill={colors[index % colors.length]} fillOpacity={0.1} stroke={colors[index % colors.length]} strokeWidth={3.5} pointerEvents="none" /> : <polyline key={`figure-${index}`} points={linePoints(points)} fill="none" stroke={colors[index % colors.length]} strokeWidth={6} opacity={0.7} pointerEvents="none" />; })}
    {paths && strokes.flatMap((stroke, strokeIndex) => stroke.slice(1).map((id, index) => { const from = lookup.get(stroke[index])!, to = lookup.get(id)!, t = Math.max(0, Math.min(1, visibleSteps - offset++)); return <line key={`path-${strokeIndex}-${index}`} x1={from.x} y1={from.y} x2={from.x + (to.x - from.x) * t} y2={from.y + (to.y - from.y) * t} stroke={colors[strokeIndex % colors.length]} strokeWidth={7} opacity={0.8} strokeLinecap="round" pointerEvents="none" />; }))}
    {graph.points.map((point, index) => <g key={point.id} {...api.bind(`point.${encode(point.id)}`, `${textFor(text("点", "Point"), api.locale)} ${point.id}`)} style={{ cursor: "pointer" }}><circle cx={point.x} cy={point.y} r={21} fill="transparent" /><circle cx={point.x} cy={point.y} r={selection.includes(point.id) || through === point.id ? 9 : 5} fill={selection.includes(point.id) ? "var(--rose)" : through === point.id ? "var(--leaf-deep)" : "var(--ink)"} /><text x={point.x + 10} y={point.y - 12} transform={`rotate(${-angle} ${point.x + 10} ${point.y - 12})`} style={labelStyle}>{state.sceneId === "53" ? numbered.includes(point.id) ? counts[point.id] ?? 0 : "" : state.flags.degrees ? graphDegree(graphFor(state), point.id) : state.sceneId === "48" || state.sceneId === "49" ? String.fromCharCode(65 + index) : point.id}</text></g>)}
    {paths && strokes.map((stroke, index) => { const first = lookup.get(stroke[0]), last = lookup.get(stroke.at(-1) ?? ""); return first && last ? <g key={`ends-${index}`} pointerEvents="none"><circle cx={first.x} cy={first.y} r={13} fill="none" stroke={colors[index % colors.length]} strokeWidth={2} /><rect x={last.x - 10} y={last.y - 10} width={20} height={20} fill="none" stroke={colors[index % colors.length]} strokeWidth={2} /></g> : null; })}
  </g>;
}
function SavedFigures({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const graph = fullGraphFor(state), records = figureMarks(state);
  return <g aria-label={textFor(text("已留痕图形", "Recorded figures"), api.locale)}>{records.slice(-8).map((vertices, index) => { const points = vertices.map((id) => graph.points.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => p !== undefined); if (!points.length) return null; const minX = Math.min(...points.map((p) => p.x)), minY = Math.min(...points.map((p) => p.y)), width = Math.max(...points.map((p) => p.x)) - minX, height = Math.max(...points.map((p) => p.y)) - minY, scale = 52 / Math.max(52, width, height), pointsText = linePoints(points.map((p) => ({ x: (p.x - minX) * scale, y: (p.y - minY) * scale }))); return <g key={index} transform={`translate(${160 + index * 78} 585)`}><text y={-13} style={labelStyle}>{records.length - Math.min(records.length, 8) + index + 1}</text>{state.sceneId === "47" ? <polyline points={pointsText} fill="none" stroke={colors[index % colors.length]} strokeWidth={2} /> : <polygon points={pointsText} fill="var(--moon)" stroke={colors[index % colors.length]} strokeWidth={1.5} />}</g>; })}</g>;
}
const countingActions: PlanarAction[] = [{ id: "record-selection", icon: "mark", label: text("把所选图形留下来", "Record the selected figure"), run: recordFigure, disabled: (state) => { const selected = countingSelection(state); return figureMarks(state).length >= 64 || !selected || !figureFromVertices(graphFor(state), selected, state.sceneId !== "47"); } }, { id: "clear-records", icon: "clear", label: text("清空观察留痕", "Clear recorded observations"), run: (state) => ({ ...state, marks: state.marks.filter((mark) => !mark.startsWith("pick.") && !mark.startsWith("figure.")) }) }];
const countToggles = [{ key: "highlights", label: text("显示已记录的完整轮廓", "Show recorded outlines") }];
const countDraw: PlanarSceneDefinition["draw"] = (state, api) => <><GraphDrawing state={state} api={api} /><SavedFigures state={state} api={api} /></>;
const countDrag: PlanarSceneDefinition["drag"] = (start, target, at) => { if (start.sceneId !== "49" || !target.startsWith("point.")) return start; const graph = graphFor(start), angle = start.flags.tilted ? 35 * Math.PI / 180 : 0, x = at.x - 455, y = at.y - 380, unrotated = { x: 455 + x * Math.cos(angle) - y * Math.sin(angle), y: 380 + x * Math.sin(angle) + y * Math.cos(angle) }; const nearest = [...graph.points].sort((a, b) => Math.hypot(a.x - unrotated.x, a.y - unrotated.y) - Math.hypot(b.x - unrotated.x, b.y - unrotated.y))[0]; return replaceRecords(start, "pick", [[decode(target.slice(6)), nearest.id]]); };

const segments: PlanarSceneDefinition = { id: "47", toolId: "plane-patterns", title: text("线段与角的完整对象", "Whole segments and angles"), description: text("选两个端点，或选同一顶点的两条射线，再留下完整轮廓；先观察，不预报总数。", "Select two endpoints, or two rays from one vertex, and record the whole object. Observe before revealing any total."), create: () => initial("47"), toggles: [{ key: "angles", label: text("切换为多射线角", "Switch to angles between rays") }, ...countToggles], actions: countingActions, draw: countDraw, tap: selectCountingPoint, setFlag: (state, key, value) => ({ ...state, flags: { ...state.flags, [key]: value }, marks: key === "angles" ? [] : state.marks }) };
const triangles: PlanarSceneDefinition = { id: "48", toolId: "plane-patterns", title: text("三角形的层与朝向", "Triangles by size and orientation"), description: text("依次选择三个顶点，完整边围出的三角形可以留痕；跨层大图形与倒三角都能单独观察。", "Select three vertices and record triangles bounded by existing lines. Inspect large composite and inverted triangles individually."), create: () => ({ ...initial("48"), params: { levels: 3 } }), fields: [{ key: "levels", label: text("三角网层数", "Triangle grid levels"), min: 2, max: 4, step: 1 }], toggles: countToggles, actions: countingActions, draw: countDraw, tap: selectCountingPoint, setField: (state, key, value) => ({ ...state, params: { ...state.params, [key]: value }, marks: [] }) };
const rectangles: PlanarSceneDefinition = { id: "49", toolId: "plane-patterns", title: text("方格中的正方形与长方形", "Squares and rectangles in a grid"), description: text("拖两个对角点框出一个完整图形；可倾斜整张网格，也可拿掉一段边再观察。", "Drag between opposite corners to select a whole figure. Tilt the grid or remove an edge to compare."), create: () => ({ ...initial("49"), params: { columns: 4, rows: 3 } }), fields: [{ key: "columns", label: text("列数", "Columns"), min: 2, max: 6, step: 1 }, { key: "rows", label: text("行数", "Rows"), min: 2, max: 4, step: 1 }], toggles: [...countToggles, { key: "tilted", label: text("斜放网格", "Tilt the grid") }, { key: "editEdges", label: text("点击线段切换缺边", "Tap an edge to remove or restore it") }], actions: countingActions, draw: countDraw, tap: selectCountingPoint, drag: countDrag, setField: (state, key, value) => ({ ...state, params: { ...state.params, [key]: value }, marks: [] }) };

function matchesFor(state: PlanarState): Matchstick[] {
  return Array.from({ length: state.params.count }, (_, index) => ({ id: `match-${index}`, center: state.points[`match${index}`] ?? { x: 450, y: 350 }, angle: state.params[`angle${index}`] ?? 0, length: 100 }));
}
function matchesInitial(): PlanarState {
  const matches = initialMatches(), state = initial("51");
  return { ...state, points: Object.fromEntries(matches.map((match, index) => [`match${index}`, match.center])), params: { ...state.params, count: matches.length, ...Object.fromEntries(matches.map((match, index) => [`angle${index}`, match.angle])) } };
}
const matches: PlanarSceneDefinition = {
  id: "51", toolId: "plane-patterns", title: text("火柴棒与共用边", "Matchsticks and shared sides"), description: text("直接移动一根棒，选中后转动；细虚线保留原位，方便观察一根共边影响了哪些图形。", "Drag a stick, select it to rotate, and compare with its dashed original position. One shared side can affect several figures."), create: matchesInitial,
  fields: [{ key: "angle", label: text("所选火柴转角（°）", "Selected stick angle (°)"), min: -360, max: 360, step: 15 }], toggles: [{ key: "snap", label: text("端点吸附", "Snap endpoints") }, { key: "origin", label: text("保留初始轮廓", "Keep the initial outline") }],
  actions: [{ id: "add-match", icon: "add", label: text("拿一根火柴棒", "Add a matchstick"), disabled: (state) => state.params.count >= 48, run: (state) => { const n = state.params.count; return { ...state, params: { ...state.params, count: n + 1, selected: n, angle: 0, [`angle${n}`]: 0 }, points: { ...state.points, [`match${n}`]: { x: 390, y: 235 } } }; } }, ...([-1, 1] as const).map((direction): PlanarAction => ({ id: `rotate-match-${direction}`, icon: direction > 0 ? "positiveTurn" : "negativeTurn", label: text(direction > 0 ? "顺时针转 45°" : "逆时针转 45°", direction > 0 ? "Turn clockwise 45°" : "Turn counterclockwise 45°"), disabled: (state, context) => selectedIndex(state, context, "match") === null, duration: 450, run: (state, context) => { const selected = selectedIndex(state, context, "match"); if (selected === null) return state; const key = `angle${selected}`, value = (state.params[key] ?? 0) + direction * 45; return { ...state, params: { ...state.params, selected, [key]: value, angle: value } }; }, interpolate: (from, to, t) => { const key = `angle${to.params.selected}`; return { ...to, params: { ...to.params, [key]: (from.params[key] ?? 0) + ((to.params[key] ?? 0) - (from.params[key] ?? 0)) * t } }; } }))],
  setField: (state, key, value) => ({ ...state, params: { ...state.params, [key]: value, ...(key === "angle" ? { [`angle${state.params.selected}`]: value } : {}) } }),
  draw: (state, api) => <>{state.flags.origin && initialMatches().map((match) => { const [a, b] = matchEndpoints(match); return <line key={`origin-${match.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="5 4" />; })}{matchesFor(state).map((match, index) => { const [a, b] = matchEndpoints(match); return <g key={match.id} {...api.bind(match.id, `${textFor(text("火柴棒", "Matchstick"), api.locale)} ${index + 1}`)} style={{ cursor: "grab" }}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={28} /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={api.selected === match.id ? "var(--rose)" : "var(--crater)"} strokeWidth={8} strokeLinecap="round" /><circle cx={a.x} cy={a.y} r={7} fill="var(--rose)" /></g>; })}</>,
  tap: (state, target) => target.startsWith("match-") ? { ...state, params: { ...state.params, selected: Number(target.slice(6)), angle: state.params[`angle${target.slice(6)}`] ?? 0 } } : state,
  drag: (start, target, _at, delta) => { if (!target.startsWith("match-")) return start; const key = `match${target.slice(6)}`; return { ...start, params: { ...start.params, selected: Number(target.slice(6)), angle: start.params[`angle${target.slice(6)}`] ?? 0 }, points: { ...start.points, [key]: { x: start.points[key].x + delta.x, y: start.points[key].y + delta.y } } }; },
  snap: (state, target) => { if (!state.flags.snap) return null; const matches = matchesFor(state), match = matches.find((item) => item.id === target); if (!match) return null; const snapped = snapMatch(match, matches.filter((item) => item.id !== target)); return { ...state, points: { ...state.points, [`match${target.slice(6)}`]: snapped.center } }; },
};

function pathTap(state: PlanarState, target: string): PlanarState {
  if (target.startsWith("edge.") && state.flags.editEdges) return toggleEdge(state, target);
  if (!target.startsWith("point.")) return state;
  const id = decode(target.slice(6));
  if (state.flags.requiredPoint && state.sceneId === "53") return replaceRecords(state, "through", [[id]]);
  const previous = recordOf(state, "stroke"), strokes = state.flags.lifted ? [...previous, []] : previous.length ? previous : [[]];
  const next = appendPath(fullGraphFor(state), strokes, id, state.flags.repeat ?? false, blockedEdges(state), state.sceneId === "53");
  if (next.length > 48 || next.some((stroke) => `stroke.${stroke.map(encode).join(".")}`.length > 64)) return state;
  return { ...replaceRecords(state, "stroke", next), phase: 1, flags: { ...state.flags, lifted: false } };
}
const pathDrag: PlanarSceneDefinition["drag"] = (start, target, at, _delta, context) => {
  if (!target.startsWith("point.") || start.flags.requiredPoint || start.flags.editEdges) return start;
  let current = context?.previous ?? start;
  if (current === start || current.flags.lifted || !recordOf(current, "stroke").length) current = pathTap(current, target);
  const nearby = [...fullGraphFor(current).points].sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0];
  return nearby && Math.hypot(nearby.x - at.x, nearby.y - at.y) <= 26 ? pathTap(current, `point.${encode(nearby.id)}`) : current;
};
const pathActions: PlanarAction[] = [
  { id: "lift-pen", icon: "nextStep", label: text("抬笔，另起一笔", "Lift the pen and start a new stroke"), disabled: (state) => recordOf(state, "stroke").length >= 48, run: (state) => ({ ...state, flags: { ...state.flags, lifted: true } }) },
  { id: "replay-path", icon: "play", label: text("回放已走路线", "Replay the recorded routes"), duration: 3000, run: (state) => ({ ...state, phase: 1 }), interpolate: (from, target, t) => ({ ...target, phase: t }), disabled: (state) => !recordOf(state, "stroke").some((path) => path.length > 1) },
  { id: "clear-paths", icon: "clear", label: text("清空已走路线", "Clear recorded routes"), run: (state) => replaceRecords(state, "stroke", []) },
];
const oneStroke: PlanarSceneDefinition = {
  id: "52", toolId: "plane-patterns", title: text("一笔画与多笔画", "One-stroke and multi-stroke paths"), description: text("按相邻点顺序走线，起点画圈、当前终点画方框；可抬笔继续，或用撤销退一步。", "Follow connected vertices. Circles mark starts and squares mark endpoints. Lift the pen for another stroke, or undo a step."), create: () => initial("52"), progress: true,
  toggles: [{ key: "repeat", label: text("允许重复走同一条边", "Allow repeated edges") }, { key: "degrees", label: text("显示每个点连接的边数", "Show vertex degrees") }, { key: "editEdges", label: text("点击线段开关连线", "Tap edges to change connections") }], actions: pathActions, draw: (state, api) => <GraphDrawing state={state} api={api} paths />, tap: pathTap, drag: pathDrag,
};
const gridPaths: PlanarSceneDefinition = {
  id: "53", toolId: "plane-patterns", title: text("格点路线与逐点标数", "Grid routes and step-by-step counts"), description: text("沿格线只向右或向上走；另起一笔比较路线，也可封路或放一个必经点。逐点标数由老师主动展开。", "Move right or up along grid edges. Compare routes, close an edge, or set a required vertex. Reveal path counts one point at a time."), create: () => ({ ...initial("53"), params: { columns: 4, rows: 3, numberStep: -1 } }), progress: true,
  fields: [{ key: "columns", label: text("列数", "Columns"), min: 2, max: 6, step: 1 }, { key: "rows", label: text("行数", "Rows"), min: 2, max: 4, step: 1 }],
  toggles: [{ key: "editEdges", label: text("点击线段封路或开路", "Tap edges to close or open roads") }, { key: "requiredPoint", label: text("点击一个点设为必经点", "Tap a required vertex") }],
  actions: [...pathActions, { id: "number-next-point", icon: "number", label: text("再标一个格点", "Reveal the next vertex count"), disabled: (state) => state.params.numberStep >= (state.params.columns + 1) * (state.params.rows + 1) - 1, run: (state) => ({ ...state, params: { ...state.params, numberStep: state.params.numberStep + 1 } }) }, { id: "clear-required", icon: "remove", label: text("移除必经点", "Remove the required vertex"), run: (state) => replaceRecords(state, "through", []) }],
  draw: (state, api) => <><GraphDrawing state={state} api={api} paths /><text x={270} y={540} style={labelStyle}>{textFor(text("只向右、向上；圈表示起点，方框表示当前终点", "Move right or up; circles are starts and squares are current endpoints"), api.locale)}</text></>, tap: pathTap, drag: pathDrag,
  setField: (state, key, value) => ({ ...state, params: { ...state.params, [key]: value, numberStep: -1 }, marks: [] }),
};

const BOARD = { x: 270, y: 150, cell: 62, size: 6 };
const missingCells = (state: PlanarState) => recordOf(state, "missing").flat();
function dominoesFor(state: PlanarState): Domino[] { return Array.from({ length: state.params.count }, (_, index) => ({ id: `domino-${index}`, column: state.points[`domino${index}`]?.x ?? 0, row: state.points[`domino${index}`]?.y ?? 0, vertical: state.flags[`vertical${index}`] ?? false })); }
function nextDomino(state: PlanarState): Domino | null {
  const others = dominoesFor(state), removed = missingCells(state);
  for (let row = 0; row < BOARD.size; row++) for (let column = 0; column < BOARD.size; column++) {
    const candidate = { id: `domino-${state.params.count}`, column, row, vertical: state.flags.vertical ?? false };
    if (placeDomino(candidate, others, removed)) return candidate;
  }
  return null;
}
const domino: PlanarSceneDefinition = {
  id: "57", toolId: "plane-patterns", title: text("棋盘染色与多米诺覆盖", "Checkerboard coloring and dominoes"), description: text("摆放、转动一块骨牌，每次覆盖两个相邻格；移去格子后观察颜色数量，不直接宣判能否铺满。", "Move or turn a domino over two neighboring cells. Remove cells and compare colors without an automatic solvability verdict."),
  create: () => ({ ...initial("57"), params: { count: 1, selected: 0 }, points: { domino0: { x: 1, y: 2 } }, flags: { grid: false, coloring: true, counts: false, vertical: false, removeCells: false } }),
  toggles: [{ key: "coloring", label: text("棋盘双色染色", "Color the checkerboard") }, { key: "counts", label: text("显示未覆盖格的颜色数量", "Count colors of uncovered cells") }, { key: "removeCells", label: text("点击空格移去或还原", "Tap an empty cell to remove or restore it") }, { key: "vertical", label: text("新增骨牌竖放", "Add vertical dominoes") }],
  actions: [{ id: "add-domino", icon: "add", label: text("拿一块骨牌", "Add a domino"), disabled: (state) => state.params.count >= 18 || nextDomino(state) === null, run: (state) => { const piece = nextDomino(state); if (!piece) return state; const n = state.params.count; return { ...state, params: { ...state.params, count: n + 1, selected: n, [`turn${n}`]: piece.vertical ? 90 : 0 }, points: { ...state.points, [`domino${n}`]: { x: piece.column, y: piece.row } }, flags: { ...state.flags, [`vertical${n}`]: piece.vertical } }; } }, { id: "turn-domino", icon: "positiveTurn", label: text("转动所选骨牌", "Turn the selected domino"), disabled: (state, context) => { const n = selectedIndex(state, context, "domino"); if (n === null) return true; const pieces = dominoesFor(state), selected = pieces[n]; return !selected || !placeDomino({ ...selected, vertical: !selected.vertical }, pieces, missingCells(state)); }, duration: 450, run: (state, context) => { const n = selectedIndex(state, context, "domino"); if (n === null) return state; const vertical = !state.flags[`vertical${n}`]; return { ...state, params: { ...state.params, selected: n, [`turn${n}`]: vertical ? 90 : 0 }, flags: { ...state.flags, [`vertical${n}`]: vertical } }; }, interpolate: (from, to, t) => { const n = to.params.selected, a = from.flags[`vertical${n}`] ? 90 : 0, b = to.flags[`vertical${n}`] ? 90 : 0; return { ...to, params: { ...to.params, [`turn${n}`]: a + (b - a) * t } }; } }, { id: "clear-dominoes", icon: "clear", label: text("收起所有骨牌", "Clear all dominoes"), run: (state) => ({ ...state, params: { count: 0, selected: 0 }, points: {} }) }],
  draw: (state, api) => { const removed = missingCells(state), pieces = dominoesFor(state), counts = boardColorCounts(removed, pieces); return <>{Array.from({ length: 36 }, (_, index) => { const column = index % 6, row = Math.floor(index / 6), key = `${column},${row}`, missing = removed.includes(key); return <g key={key} {...(state.flags.removeCells ? api.bind(`cell.${column}_${row}`, textFor(text("移去或还原格子", "Remove or restore cell"), api.locale)) : {})}><rect x={BOARD.x + column * BOARD.cell} y={BOARD.y + row * BOARD.cell} width={BOARD.cell} height={BOARD.cell} fill={missing ? "none" : state.flags.coloring && (column + row) % 2 === 0 ? "var(--crater)" : "var(--paper)"} fillOpacity={0.8} stroke="var(--line)" strokeDasharray={missing ? "3 5" : undefined} /><rect x={BOARD.x + column * BOARD.cell} y={BOARD.y + row * BOARD.cell} width={BOARD.cell} height={BOARD.cell} fill="transparent" />{missing && <text x={BOARD.x + (column + 0.5) * BOARD.cell} y={BOARD.y + (row + 0.62) * BOARD.cell} textAnchor="middle" fill="var(--muted)">×</text>}</g>; })}{pieces.map((piece, index) => { const p = { x: BOARD.x + (piece.column + 0.5) * BOARD.cell, y: BOARD.y + (piece.row + 0.5) * BOARD.cell }, angle = state.params[`turn${index}`] ?? (piece.vertical ? 90 : 0); return <g key={piece.id} {...api.bind(piece.id, `${textFor(text("骨牌", "Domino"), api.locale)} ${index + 1}`)} transform={`translate(${p.x} ${p.y}) rotate(${angle})`} style={{ cursor: "grab" }}><rect x={-BOARD.cell / 2 + 4} y={-BOARD.cell / 2 + 4} width={BOARD.cell * 2 - 8} height={BOARD.cell - 8} rx={9} fill="var(--leaf)" fillOpacity={0.7} stroke={api.selected === piece.id ? "var(--rose)" : "var(--leaf-deep)"} strokeWidth={2} /><line x1={BOARD.cell / 2} y1={-BOARD.cell / 2 + 8} x2={BOARD.cell / 2} y2={BOARD.cell / 2 - 8} stroke="var(--leaf-deep)" strokeDasharray="4 4" /></g>; })}{state.flags.counts && <text x={270} y={570} style={labelStyle}>{textFor(text("未覆盖：深色", "Uncovered: dark"), api.locale)} {counts.light}　{textFor(text("浅色", "light"), api.locale)} {counts.dark}</text>}</>; },
  tap: (state, target) => { if (target.startsWith("domino-")) return { ...state, params: { ...state.params, selected: Number(target.slice(7)) } }; if (target.startsWith("cell.") && state.flags.removeCells) { const cell = decode(target.slice(5)); if (dominoesFor(state).some((piece) => dominoCells(piece).includes(cell))) return state; const missing = missingCells(state); return replaceRecords(state, "missing", (missing.includes(cell) ? missing.filter((id) => id !== cell) : [...missing, cell]).map((id) => [id])); } return state; },
  drag: (start, target, _at, delta) => { if (!target.startsWith("domino-")) return start; const n = Number(target.slice(7)), key = `domino${n}`, original = start.points[key]; return { ...start, params: { ...start.params, selected: n }, points: { ...start.points, [`home${n}`]: original, [key]: { x: original.x + delta.x / BOARD.cell, y: original.y + delta.y / BOARD.cell } } }; },
  snap: (state, target) => { if (!target.startsWith("domino-")) return null; const n = Number(target.slice(7)), key = `domino${n}`, pieces = dominoesFor(state), piece = pieces[n], candidate = { ...piece, column: Math.round(piece.column), row: Math.round(piece.row) }; return { ...state, points: { ...state.points, [key]: placeDomino(candidate, pieces, missingCells(state)) ? { x: candidate.column, y: candidate.row } : state.points[`home${n}`] ?? { x: 0, y: 0 } } }; },
};

export const planePatternsScenes: PlanarSceneDefinition[] = [segments, triangles, rectangles, matches, oneStroke, gridPaths, domino];
