import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarMaterial, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { NETWORK_LIMIT, addNetworkMaterial, addNetworkPoint, addNetworkSegment, clearNetworkRecords, createNetworkState, dragNetworkTarget, liftNetworkPen, networkDegree, networkFigureValid, networkGraph, networkPicks, networkRecords, parseNetworkTarget, recordNetworkFigure, removeNetworkTarget, setNetworkField, setNetworkFlag, tapNetworkTarget, type NetworkMaterial, type NetworkSceneId } from "./model";

const text = (zh: string, en: string): PlanarText => ({ zh, en });
const linePoints = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const colors = ["var(--rose)", "var(--leaf-deep)", "var(--crater)", "var(--muted)"];
const labelStyle = { fill: "var(--ink)", stroke: "var(--paper)", strokeWidth: 5, paintOrder: "stroke" as const, fontSize: 16 };
const hasTarget = (state: PlanarState, target: string | null) => { const parsed = parseNetworkTarget(target); return parsed && (parsed.kind === "node" ? state.points[`node.${parsed.id}`] !== undefined : state.params[`a.${parsed.id}`] !== undefined); };

function NetworkDrawing({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const graph = networkGraph(state), lookup = new Map(graph.nodes.map((node) => [node.id, node])), picks = networkPicks(state), records = networkRecords(state);
  const activeStroke = records.find((record) => record.kind === "stroke" && record.id === state.params.currentStroke);
  const steps = records.filter((record) => record.kind === "stroke").reduce((sum, stroke) => sum + Math.max(0, stroke.nodes.length - 1), 0);
  let offset = 0;
  return <g>
    {graph.edges.map((edge) => {
      const a = lookup.get(edge.a)!, b = lookup.get(edge.b)!, selected = state.flags.edit && api.selected === `edge.${edge.id}`;
      return <g key={`edge-${edge.id}`} {...api.bind(`edge.${edge.id}`, textFor(text("线段", "Segment"), api.locale))} style={{ cursor: state.flags.edit ? "grab" : "pointer" }}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={22} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected ? "var(--rose)" : "var(--ink)"} strokeWidth={selected ? 4 : 2.2} strokeLinecap="round" />
        {state.flags.measures && <text x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2 - 8} style={labelStyle}>{(Math.hypot(a.x - b.x, a.y - b.y) / 30).toFixed(1)} u</text>}
      </g>;
    })}
    {state.flags.highlights && records.filter((record) => record.kind !== "stroke").map((record, index) => {
      const points = record.nodes.map((id) => lookup.get(id)!);
      return record.kind === "figure" ? <polygon key={`record-${record.id}`} points={linePoints(points)} fill={colors[index % colors.length]} fillOpacity={0.12} stroke={colors[index % colors.length]} strokeWidth={4} pointerEvents="none" /> : <polyline key={`record-${record.id}`} points={linePoints(points)} fill="none" stroke={colors[index % colors.length]} strokeWidth={6} opacity={0.75} pointerEvents="none" />;
    })}
    {picks.length > 1 && <polyline points={linePoints(picks.map((id) => lookup.get(id)!))} stroke="var(--rose)" strokeWidth={2} strokeDasharray="5 5" fill="none" pointerEvents="none" />}
    {state.flags.highlights && records.filter((record) => record.kind === "stroke").flatMap((stroke, index) => stroke.nodes.slice(1).map((node, step) => {
      const from = lookup.get(stroke.nodes[step])!, to = lookup.get(node)!, progress = Math.max(0, Math.min(1, state.phase * steps - offset++));
      return <line key={`stroke-${stroke.id}-${step}`} x1={from.x} y1={from.y} x2={from.x + (to.x - from.x) * progress} y2={from.y + (to.y - from.y) * progress} stroke={colors[index % colors.length]} strokeWidth={7} opacity={0.85} strokeLinecap="round" pointerEvents="none" />;
    }))}
    {graph.nodes.map((node) => {
      const picked = picks.indexOf(node.id), degree = networkDegree(graph, node.id), current = activeStroke?.nodes.at(-1) === node.id;
      return <g key={`node-${node.id}`} {...api.bind(`node.${node.id}`, `${textFor(text("节点", "Node"), api.locale)} ${node.id + 1}`)} style={{ cursor: state.flags.edit ? "grab" : "pointer" }}>
        <circle cx={node.x} cy={node.y} r={20} fill="transparent" />
        {state.flags.intersections && degree >= 3 && <circle cx={node.x} cy={node.y} r={11} fill="var(--paper)" stroke="var(--leaf-deep)" strokeWidth={1.5} />}
        <circle cx={node.x} cy={node.y} r={picked >= 0 || current || (state.flags.edit && api.selected === `node.${node.id}`) ? 7 : 4.5} fill={picked >= 0 || current ? "var(--rose)" : "var(--ink)"} />
        {current && <circle cx={node.x} cy={node.y} r={13} stroke="var(--rose)" strokeWidth={2} fill="none" />}
        {(state.flags.names || state.flags.degrees || picked >= 0) && <text x={node.x + 12} y={node.y - 12} style={labelStyle}>{picked >= 0 ? picked + 1 : state.flags.names ? `P${node.id + 1}` : ""}{state.flags.degrees ? `${picked >= 0 || state.flags.names ? " · " : ""}${degree}` : ""}</text>}
      </g>;
    })}
  </g>;
}
function MaterialPreview({ kind }: { kind: NetworkMaterial }) {
  return <svg viewBox="0 0 100 72" aria-hidden="true" style={{ width: "100%", height: 64 }}><g fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.6}>
    {kind === "segment" && <><path d="M14 38H86" /><circle cx={14} cy={38} r={3} /><circle cx={86} cy={38} r={3} /></>}
    {kind === "rays" && <><path d="M50 60L13 22M50 60L36 12M50 60L64 12M50 60L87 22" /><circle cx={50} cy={60} r={3} /></>}
    {kind === "triangle" && <path d="M50 10L17 63H83ZM39 28H61M28 46H72M39 28L61 63M61 28L39 63M28 46L39 63M72 46L61 63" />}
    {kind === "grid" && <path d="M14 12H86V60H14ZM38 12V60M62 12V60M14 36H86" />}
  </g></svg>;
}
const materials: PlanarMaterial[] = ([
  ["segment", text("线段", "Segment")], ["rays", text("共顶点射线扇", "Shared-vertex ray fan")], ["triangle", text("三角网", "Triangular grid")], ["grid", text("方格网", "Rectangular grid")],
] as const).map(([id, label]) => ({ id: `network-${id}`, label, group: text("添加线网络", "Add a line network"), preview: <MaterialPreview kind={id} />, add: (state) => addNetworkMaterial(state, id), disabled: (state) => addNetworkMaterial(state, id) === state }));
const sharedActions: PlanarAction[] = [
  { id: "network-edit", icon: "editShape", label: text("编辑点和线", "Edit nodes and edges"), active: (state) => state.flags.edit, run: (state) => setNetworkFlag(state, "edit", !state.flags.edit) },
  { id: "network-remove", icon: "remove", label: text("删除所选点或线", "Remove the selected node or edge"), disabled: (state, context) => !hasTarget(state, context.selected), run: (state, context) => removeNetworkTarget(state, context.selected) },
];
const clearAction: PlanarAction = { id: "network-clear-records", icon: "clear", label: text("清空留痕，保留点和线", "Clear records, keep the network"), disabled: (state) => state.marks.length === 0, run: clearNetworkRecords };
const figureMode = { key: "figureMode", label: text("本次圈选对象", "Object to record"), min: 0, max: 2, step: 1, options: [{ value: 0, label: text("线段：选两个端点", "Segment: select two endpoints") }, { value: 1, label: text("角：端点—顶点—端点", "Angle: endpoint–vertex–endpoint") }, { value: 2, label: text("闭合图形：依次选顶点", "Closed figure: select vertices in order") }] };

function scene(id: NetworkSceneId): PlanarSceneDefinition {
  const paths = id === "52-create";
  return {
    id, toolId: paths ? "plane-graph-path" : "plane-patterns", title: paths ? text("一笔画与多笔画", "One-stroke and multi-stroke paths") : text("图形计数", "Counting geometric figures"),
    description: paths ? text("画出自己的线网络，再从一个点沿真实连线走访；需要时抬笔、继续与回放。", "Draw your own network and trace its real connections. Lift the pen, continue, and replay when needed.") : text("自己画线或添加网格，依次选择端点、顶点，留下完整图形的观察痕迹。", "Draw lines or add grids, then select endpoints or vertices to record whole figures."),
    create: () => createNetworkState(id), progress: paths, materials,
    fields: [
      ...(!paths ? [figureMode] : []),
      { key: "rays", label: text("新射线扇的射线数", "Rays in the next fan"), min: 2, max: 8, step: 1 },
      { key: "columns", label: text("新方格网列数", "Columns in the next grid"), min: 1, max: 5, step: 1 },
      { key: "rows", label: text("新方格网行数", "Rows in the next grid"), min: 1, max: 4, step: 1 },
      { key: "levels", label: text("新三角网层数", "Levels in the next triangular grid"), min: 1, max: 4, step: 1 },
    ],
    toggles: [
      { key: "names", label: text("显示节点名称", "Show node names") }, { key: "intersections", label: text("强调交汇点", "Highlight junctions") }, { key: "highlights", label: text("显示观察留痕", "Show recorded observations") }, { key: "snap", label: text("节点与格点吸附", "Snap to nodes and grid points") },
      ...(paths ? [{ key: "degrees", label: text("显示各点连接数", "Show node degrees") }, { key: "repeat", label: text("允许再次走同一条边", "Allow repeated edges") }] : []),
    ],
    actions: [...sharedActions, ...(paths ? [
      { id: "network-lift-pen", icon: "nextStep" as const, label: text("抬笔，从另一个点继续", "Lift the pen and start elsewhere"), disabled: (state: PlanarState) => state.params.currentStroke === -1, run: liftNetworkPen },
      { id: "network-replay", icon: "play" as const, label: text("回放连线过程", "Replay the traced path"), duration: 3000, disabled: (state: PlanarState) => !networkRecords(state).some((record) => record.nodes.length > 1), run: (state: PlanarState) => ({ ...state, phase: 1 }), interpolate: (_from: PlanarState, to: PlanarState, progress: number) => ({ ...to, phase: progress }) },
    ] : [{ id: "network-record-figure", icon: "mark" as const, label: text("留下所选图形", "Record the selected figure"), run: recordNetworkFigure, disabled: (state: PlanarState) => networkRecords(state).length >= 24 || !networkFigureValid(networkGraph(state), (["segment", "angle", "figure"] as const)[state.params.figureMode], networkPicks(state)) }]), clearAction],
    construction: {
      maxPoints: 2,
      tools: [
        { id: "node", label: text("加一个点", "Add a node"), kind: "point", hint: text("轻点舞台添加节点；点在线段上会成为新的连接点。", "Tap to add a node. A point on a line becomes a real junction."), disabled: (state) => networkGraph(state).nodes.length >= NETWORK_LIMIT },
        { id: "segment", label: text("画一条线段", "Draw a segment"), kind: "drag", hint: text("按住起点拖到终点；相交处自动成为可选择的连接点。可开启吸附精确连接已有点。", "Drag from start to end. Crossings become selectable junctions. Enable snapping to join existing nodes precisely."), disabled: (state) => networkGraph(state).edges.length >= NETWORK_LIMIT },
      ],
      create: (state, tool, points) => { const next = tool === "node" && points[0] ? addNetworkPoint(state, points[0]) : tool === "segment" && points.length >= 2 ? addNetworkSegment(state, points[0], points.at(-1)!) : state; return next === state ? null : next; },
      preview: (tool, points) => tool === "node" && points[0] ? <circle cx={points[0].x} cy={points[0].y} r={5} fill="var(--rose)" /> : points.length > 1 ? <line x1={points[0].x} y1={points[0].y} x2={points.at(-1)!.x} y2={points.at(-1)!.y} stroke="var(--rose)" strokeWidth={2} strokeDasharray="5 5" /> : null,
      invalidHint: text("请画出不同的两个端点，并保留点和线的数量余量（各最多 96）。", "Use two distinct endpoints and leave room for any crossings (up to 96 nodes and 96 edges)."),
    },
    setField: setNetworkField, setFlag: setNetworkFlag,
    draw: (state, api) => <NetworkDrawing state={state} api={api} />,
    tap: tapNetworkTarget,
    drag: (start, target, point, delta, context) => dragNetworkTarget(start, target, point, delta, context?.previous),
    selectionAfterChange: (_before, after, selected) => hasTarget(after, selected) ? selected : null,
  };
}
export const planeNetworkScenes: PlanarSceneDefinition[] = [scene("47-create"), scene("52-create")];
