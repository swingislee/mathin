import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { emptyPlanarState } from "../planar-kit/contract";
import { RightAngleMark } from "../planar-kit/geometry";
import { textFor, type PlanarAction, type PlanarActionContext, type PlanarDrawingApi, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { dragFoldProgress, dragPaperFoldProgress, foldPoint, footOnAxis, generatedPattern, paperFoldLayers, paperLayerPath, piecePoints, reflectedPoint, reflectionFrame, reflectionRoute, rollingCircle, rollingTrace, rotationFrame, snapPieceToVertices, translationFrame, unwrapAngle, type PlanePiece } from "./model";

const text = (zh: string, en: string): PlanarText => ({ zh, en });
const path = (points: readonly PlanarPoint[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const labelStyle = { fill: "var(--ink)", stroke: "var(--paper)", strokeWidth: 5, paintOrder: "stroke" as const, fontSize: 17 };
const bodyPoints = [{ x: 245, y: 280 }, { x: 315, y: 215 }, { x: 385, y: 280 }, { x: 385, y: 410 }, { x: 245, y: 410 }];
const bodyCenter = { x: bodyPoints.reduce((sum, point) => sum + point.x, 0) / bodyPoints.length, y: bodyPoints.reduce((sum, point) => sum + point.y, 0) / bodyPoints.length };
const palette = ["var(--leaf)", "var(--moon)", "var(--cheek)", "var(--crater)"];
const toggles = [{ key: "origin", label: text("保留原图", "Keep original") }, { key: "traces", label: text("对应点与轨迹", "Corresponding points and traces") }];
const animatePhase = (label: PlanarText, to: number, icon: PlanarAction["icon"] = "play"): PlanarAction => ({ id: `${icon}-${to}`, icon, label, duration: 1800, run: (state) => ({ ...state, phase: to }), interpolate: (from, target, t) => ({ ...target, phase: from.phase + (target.phase - from.phase) * t }) });
const point = (state: PlanarState, key: string, fallback: PlanarPoint) => state.points[key] ?? fallback;
const center = (state: PlanarState) => point(state, "center", { x: 480, y: 360 });
const axis = (state: PlanarState) => ({ point: center(state), angle: state.params.axisAngle ?? 90 });
const selectedTile = (state: PlanarState, context: PlanarActionContext) => context.selected?.startsWith("tile-") && Number(context.selected.slice(5)) < state.params.count ? Number(context.selected.slice(5)) : null;
function Handle({ at, id, api, label, fill = "var(--rose)" }: { at: PlanarPoint; id: string; api: PlanarDrawingApi; label: string; fill?: string }) {
  return <g {...api.bind(id, label)} style={{ cursor: "grab" }}><circle cx={at.x} cy={at.y} r={20} fill="transparent" /><circle cx={at.x} cy={at.y} r={7} fill={fill} stroke="var(--paper)" strokeWidth={2} /><text x={at.x + 12} y={at.y - 12} style={labelStyle}>{label}</text></g>;
}
function Original({ show, points = bodyPoints }: { show: boolean; points?: readonly PlanarPoint[] }) {
  return show ? <polygon points={path(points)} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="6 5" pointerEvents="none" /> : null;
}
function Sheet({ points, api, target = "body", localeLabel }: { points: readonly PlanarPoint[]; api: PlanarDrawingApi; target?: string; localeLabel: string }) {
  return <polygon {...api.bind(target, localeLabel)} points={path(points)} fill="var(--leaf)" fillOpacity={0.78} stroke="var(--ink)" strokeWidth={2.5} strokeLinejoin="round" style={{ cursor: "grab" }} />;
}
function Correspondence({ from = bodyPoints, to, visible }: { from?: readonly PlanarPoint[]; to: readonly PlanarPoint[]; visible: boolean }) {
  return visible ? <g pointerEvents="none">{from.map((p, index) => <g key={index}><line x1={p.x} y1={p.y} x2={to[index].x} y2={to[index].y} stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="4 4" /><circle cx={to[index].x} cy={to[index].y} r={4} fill="var(--rose)" /><text x={to[index].x + 8} y={to[index].y - 8} style={labelStyle}>{String.fromCharCode(65 + index)}′</text></g>)}</g> : null;
}
function Axis({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const a = axis(state), radians = a.angle * Math.PI / 180, d = { x: Math.cos(radians), y: Math.sin(radians) };
  return <g><g {...api.bind("axis", textFor(text("移动对称轴", "Move reflection axis"), api.locale))} style={{ cursor: "grab" }}><line x1={a.point.x - 300 * d.x} y1={a.point.y - 300 * d.y} x2={a.point.x + 300 * d.x} y2={a.point.y + 300 * d.y} stroke="transparent" strokeWidth={28} /><line x1={a.point.x - 300 * d.x} y1={a.point.y - 300 * d.y} x2={a.point.x + 300 * d.x} y2={a.point.y + 300 * d.y} stroke="var(--rose)" strokeWidth={2} strokeDasharray="8 5" /></g><Handle at={{ x: a.point.x + 210 * d.x, y: a.point.y + 210 * d.y }} id="axis-turn" api={api} label={textFor(text("转轴", "Turn axis"), api.locale)} /></g>;
}
function dragAxis(start: PlanarState, target: string, at: PlanarPoint, delta: PlanarPoint): PlanarState | null {
  if (target === "axis" || target === "center") return { ...start, points: { ...start.points, center: { x: center(start).x + delta.x, y: center(start).y + delta.y } } };
  if (target === "axis-turn") return { ...start, params: { ...start.params, axisAngle: Math.atan2(at.y - center(start).y, at.x - center(start).x) * 180 / Math.PI } };
  return null;
}
function initial(id: string, params: Record<string, number> = {}, points: Record<string, PlanarPoint> = {}): PlanarState {
  return { ...emptyPlanarState(id), params, points, flags: { grid: true, measures: true, origin: true, traces: true, snap: true } };
}

const translation: PlanarSceneDefinition = {
  id: "20", toolId: "plane-motion", title: text("平移与对应点", "Translation and corresponding points"), description: text("直接拖图形，所有顶点沿相同方向移动相同距离；也可准确设置位移。", "Drag the shape. Every vertex moves in the same direction by the same distance; offsets can also be set precisely."), progress: true,
  create: () => initial("20", { dx: 210, dy: -40 }), toggles,
  fields: [{ key: "dx", label: text("横向位移", "Horizontal offset"), min: -220, max: 380, step: 10 }, { key: "dy", label: text("纵向位移", "Vertical offset"), min: -160, max: 180, step: 10 }],
  actions: [animatePhase(text("播放平移", "Play translation"), 1), animatePhase(text("沿原路返回", "Return along the same path"), 0, "previousStep")],
  draw: (state, api) => { const moved = translationFrame(bodyPoints, { x: state.params.dx, y: state.params.dy }, state.phase); return <><Original show={state.flags.origin} /><Correspondence to={moved} visible={state.flags.traces} /><Sheet points={moved} api={api} localeLabel={textFor(text("拖动图形平移", "Drag to translate"), api.locale)} />{state.flags.measures && <text x={480} y={555} textAnchor="middle" style={labelStyle}>Δx = {(state.params.dx * state.phase / 40).toFixed(1)} u　Δy = {(-state.params.dy * state.phase / 40).toFixed(1)} u</text>}</>; },
  drag: (start, target, _at, delta) => target === "body" ? { ...start, phase: 1, params: { ...start.params, dx: start.params.dx * start.phase + delta.x, dy: start.params.dy * start.phase + delta.y } } : start,
};
const rotation: PlanarSceneDefinition = {
  id: "21", toolId: "plane-motion", title: text("旋转中心与角度", "Center and angle of rotation"), description: text("拖红点放置旋转中心，再抓图形绕它转；中心可以放在图形内、顶点上或外面。", "Drag the red center, then turn the shape around it. The center may be inside, at a vertex, or outside."), progress: true,
  create: () => initial("21", { angle: 90 }, { center: { x: 460, y: 365 } }), toggles,
  fields: [{ key: "angle", label: text("顺时针转角（°）", "Clockwise angle (°)"), min: -360, max: 360, step: 15 }],
  actions: [animatePhase(text("播放旋转", "Play rotation"), 1), animatePhase(text("转回原位", "Rotate back"), 0, "previousStep")],
  draw: (state, api) => { const pivot = center(state), moved = rotationFrame(bodyPoints, pivot, state.params.angle, state.phase); return <><Original show={state.flags.origin} />{state.flags.traces && bodyPoints.map((p, index) => <g key={index} pointerEvents="none"><polyline points={path(Array.from({ length: 51 }, (_, n) => rotationFrame([p], pivot, state.params.angle, state.phase * n / 50)[0]))} fill="none" stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="4 4" /><line x1={pivot.x} y1={pivot.y} x2={moved[index].x} y2={moved[index].y} stroke="var(--line)" /></g>)}<Sheet points={moved} api={api} localeLabel={textFor(text("拖动图形旋转", "Drag to rotate"), api.locale)} /><Handle at={pivot} id="center" api={api} label="O" />{state.flags.measures && <text x={pivot.x + 20} y={pivot.y + 30} style={labelStyle}>{(state.params.angle * state.phase).toFixed(0)}°</text>}</>; },
  drag: (start, target, at, delta, context) => { const movedAxis = dragAxis(start, target, at, delta); if (movedAxis) return movedAxis; if (target !== "body") return start; const pivot = center(start), from = Math.atan2(at.y - delta.y - pivot.y, at.x - delta.x - pivot.x), to = Math.atan2(at.y - pivot.y, at.x - pivot.x), previous = context?.previous ?? start; const angle = unwrapAngle(start.params.angle * start.phase + (to - from) * 180 / Math.PI, previous.params.angle * previous.phase); return { ...start, phase: 1, params: { ...start.params, angle } }; },
};
const reflection: PlanarSceneDefinition = {
  id: "22", toolId: "plane-motion", title: text("轴对称与翻折", "Reflection and folding"), description: text("搬动或转动对称轴，拖纸片翻过去；变窄的中间画面是翻折投影，不是缩放。", "Move or turn the axis, then drag the sheet to fold it over. The narrow intermediate image is a fold projection, not scaling."), progress: true,
  create: () => initial("22", { axisAngle: 90 }), toggles,
  fields: [{ key: "axisAngle", label: text("对称轴方向（°）", "Axis direction (°)"), min: -180, max: 180, step: 15 }],
  actions: [animatePhase(text("翻到另一侧", "Fold to the other side"), 1, "mirror"), animatePhase(text("翻回原侧", "Fold back"), 0, "previousStep")],
  draw: (state, api) => { const a = axis(state), moved = reflectionFrame(bodyPoints, a, state.phase); return <><Original show={state.flags.origin} /><Axis state={state} api={api} />{state.flags.traces && bodyPoints.map((p, index) => { const foot = footOnAxis(p, a), mirror = reflectedPoint(p, a); return <g key={index} pointerEvents="none"><line x1={p.x} y1={p.y} x2={mirror.x} y2={mirror.y} stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="4 4" /><RightAngleMark vertex={foot} along={{ x: foot.x + Math.cos(a.angle * Math.PI / 180) * 40, y: foot.y + Math.sin(a.angle * Math.PI / 180) * 40 }} toward={p} size={12} /></g>; })}<Sheet points={moved} api={api} localeLabel={textFor(text("拖动纸片翻折", "Drag sheet to fold"), api.locale)} />{state.flags.measures && <text x={480} y={580} style={labelStyle}>{(state.phase * 180).toFixed(0)}°</text>}</>; },
  drag: (start, target, at, delta) => dragAxis(start, target, at, delta) ?? (target === "body" ? { ...start, phase: dragFoldProgress(start.phase, delta, axis(start), bodyCenter) } : start),
};
const pattern: PlanarSceneDefinition = {
  id: "24", toolId: "plane-motion", title: text("基本片与重复图案", "Repeated motifs"), description: text("同一基本片绕中心复制，再整体搬动；慢放时能看清每一次运动。", "Repeat one motif around a center, then translate the whole pattern. Slow playback reveals each transformation."), progress: true,
  create: () => initial("24", { copies: 6 }, { center: { x: 460, y: 350 } }),
  fields: [{ key: "copies", label: text("重复份数", "Number of copies"), min: 2, max: 12, step: 1 }], toggles,
  actions: [animatePhase(text("逐片生成图案", "Build the pattern one copy at a time"), 1), animatePhase(text("收回基本片", "Return to one motif"), 0, "previousStep")],
  draw: (state, api) => { const c = center(state), motif = [{ x: c.x, y: c.y }, { x: c.x + 55, y: c.y - 75 }, { x: c.x + 15, y: c.y - 170 }, { x: c.x - 25, y: c.y - 65 }]; return <>{generatedPattern(motif, c, state.params.copies, state.phase).map((points, i) => <polygon key={i} {...api.bind("pattern", textFor(text("搬动整个图案", "Move the whole pattern"), api.locale))} points={path(points)} fill={palette[i % palette.length]} fillOpacity={0.7} stroke="var(--ink)" strokeWidth={2} style={{ cursor: "grab" }} />)}<Handle at={c} id="center" api={api} label="O" /></>; },
  drag: (start, target, at, delta) => target === "pattern" || target === "center" ? dragAxis(start, "center", at, delta)! : start,
};

const foldCut: PlanarSceneDefinition = {
  id: "32", toolId: "plane-motion", title: text("折纸与剪纸", "Fold and cut paper"), description: text("先沿折线折叠，在折好的纸层上剪一个孔，再逐层展开。剪口可移动，两次折叠可关闭。", "Fold along the crease, cut a hole through the folded layers, then unfold step by step. Move the cut or switch to one fold."), progress: true,
  create: () => ({ ...initial("32", { radius: 22 }, { center: { x: 460, y: 350 }, hole: { x: 390, y: 280 } }), flags: { grid: false, measures: true, twice: true, cut: false, traces: true } }),
  fields: [{ key: "radius", label: text("剪孔半径", "Cut radius"), min: 8, max: 35, step: 1 }], toggles: [{ key: "twice", label: text("再沿横线折一次", "Add a horizontal fold") }, { key: "traces", label: text("显示折痕", "Show creases") }],
  setField: (state, key, value) => { const c = center(state), h = state.points.hole; return { ...state, params: { ...state.params, [key]: value }, points: { ...state.points, hole: { x: Math.max(c.x - 155 + value, Math.min(c.x - value, h.x)), y: Math.max(c.y - 155 + value, Math.min(c.y - value, h.y)) } } }; },
  actions: [animatePhase(text("依次折纸", "Fold in sequence"), 1, "fold"), { id: "cut-hole", icon: "cut", label: text("剪穿纸层", "Cut through the paper layers"), run: (state) => ({ ...state, flags: { ...state.flags, cut: true } }), disabled: (state) => state.phase < 0.999 || state.flags.cut }, animatePhase(text("依次展开", "Unfold in sequence"), 0, "unfold")],
  draw: (state, api) => {
    const c = center(state), hole = state.points.hole, r = state.params.radius;
    return <>{paperFoldLayers(c, hole, r, state.phase, state.flags.twice, state.flags.cut).map((layer) => <g key={layer.key} data-paper-layer={layer.key}>
      <path {...api.bind("paper", textFor(text("拖动纸张折叠或展开", "Drag paper to fold or unfold"), api.locale))} d={paperLayerPath(layer)} fillRule="evenodd" fill={layer.right ? "var(--leaf)" : "var(--moon)"} fillOpacity={0.8} />
      <polygon points={path(layer.corners)} fill="none" stroke="var(--ink)" strokeWidth={1.6} pointerEvents="none" />
      {layer.hole && <ellipse cx={layer.hole.center.x} cy={layer.hole.center.y} rx={layer.hole.rx} ry={layer.hole.ry} fill="none" stroke="var(--crater)" strokeWidth={1.5} pointerEvents="none" />}
    </g>)}{state.flags.traces && <g stroke="var(--muted)" strokeDasharray="5 4" pointerEvents="none"><line x1={c.x} y1={c.y - 155} x2={c.x} y2={c.y + 155} />{state.flags.twice && <line x1={c.x - 155} y1={c.y} x2={c.x + 155} y2={c.y} />}</g>}<Handle at={hole} id="hole" api={api} label={textFor(text("剪口", "Cut"), api.locale)} /></>;
  },
  drag: (start, target, _at, delta) => target === "hole" ? { ...start, points: { ...start.points, hole: { x: Math.max(center(start).x - 155 + start.params.radius, Math.min(center(start).x - start.params.radius, start.points.hole.x + delta.x)), y: Math.max(center(start).y - 155 + start.params.radius, Math.min(center(start).y - start.params.radius, start.points.hole.y + delta.y)) } } } : target === "paper" ? { ...start, phase: dragPaperFoldProgress(start.phase, delta, start.flags.twice) } : start,
};

function tilePieces(state: PlanarState): PlanePiece[] {
  const sides = Math.round(state.params.sides), radius = sides === 4 ? 72 : 82;
  const points = Array.from({ length: sides }, (_, index) => ({ x: Math.cos(-Math.PI / 2 + index * Math.PI * 2 / sides) * radius, y: Math.sin(-Math.PI / 2 + index * Math.PI * 2 / sides) * radius }));
  return Array.from({ length: Math.round(state.params.count) }, (_, index) => ({ id: `tile-${index}`, points, offset: state.points[`tile${index}`] ?? { x: 330 + index * 20, y: 340 }, angle: state.params[`angle${index}`] ?? 0 }));
}
const tiling: PlanarSceneDefinition = {
  id: "36", toolId: "plane-motion", title: text("镶嵌与空隙", "Tiling and gaps"), description: text("复制材料后直接搬动，选择一片再转动；顶点附近可以吸附，留下的空隙和重叠由老师观察。", "Duplicate and drag a tile. Select a tile to rotate it; nearby vertices can snap. Observe gaps and overlaps together."),
  create: () => initial("36", { count: 1, sides: 3, selected: 0, angle: 0 }, { tile0: { x: 430, y: 345 } }),
  fields: [{ key: "sides", label: text("正多边形边数", "Regular polygon sides"), min: 3, max: 6, step: 1, options: [{ value: 3, label: text("正三角形", "Equilateral triangle") }, { value: 4, label: text("正方形", "Square") }, { value: 5, label: text("正五边形", "Regular pentagon") }, { value: 6, label: text("正六边形", "Regular hexagon") }] }, { key: "angle", label: text("所选纸片转角（°）", "Selected tile angle (°)"), min: -360, max: 360, step: 15 }],
  toggles: [{ key: "snap", label: text("顶点吸附", "Snap vertices") }],
  actions: [{ id: "duplicate-tile", icon: "duplicate", label: text("复制所选纸片", "Duplicate selected tile"), disabled: (state, context) => state.params.count >= 24 || selectedTile(state, context) === null, run: (state, context) => { const selected = selectedTile(state, context); if (selected === null) return state; const n = state.params.count, original = state.points[`tile${selected}`] ?? { x: 430, y: 345 }; return { ...state, params: { ...state.params, count: n + 1, selected: n, [`angle${n}`]: state.params[`angle${selected}`] ?? 0 }, points: { ...state.points, [`tile${n}`]: { x: original.x + 36, y: original.y + 30 } } }; } }, ...([-1, 1] as const).map((direction): PlanarAction => ({ id: `turn-${direction}`, icon: direction > 0 ? "positiveTurn" : "negativeTurn", label: text(direction > 0 ? "顺时针转 30°" : "逆时针转 30°", direction > 0 ? "Turn clockwise 30°" : "Turn counterclockwise 30°"), disabled: (state, context) => selectedTile(state, context) === null, duration: 400, run: (state, context) => { const selected = selectedTile(state, context); if (selected === null) return state; const key = `angle${selected}`, angle = (state.params[key] ?? 0) + direction * 30; return { ...state, params: { ...state.params, selected, [key]: angle, angle } }; }, interpolate: (from, to, t) => { const key = `angle${to.params.selected}`; return { ...to, params: { ...to.params, [key]: (from.params[key] ?? 0) + ((to.params[key] ?? 0) - (from.params[key] ?? 0)) * t } }; } }))],
  setField: (state, key, value) => ({ ...state, params: { ...state.params, [key]: value, ...(key === "angle" ? { [`angle${state.params.selected}`]: value } : {}) } }),
  draw: (state, api) => <>{tilePieces(state).map((tile, index) => <polygon key={tile.id} {...api.bind(tile.id, `${textFor(text("纸片", "Tile"), api.locale)} ${index + 1}`)} points={path(piecePoints(tile))} fill={palette[index % palette.length]} fillOpacity={0.72} stroke={api.selected === tile.id ? "var(--rose)" : "var(--ink)"} strokeWidth={2} style={{ cursor: "grab" }} />)}</>,
  tap: (state, target) => target.startsWith("tile-") ? { ...state, params: { ...state.params, selected: Number(target.slice(5)), angle: state.params[`angle${target.slice(5)}`] ?? 0 } } : state,
  drag: (start, target, _at, delta) => { if (!target.startsWith("tile-")) return start; const n = Number(target.slice(5)), original = start.points[`tile${n}`]; return { ...start, params: { ...start.params, selected: n, angle: start.params[`angle${n}`] ?? 0 }, points: { ...start.points, [`tile${n}`]: { x: original.x + delta.x, y: original.y + delta.y } } }; },
  snap: (state, target) => { if (!state.flags.snap) return null; const pieces = tilePieces(state), tile = pieces.find((p) => p.id === target); if (!tile) return null; const snapped = snapPieceToVertices(tile, pieces.filter((p) => p.id !== target)); return { ...state, points: { ...state.points, [`tile${target.slice(5)}`]: snapped.offset } }; },
};
const reflectionPath: PlanarSceneDefinition = {
  id: "54", toolId: "plane-motion", title: text("反射与折线路程", "Reflection and broken-line routes"), description: text("拖动直线上的接触点，比较折线路程；翻出终点的镜像，观察两段路怎样与一条直线对应。", "Drag the contact point along the line. Reflect the destination to compare the broken route with a straight route."), progress: true,
  create: () => initial("54", { axisAngle: 0, contact: -70 }, { center: { x: 450, y: 440 }, a: { x: 260, y: 235 }, b: { x: 660, y: 185 } }),
  fields: [{ key: "axisAngle", label: text("直线方向（°）", "Line direction (°)"), min: -30, max: 30, step: 5 }, { key: "contact", label: text("接触点沿线位置", "Contact position along the line"), min: -270, max: 270, step: 10 }],
  toggles: [{ key: "traces", label: text("显示对应直线路程", "Show the reflected route") }],
  actions: [animatePhase(text("翻出终点镜像", "Reflect the destination"), 1, "mirror"), animatePhase(text("收回镜像", "Return the reflected destination"), 0, "previousStep")],
  draw: (state, api) => { const a = axis(state), route = reflectionRoute(state.points.a, state.points.b, a, state.params.contact), moving = foldPoint(route.b, a, state.phase), foot = footOnAxis(route.b, a); return <><Axis state={state} api={api} /><polyline points={path([route.a, route.contact, route.b])} fill="none" stroke="var(--leaf-deep)" strokeWidth={3} />{state.flags.traces && <><polyline points={path([route.a, route.contact, moving])} fill="none" stroke="var(--rose)" strokeWidth={2} strokeDasharray="6 4" /><line x1={route.b.x} y1={route.b.y} x2={route.mirror.x} y2={route.mirror.y} stroke="var(--muted)" strokeDasharray="4 4" /><RightAngleMark vertex={foot} along={{ x: foot.x + Math.cos(a.angle * Math.PI / 180) * 50, y: foot.y + Math.sin(a.angle * Math.PI / 180) * 50 }} toward={route.b} /><circle cx={moving.x} cy={moving.y} r={6} fill="var(--rose)" /><text x={moving.x + 12} y={moving.y + 22} style={labelStyle}>B′</text></>}<Handle at={route.a} id="a" api={api} label="A" /><Handle at={route.b} id="b" api={api} label="B" /><Handle at={route.contact} id="contact" api={api} label="P" fill="var(--leaf-deep)" />{state.flags.measures && <text x={170} y={605} style={labelStyle}>AP + PB = {(route.length / 40).toFixed(2)} u</text>}</>; },
  drag: (start, target, at, delta) => { const movedAxis = dragAxis(start, target, at, delta); if (movedAxis) return movedAxis; if (target === "contact") { const a = axis(start), radians = a.angle * Math.PI / 180; return { ...start, params: { ...start.params, contact: Math.max(-270, Math.min(270, start.params.contact + delta.x * Math.cos(radians) + delta.y * Math.sin(radians))) } }; } return target === "a" || target === "b" ? { ...start, points: { ...start.points, [target]: { x: start.points[target].x + delta.x, y: start.points[target].y + delta.y } } } : start; },
};
const rolling: PlanarSceneDefinition = {
  id: "55", toolId: "plane-motion", title: text("圆的内滚与外滚", "A circle rolling inside or outside another"), description: text("拖小圆沿大圆滚动；区分圆心的绕行与圆上标记的自转。内外滚动都保持无滑动接触。", "Drag the small circle around the large one. Distinguish the center's orbit from the marked point's spin; contact remains without slipping."), progress: true,
  create: () => initial("55", { largeRadius: 140, smallRadius: 45, orbit: 360 }, { center: { x: 450, y: 355 } }),
  fields: [{ key: "largeRadius", label: text("大圆半径", "Large radius"), min: 90, max: 180, step: 5 }, { key: "smallRadius", label: text("小圆半径", "Small radius"), min: 20, max: 80, step: 5 }, { key: "orbit", label: text("绕行角度（°）", "Orbit angle (°)"), min: 90, max: 720, step: 90 }],
  toggles: [{ key: "inside", label: text("沿大圆内部滚动", "Roll inside the large circle") }, { key: "traces", label: text("保留标记轨迹", "Show the marked point's trace") }],
  actions: [animatePhase(text("播放无滑动滚动", "Play rolling without slipping"), 1), animatePhase(text("沿原路滚回", "Roll back"), 0, "previousStep")],
  draw: (state, api) => { const c = center(state), pose = rollingCircle(state.params.largeRadius, state.params.smallRadius, state.params.orbit * state.phase, state.flags.inside ?? false, c); return <><circle cx={c.x} cy={c.y} r={state.params.largeRadius} fill="var(--moon)" fillOpacity={0.25} stroke="var(--crater)" strokeWidth={2} /><circle cx={c.x} cy={c.y} r={pose.orbitRadius} fill="none" stroke="var(--muted)" strokeWidth={1} strokeDasharray="5 4" />{state.flags.traces && <polyline points={path(rollingTrace(state.params.largeRadius, state.params.smallRadius, state.params.orbit * state.phase, state.flags.inside ?? false, c))} fill="none" stroke="var(--rose)" strokeWidth={1.6} pointerEvents="none" />}<g {...api.bind("rolling-circle", textFor(text("拖动小圆滚动", "Drag the rolling circle"), api.locale))} style={{ cursor: "grab" }}><circle cx={pose.center.x} cy={pose.center.y} r={state.params.smallRadius} fill="var(--leaf)" fillOpacity={0.65} stroke="var(--ink)" strokeWidth={2.5} /><line x1={pose.center.x} y1={pose.center.y} x2={pose.marker.x} y2={pose.marker.y} stroke="var(--rose)" strokeWidth={3} /><circle cx={pose.marker.x} cy={pose.marker.y} r={6} fill="var(--rose)" /><circle cx={pose.center.x} cy={pose.center.y} r={4} fill="var(--ink)" /></g><line x1={c.x} y1={c.y} x2={pose.center.x} y2={pose.center.y} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 4" pointerEvents="none" /><circle cx={pose.contact.x} cy={pose.contact.y} r={4} fill="var(--leaf-deep)" />{state.flags.measures && <text x={180} y={610} style={labelStyle}>{textFor(text("绕行", "Orbit"), api.locale)} {pose.orbitAngle.toFixed(0)}°　{textFor(text("自转", "Spin"), api.locale)} {pose.rotation.toFixed(0)}°</text>}</>; },
  drag: (start, target, at, delta, context) => { if (target !== "rolling-circle") return start; const c = center(start), angle0 = Math.atan2(at.y - delta.y - c.y, at.x - delta.x - c.x), angle1 = Math.atan2(at.y - c.y, at.x - c.x), previous = context?.previous ?? start; const angle = unwrapAngle(start.phase * start.params.orbit + (angle1 - angle0) * 180 / Math.PI, previous.phase * previous.params.orbit); return { ...start, phase: Math.max(0, Math.min(1, angle / start.params.orbit)) }; },
};

export const planeMotionScenes: PlanarSceneDefinition[] = [translation, rotation, reflection, pattern, foldCut, tiling, reflectionPath, rolling];
