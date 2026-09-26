import type { ReactNode } from "react";
import { emptyPlanarState, type PlanarState } from "../planar-kit/contract";
import { HeightMark, RightAngleMark } from "../planar-kit/geometry";
import { interpolatePlanarState } from "../planar-kit/presentation";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField, type PlanarSceneDefinition, type PlanarText, type PlanarToggle } from "../planar-kit/types";
import { polygonArea } from "../planar-interaction/geometry";
import { add, clamp, clockHands, degrees, distance, hingedFrame, latticeCounts, perpendicularFoot, pointInPolygon, polar, polygonAltitude, polygonPerimeter, polygonSegments, quadrilateral, rectanglePoints, rectangleUnion, rotatePoint, sameAreaRectangle, samePerimeterRectangle, sharedRectangleSeams, simplePolygon, staircasePolygon, straightenBoundary, tangramPiece, threeRodGeometry, triangleAngles, triangulatePolygon, type Point, type QuadrilateralFamily, type Rectangle } from "./model";

const colors = ["var(--leaf)", "var(--moon)", "var(--cheek)", "var(--crater)", "var(--star)", "var(--leaf-deep)", "var(--rose)"];
const t = (zh: string, en: string): PlanarText => ({ zh, en });
const field = (key: string, zh: string, en: string, min: number, max: number, step = 0.1): PlanarField => ({ key, label: t(zh, en), min, max, step });
const toggle = (key: string, zh: string, en: string): PlanarToggle => ({ key, label: t(zh, en) });
const n = (s: PlanarState, key: string, fallback: number, min = -10000, max = 10000) => clamp(Number.isFinite(s.params[key]) ? s.params[key] : fallback, min, max);
const pt = (s: PlanarState, key: string, fallback: Point): Point => s.points[key] ?? fallback;
const setPoint = (s: PlanarState, key: string, point: Point): PlanarState => ({ ...s, points: { ...s.points, [key]: point } });
const setNumber = (s: PlanarState, key: string, value: number): PlanarState => ({ ...s, params: { ...s.params, [key]: value } });
const boundedPoint = (point: Point): Point => ({ x: clamp(point.x, 80, 850), y: clamp(point.y, 100, 620) });
const fmt = (value: number) => Number(value.toFixed(2)).toString();
const pointsAttr = (points: readonly Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
const translate = (points: readonly Point[], offset: Point, scale = 1) => points.map((p) => ({ x: offset.x + p.x * scale, y: offset.y + p.y * scale }));
const line = (a: Point, b: Point, color = "var(--ink)", dashed = false, width = 2.5) => <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeDasharray={dashed ? "6 5" : undefined} vectorEffect="non-scaling-stroke" />;
const label = (at: Point, value: ReactNode, anchor: "middle" | "start" | "end" = "middle") => <text x={at.x} y={at.y} fill="var(--ink)" fontSize="18" textAnchor={anchor} paintOrder="stroke" stroke="var(--paper)" strokeWidth="5" strokeLinejoin="round" pointerEvents="none">{value}</text>;
function paper(points: readonly Point[], index = 0, opacity = 0.72) {
  return <polygon points={pointsAttr(points)} fill={colors[index % colors.length]} fillOpacity={opacity} stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
}
function dot(api: PlanarDrawingApi, key: string, at: Point, text?: string, color = "var(--rose)") {
  return <g {...api.bind(key, text ?? key)} style={{ cursor: "grab" }}>
    <circle cx={at.x} cy={at.y} r="18" fill="transparent" />
    <circle cx={at.x} cy={at.y} r="6" fill={color} stroke="var(--paper)" strokeWidth="2" />
    {text && label({ x: at.x, y: at.y - 15 }, text)}
  </g>;
}
function arc(center: Point, radius: number, start: number, angle: number) {
  const a = polar(center, radius, start), b = polar(center, radius, start + angle);
  return `M${a.x},${a.y}A${radius},${radius} 0 ${Math.abs(angle) > 180 ? 1 : 0} ${angle >= 0 ? 1 : 0} ${b.x},${b.y}`;
}
function wedge(center: Point, radius: number, start: number, angle: number) {
  const a = polar(center, radius, start);
  return `M${center.x},${center.y}L${a.x},${a.y}${arc(center, radius, start, angle).replace(/^M[^A]+/, "")}Z`;
}
function state(id: string, params: Record<string, number>, points: Record<string, Point> = {}, flags: Record<string, boolean> = {}): PlanarState {
  return { ...emptyPlanarState(id), params, points, flags: { measures: true, grid: false, ...flags } };
}
function scene(id: string, title: PlanarText, description: PlanarText, rest: Omit<PlanarSceneDefinition, "id" | "toolId" | "title" | "description">): PlanarSceneDefinition {
  return { id, toolId: "plane-geometry", title, description, ...rest };
}
const phaseAction = (id: string, zh: string, en: string, duration = 1400): PlanarAction => ({
  id, icon: "play", label: t(zh, en), run: (s) => ({ ...s, phase: s.phase > 0.99 ? 0 : 1 }), duration,
});
const measures = toggle("measures", "显示测量", "Show measurements");

function pieceCount(s: PlanarState) { return s.sceneId === "02" ? 7 : Math.round(n(s, "count", 4, 1, 20)); }
function pieceShape(s: PlanarState, index: number): Point[] {
  const offset = pt(s, `piece${index}`, { x: 160 + index % 4 * 160, y: 260 + Math.floor(index / 4) * 150 });
  const angle = n(s, `angle${index}`, 0), reflection = n(s, `reflection${index}`, 1, -1, 1);
  if (s.sceneId === "02") return tangramPiece(index, offset, 85, angle, reflection);
  const kind = Math.round(n(s, `kind${index}`, index % 4, 0, 3));
  const polygons: Point[][] = [
    [{ x: -55, y: 50 }, { x: 55, y: 50 }, { x: 0, y: -55 }],
    [{ x: -55, y: -55 }, { x: 55, y: -55 }, { x: 55, y: 55 }, { x: -55, y: 55 }],
    [{ x: -70, y: 45 }, { x: 35, y: 45 }, { x: 70, y: -45 }, { x: -35, y: -45 }],
    Array.from({ length: 64 }, (_, i) => polar({ x: 0, y: 0 }, 55, i * 360 / 64)),
  ];
  return polygons[kind].map((p) => add(rotatePoint({ x: p.x * reflection, y: p.y }, { x: 0, y: 0 }, angle), offset));
}
function activePiece(s: PlanarState) { return Math.round(n(s, "active", 0, 0, pieceCount(s) - 1)); }
function activatePiece(s: PlanarState, target: string) {
  const match = /^piece(\d+)$/.exec(target);
  return match ? { ...s, params: { ...s.params, active: Number(match[1]), rotation: n(s, `angle${match[1]}`, 0) } } : s;
}
function turnPiece(s: PlanarState, delta: number) {
  const angle = n(s, `angle${activePiece(s)}`, 0) + delta;
  return { ...s, params: { ...s.params, [`angle${activePiece(s)}`]: angle, rotation: angle } };
}
const pieceActions: PlanarAction[] = [
  { id: "piece-left", icon: "positiveTurn", label: t("选中纸片逆时针 45°", "Turn selected piece 45° counterclockwise"), run: (s) => turnPiece(s, -45), duration: 420 },
  { id: "piece-right", icon: "negativeTurn", label: t("选中纸片顺时针 45°", "Turn selected piece 45° clockwise"), run: (s) => turnPiece(s, 45), duration: 420 },
  { id: "piece-mirror", icon: "mirror", label: t("选中纸片翻面", "Flip selected piece"), run: (s) => setNumber(s, `reflection${activePiece(s)}`, n(s, `reflection${activePiece(s)}`, 1) > 0 ? -1 : 1), duration: 650 },
];
function materialScene(tangram: boolean) {
  return scene(tangram ? "02" : "01", tangram ? t("七巧板与开放拼摆", "Tangram and open construction") : t("图形纸片", "Shape pieces"),
    t("直接拖纸片移动；点选后用准确转角或翻面，纸片身份与大小保持。", "Drag pieces freely. Select a piece to rotate precisely or flip it; its identity and size stay unchanged."), {
      create: () => {
        const count = tangram ? 7 : 4;
        return state(tangram ? "02" : "01", { active: 0, rotation: 0, count, ...Object.fromEntries(Array.from({ length: count }, (_, i) => [[`reflection${i}`, 1], [`angle${i}`, 0]]).flat()) },
          Object.fromEntries(Array.from({ length: count }, (_, i) => [`piece${i}`, tangram ? { x: 290, y: 180 } : { x: 160 + i % 4 * 160, y: 260 + Math.floor(i / 4) * 150 }])), { outline: tangram });
      },
      fields: [field("rotation", "选中纸片转角（°）", "Selected piece angle (°)", -360, 360, 1)],
      setField: (s, key, value) => key === "rotation" ? { ...s, params: { ...s.params, [`angle${activePiece(s)}`]: value, rotation: value } } : setNumber(s, key, value),
      toggles: [...(tangram ? [toggle("outline", "保留原正方形轮廓", "Original square outline")] : []), toggle("names", "显示纸片编号", "Show piece numbers")],
      actions: tangram ? [
        ...pieceActions,
        { id: "tangram-separate", icon: "separate", label: t("散开七片", "Spread the seven pieces"), duration: 1000, run: (s) => ({ ...s, points: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`piece${i}`, { x: 240 + (i % 3 - 1) * 145, y: 130 + Math.floor(i / 3) * 90 }])) }) },
      ] : [...pieceActions,
        { id: "piece-duplicate", icon: "duplicate", label: t("复制选中纸片", "Duplicate selected piece"), disabled: (s) => pieceCount(s) >= 20, run: (s) => {
          const count = pieceCount(s), active = activePiece(s);
          return { ...s, params: { ...s.params, count: count + 1, active: count, [`kind${count}`]: n(s, `kind${active}`, active % 4), [`angle${count}`]: n(s, `angle${active}`, 0), [`reflection${count}`]: n(s, `reflection${active}`, 1) }, points: { ...s.points, [`piece${count}`]: add(pt(s, `piece${active}`, { x: 160 + active % 4 * 160, y: 260 + Math.floor(active / 4) * 150 }), { x: 40, y: 40 }) } };
        } },
        { id: "piece-remove", icon: "remove", label: t("移去选中纸片", "Remove selected piece"), disabled: (s) => pieceCount(s) <= 1, run: (s) => {
          const active = activePiece(s), count = pieceCount(s), next = structuredClone(s);
          for (let i = active; i + 1 < count; i++) { next.params[`kind${i}`] = n(s, `kind${i + 1}`, (i + 1) % 4); next.params[`angle${i}`] = n(s, `angle${i + 1}`, 0); next.params[`reflection${i}`] = n(s, `reflection${i + 1}`, 1); next.points[`piece${i}`] = pt(s, `piece${i + 1}`, { x: 160 + (i + 1) % 4 * 160, y: 260 + Math.floor((i + 1) / 4) * 150 }); }
          next.params.count = count - 1; next.params.active = Math.min(active, count - 2); next.params.rotation = n(next, `angle${next.params.active}`, 0); return next;
        } },
      ],
      draw: (s, api) => <>
        {tangram && s.flags.outline && <rect x="290" y="180" width="340" height="340" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="6 5" />}
        {Array.from({ length: pieceCount(s) }, (_, i) => {
          const points = pieceShape(s, i), center = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
          return <g key={i} {...api.bind(`piece${i}`, `${api.locale === "en" ? "Piece" : "纸片"} ${i + 1}`)} style={{ cursor: "grab" }}>
            {!tangram && Math.round(n(s, `kind${i}`, i % 4, 0, 3)) === 3 ? <ellipse cx={center.x} cy={center.y} rx={55 * Math.abs(n(s, `reflection${i}`, 1, -1, 1))} ry="55" transform={`rotate(${n(s, `angle${i}`, 0)} ${center.x} ${center.y})`} fill={colors[i % colors.length]} fillOpacity="0.72" stroke="var(--ink)" strokeWidth="2.5" /> : paper(points, i)}
            {api.selected === `piece${i}` && <polygon points={pointsAttr(points)} fill="none" stroke="var(--rose)" strokeWidth="2" strokeDasharray="5 4" />}
            {s.flags.names && label(center, i + 1)}
          </g>;
        })}
      </>,
      tap: activatePiece,
      drag: (s, target, _point, delta) => {
        if (!/^piece\d+$/.test(target)) return s;
        const index = Number(target.replace("piece", ""));
        return setPoint(activatePiece(s, target), target, add(pt(s, target, tangram ? { x: 290, y: 180 } : { x: 160 + index % 4 * 160, y: 260 + Math.floor(index / 4) * 150 }), delta));
      },
      summary: (s, locale) => `${pieceCount(s)} ${locale === "en" ? "pieces · selected" : "片 · 当前"} ${activePiece(s) + 1}`,
    });
}

const linesScene = scene("03", t("线段、射线与直线", "Segments, rays and lines"), t("拖端点改变方向，拖折点比较两点间的不同路径。", "Move endpoints to change direction; drag the intermediate point to compare routes."), {
  create: () => state("03", {}, { a: { x: 240, y: 400 }, b: { x: 690, y: 320 }, via: { x: 480, y: 190 } }, { ray: false, fullLine: false, detour: true }),
  toggles: [toggle("ray", "从 A 向 B 延伸为射线", "Extend A through B as a ray"), toggle("fullLine", "两端延伸为直线", "Extend both ways as a line"), toggle("detour", "比较折线路程", "Compare a bent route"), measures],
  setFlag: (s, key, value) => ({ ...s, flags: { ...s.flags, [key]: value, ...(key === "ray" && value ? { fullLine: false } : {}), ...(key === "fullLine" && value ? { ray: false } : {}) } }),
  draw: (s, api) => {
    const a = pt(s, "a", { x: 240, y: 400 }), b = pt(s, "b", { x: 690, y: 320 }), via = pt(s, "via", { x: 480, y: 190 });
    const length = distance(a, b), u = { x: (b.x - a.x) / Math.max(1, length), y: (b.y - a.y) / Math.max(1, length) };
    const first = s.flags.fullLine ? { x: a.x - u.x * 650, y: a.y - u.y * 650 } : a;
    const last = s.flags.fullLine || s.flags.ray ? { x: b.x + u.x * 650, y: b.y + u.y * 650 } : b;
    return <><g>{line(first, last)}{s.flags.detour && <>{line(a, via, "var(--crater)", true)}{line(via, b, "var(--crater)", true)}{dot(api, "via", via, "P")}</>}
      {dot(api, "a", a, "A")}{dot(api, "b", b, "B")}</g>
      {s.flags.measures && <>{label({ x: 470, y: 530 }, `AB = ${fmt(length / 50)} u`)}{s.flags.detour && label({ x: 470, y: 562 }, `AP + PB = ${fmt((distance(a, via) + distance(via, b)) / 50)} u`)}</>}
      {label({ x: 470, y: 125 }, s.flags.fullLine ? textFor(t("直线 · 两端无限延伸", "Line · extends in both directions"), api.locale) : s.flags.ray ? textFor(t("射线 · 只有 A 是端点", "Ray · only A is an endpoint"), api.locale) : textFor(t("线段 · A、B 是端点", "Segment · A and B are endpoints"), api.locale))}
    </>;
  },
  drag: (s, target, point) => ["a", "b", "via"].includes(target) && (target === "via" || distance(boundedPoint(point), pt(s, target === "a" ? "b" : "a", { x: 0, y: 0 })) > 30) ? setPoint(s, target, boundedPoint(point)) : s,
});

const angleScene = scene("04", t("角的张合与量角器", "Angles and a movable protractor"), t("抓住边上的端点张合；量角器可移动、转动对准。角的大小不随边长改变。", "Drag a ray to open the angle. Move and align the protractor; ray length does not change the angle."), {
  create: () => state("04", { angle: 65, lengthA: 4.5, lengthB: 4, protractorRotation: 0 }, { vertex: { x: 340, y: 440 }, protractor: { x: 340, y: 440 } }, { protractor: true }),
  fields: [field("angle", "张角（°）", "Angle (°)", 0, 180, 1), field("lengthA", "第一条边（u）", "First ray length (u)", 1, 6), field("lengthB", "第二条边（u）", "Second ray length (u)", 1, 6), field("protractorRotation", "量角器方向（°）", "Protractor orientation (°)", -180, 180, 1)],
  toggles: [toggle("protractor", "显示量角器", "Show protractor"), measures],
  actions: [{ id: "angle-open", icon: "play", label: t("连续张合", "Open or close continuously"), run: (s) => setNumber(s, "angle", n(s, "angle", 65) > 100 ? 30 : 150), duration: 2000 }],
  draw: (s, api) => {
    const center = pt(s, "vertex", { x: 340, y: 440 }), angle = n(s, "angle", 65, 0, 180), first = polar(center, n(s, "lengthA", 4.5, 1, 6) * 50, 0), second = polar(center, n(s, "lengthB", 4, 1, 6) * 50, -angle);
    const protractor = pt(s, "protractor", center), direction = n(s, "protractorRotation", 0);
    return <>
      {s.flags.protractor && <g transform={`translate(${protractor.x} ${protractor.y}) rotate(${direction})`} {...api.bind("protractor", textFor(t("移动量角器", "Move protractor"), api.locale))} style={{ cursor: "grab" }}>
        <path d="M-200,0 A200,200 0 0 1 200,0 Z" fill="var(--moon)" fillOpacity="0.24" stroke="var(--crater)" strokeWidth="1.5" />
        {Array.from({ length: 37 }, (_, i) => {
          const a = polar({ x: 0, y: 0 }, 200, -i * 5), b = polar({ x: 0, y: 0 }, i % 2 ? 193 : 186, -i * 5);
          return <g key={i}>{line(a, b, "var(--muted)", false, 1)}{i % 6 === 0 && label(polar({ x: 0, y: 0 }, 170, -i * 5), i * 5)}</g>;
        })}
        <circle r="4" fill="var(--crater)" />
      </g>}
      <path d={wedge(center, 68, 0, -angle)} fill="var(--leaf)" fillOpacity="0.3" stroke="var(--leaf-deep)" />
      {line(center, first)}{line(center, second)}{dot(api, "vertex", center, "O")}{dot(api, "rayA", first, "A")}{dot(api, "rayB", second, "B")}
      <RightAngleMark vertex={center} along={first} toward={second} />
      {s.flags.measures && label(polar(center, 100, -angle / 2), `${fmt(angle)}°`)}
    </>;
  },
  drag: (s, target, point, delta) => {
    const center = pt(s, "vertex", { x: 340, y: 440 });
    if (target === "protractor") return setPoint(s, target, add(pt(s, target, center), delta));
    if (target === "vertex") return setPoint(s, target, boundedPoint(point));
    if (target === "rayA") return setNumber(s, "lengthA", clamp(distance(center, point) / 50, 1, 6));
    if (target === "rayB") return setNumber(s, "angle", clamp(-degrees(Math.atan2(point.y - center.y, point.x - center.x)), 0, 180));
    return s;
  },
});

const parallelScene = scene("05", t("平行、垂直与点到线的距离", "Parallel lines and perpendicular distance"), t("拖 P 改变线外点，拖 Q 比较斜线与垂线；垂足和直角标记始终跟随。", "Move P off the line and Q along it. Compare the sloping segment with the perpendicular and its right-angle mark."), {
  create: () => state("05", { along: 0.7 }, { a: { x: 220, y: 480 }, b: { x: 710, y: 400 }, p: { x: 410, y: 210 } }, { parallel: true }),
  fields: [field("along", "Q 在线上的位置", "Position of Q on the line", -0.2, 1.2, 0.01)],
  toggles: [toggle("parallel", "经过 P 的平行线", "Parallel line through P"), measures],
  draw: (s, api) => {
    const a = pt(s, "a", { x: 220, y: 480 }), b = pt(s, "b", { x: 710, y: 400 }), p = pt(s, "p", { x: 410, y: 210 }), fraction = n(s, "along", 0.7, -0.2, 1.2);
    const q = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction }, foot = perpendicularFoot(p, a, b);
    if (!foot) return null;
    return <>{line(a, b)}{line(p, q, "var(--crater)")}
      {s.flags.parallel && line({ x: p.x - (b.x - a.x) / 2, y: p.y - (b.y - a.y) / 2 }, { x: p.x + (b.x - a.x) / 2, y: p.y + (b.y - a.y) / 2 }, "var(--leaf-deep)")}
      <HeightMark vertex={p} baseA={a} baseB={b} label={s.flags.measures ? `h = ${fmt(foot.distance / 50)} u` : undefined} />
      {dot(api, "a", a, "A")}{dot(api, "b", b, "B")}{dot(api, "p", p, "P")}{dot(api, "q", q, "Q", "var(--crater)")}
      {s.flags.measures && label({ x: 490, y: 570 }, `PQ = ${fmt(distance(p, q) / 50)} u`)}
    </>;
  },
  drag: (s, target, point) => {
    if (target === "q") { const projected = perpendicularFoot(point, pt(s, "a", { x: 220, y: 480 }), pt(s, "b", { x: 710, y: 400 })); return projected ? setNumber(s, "along", clamp(projected.parameter, -0.2, 1.2)) : s; }
    if (["a", "b"].includes(target) && distance(boundedPoint(point), pt(s, target === "a" ? "b" : "a", { x: 0, y: 0 })) < 80) return s;
    return ["a", "b", "p"].includes(target) ? setPoint(s, target, boundedPoint(point)) : s;
  },
});

const rodsScene = scene("06", t("三根小棒与活动框架", "Rods and hinged frames"), t("准确改变杆长，观察三杆间隙；切到四杆后直接推斜，杆长保持。", "Adjust rod lengths and observe the gap. Switch to a four-rod frame and shear it without changing rod lengths."), {
  create: () => state("06", { base: 5, left: 3, right: 4, opening: 70 }, { origin: { x: 270, y: 485 } }, { frame: false, locked: true }),
  fields: [field("base", "底杆长（u）", "Base rod (u)", 1, 7), field("left", "左杆长（u）", "Left rod (u)", 1, 6), field("right", "右杆长（u）", "Right rod (u)", 1, 6), field("opening", "四杆框架开角（°）", "Four-rod opening (°)", 15, 165, 1)],
  toggles: [toggle("frame", "四杆活动框架", "Four-rod hinged frame"), toggle("locked", "直接拖动保持杆长", "Keep rod lengths while dragging"), measures],
  actions: [{ id: "frame-shear", icon: "play", label: t("推斜四杆框架", "Shear the four-rod frame"), run: (s) => ({ ...s, flags: { ...s.flags, frame: true }, params: { ...s.params, opening: n(s, "opening", 70) > 90 ? 45 : 125 } }), duration: 1200,
    interpolate: (from, to, progress) => ({ ...interpolatePlanarState(from, to, progress), flags: to.flags }),
  }],
  draw: (s, api) => {
    const base = n(s, "base", 5, 1, 7), left = n(s, "left", 3, 1, 6), right = n(s, "right", 4, 1, 6), origin = pt(s, "origin", { x: 270, y: 485 }), scale = 50;
    if (s.flags.frame) {
      const vertices = translate(hingedFrame(base, left, n(s, "opening", 70, 15, 165)), origin, scale);
      return <><g {...api.bind("body", textFor(t("移动框架", "Move the frame"), api.locale))} style={{ cursor: "grab" }}>{paper(vertices, 0, 0.18)}{polygonSegments(vertices).map(({ a, b }, i) => <g key={i}>{line(a, b, colors[i % 2], false, 9)}{s.flags.measures && label({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12 }, `${fmt(distance(a, b) / scale)} u`)}</g>)}</g>{dot(api, "joint", vertices[3], "P")}</>;
    }
    const rods = threeRodGeometry(base, left, right)!;
    const a = origin, b = { x: origin.x + base * scale, y: origin.y }, c = translate([rods.leftJoint], origin, scale)[0], d = translate([rods.rightJoint], origin, scale)[0];
    return <><g {...api.bind("body", textFor(t("移动三杆", "Move the three rods"), api.locale))} style={{ cursor: "grab" }}>{line(a, b, colors[0], false, 8)}{line(a, c, colors[1], false, 8)}{line(b, d, colors[2], false, 8)}</g>
      {rods.gap > 0 && line(c, d, "var(--rose)", true)}{!s.flags.locked && <>{dot(api, "base", b, "B")}{dot(api, "left", c, "C")}{!rods.closed && dot(api, "right", d, "D")}</>}
      {s.flags.measures && label({ x: 475, y: 560 }, `${fmt(base)} + ${fmt(left)} + ${fmt(right)} u${rods.gap > 0 ? ` · ${textFor(t("间隙", "gap"), api.locale)} ${fmt(rods.gap)} u` : ""}`)}
    </>;
  },
  drag: (s, target, point, delta) => {
    const origin = pt(s, "origin", { x: 270, y: 485 });
    if (target === "body") return setPoint(s, "origin", add(origin, delta));
    if (target === "joint") return setNumber(s, "opening", clamp(-degrees(Math.atan2(point.y - origin.y, point.x - origin.x)), 15, 165));
    if (s.flags.locked) return s;
    if (target === "base") return setNumber(s, "base", clamp((point.x - origin.x) / 50, 1, 7));
    if (target === "left") return setNumber(s, "left", clamp(distance(origin, point) / 50, 1, 6));
    if (target === "right") return setNumber(s, "right", clamp(distance({ x: origin.x + n(s, "base", 5) * 50, y: origin.y }, point) / 50, 1, 6));
    return s;
  },
});

function triangleVertices(s: PlanarState) { return [pt(s, "a", { x: 240, y: 360 }), pt(s, "b", { x: 680, y: 360 }), pt(s, "c", { x: 410, y: 160 })]; }
const triangleAnglesScene = scene("07", t("三角形的三个角拼成平角", "Assemble the three triangle angles"), t("拖顶点改变三角形；逐片搬角时保留角的大小、颜色与来处。", "Change the triangle by dragging vertices. Each angle retains its size, color and source as it moves."), {
  create: () => state("07", {}, { a: { x: 240, y: 360 }, b: { x: 680, y: 360 }, c: { x: 410, y: 160 } }),
  progress: true, toggles: [measures], actions: [phaseAction("join-angles", "依次拼角／放回", "Assemble or return the angles", 2300)],
  draw: (s, api) => {
    const vertices = triangleVertices(s), angles = triangleAngles(vertices); let accumulated = 0;
    return <>{paper(vertices, 0, 0.13)}{line({ x: 300, y: 565 }, { x: 660, y: 565 }, "var(--muted)", true)}
      {vertices.map((vertex, i) => {
        const next = vertices[(i + 1) % 3], previous = vertices[(i + 2) % 3], initialStart = degrees(Math.atan2(next.y - vertex.y, next.x - vertex.x));
        const cross = (next.x - vertex.x) * (previous.y - vertex.y) - (next.y - vertex.y) * (previous.x - vertex.x), sign = cross < 0 ? -1 : 1;
        const targetStart = sign < 0 ? 360 - accumulated : 180 + accumulated;
        const progress = clamp(s.phase * 3 - i, 0, 1), center = { x: vertex.x + (480 - vertex.x) * progress, y: vertex.y + (565 - vertex.y) * progress };
        const delta = ((targetStart - initialStart + 540) % 360) - 180, start = initialStart + delta * progress;
        accumulated += angles[i];
        return <g key={i}><path d={wedge(center, 62, start, sign * angles[i])} fill={colors[i]} fillOpacity="0.78" stroke="var(--ink)" strokeWidth="1.5" />
          {s.flags.measures && label(polar(center, 86, start + sign * angles[i] / 2), `${fmt(angles[i])}°`)}
          {s.phase === 0 && dot(api, ["a", "b", "c"][i], vertex, ["A", "B", "C"][i])}
        </g>;
      })}{s.flags.measures && s.phase > 0.99 && label({ x: 480, y: 615 }, `${angles.map(fmt).join("° + ")}° = 180°`)}</>;
  },
  drag: (s, target, point) => {
    if (!["a", "b", "c"].includes(target) || s.phase > 0) return s;
    const next = setPoint(s, target, { x: clamp(point.x, 150, 760), y: clamp(point.y, 100, 410) });
    return polygonArea(triangleVertices(next)) >= 1800 ? next : s;
  },
});

const families: QuadrilateralFamily[] = ["rectangle", "square", "parallelogram", "rhombus", "trapezoid"];
function quadVertices(s: PlanarState) { return translate(quadrilateral(families[Math.round(n(s, "family", 2, 0, 4))], n(s, "width", 5, 2, 7), n(s, "height", 3, 1, 5), n(s, "slant", 1.4, -3, 3)), pt(s, "origin", { x: 310, y: 500 }), 48); }
const quadrilateralScene = scene("08", t("四边形家族与底、高", "Quadrilateral families, bases and heights"), t("选择四边形材料，拖顶点时保留所选关系；点边换底。高随底边改变，外高也显示完整。", "Choose a quadrilateral material, then drag vertices while retaining its constraints. Tap an edge to change the base and its altitude, including exterior altitudes."), {
  create: () => state("08", { family: 2, width: 5, height: 3, slant: 1.4, base: 0 }, {}, { height: true }),
  fields: [
    { ...field("family", "图形材料", "Shape material", 0, 4, 1), options: [t("长方形", "Rectangle"), t("正方形", "Square"), t("平行四边形", "Parallelogram"), t("菱形", "Rhombus"), t("梯形", "Trapezoid")].map((label, value) => ({ value, label })) },
    field("width", "底边长（u）", "Base length (u)", 2, 7), field("height", "高度（正方形、菱形由边长约束）", "Height (square/rhombus constrained by sides)", 1, 5), field("slant", "倾斜量（u）", "Horizontal offset (u)", -3, 3),
    { ...field("base", "选择底边", "Base edge", 0, 3, 1), options: ["AB", "BC", "CD", "DA"].map((name, value) => ({ value, label: t(name, name) })) },
  ],
  toggles: [toggle("height", "显示对应高", "Show the corresponding height"), measures],
  draw: (s, api) => {
    const vertices = quadVertices(s), base = Math.round(n(s, "base", 0, 0, 3)), altitude = polygonAltitude(vertices, base);
    return <>{paper(vertices)}{polygonSegments(vertices).map(({ a, b }, i) => <g key={i} {...api.bind(`base${i}`, textFor(t(`选择底边 ${i + 1}`, `Choose base ${i + 1}`), api.locale))} style={{ cursor: "pointer" }}>
      {line(a, b, i === base ? "var(--rose)" : "transparent", false, i === base ? 4 : 18)}
    </g>)}{vertices.map((point, i) => <g key={i}>{dot(api, `vertex${i}`, point, ["A", "B", "C", "D"][i])}</g>)}
      {s.flags.height && altitude?.altitude && <HeightMark vertex={altitude.vertex} baseA={vertices[base]} baseB={vertices[(base + 1) % 4]} label={s.flags.measures ? `h = ${fmt(altitude.altitude.distance / 48)} u` : undefined} />}
      {s.flags.measures && label({ x: 480, y: 595 }, `S = ${fmt(polygonArea(vertices) / 48 ** 2)} u²`)}</>;
  },
  tap: (s, target) => /^base[0-3]$/.test(target) ? setNumber(s, "base", Number(target.slice(-1))) : s,
  drag: (s, target, point, delta) => {
    const origin = pt(s, "origin", { x: 310, y: 500 });
    if (target === "vertex0") return setPoint(s, "origin", add(origin, delta));
    if (target === "vertex1") return setNumber(s, "width", clamp((point.x - origin.x) / 48, 2, 7));
    if (target === "vertex2" || target === "vertex3") {
      const family = families[Math.round(n(s, "family", 2, 0, 4))];
      const next = setNumber(s, "height", clamp((origin.y - point.y) / 48, 1, 5));
      if (family === "square") return setNumber(next, "width", clamp((target === "vertex2" ? point.x - origin.x : origin.y - point.y) / 48, 2, 7));
      if (family === "rectangle") return target === "vertex2" ? setNumber(next, "width", clamp((point.x - origin.x) / 48, 2, 7)) : next;
      return setNumber(next, "slant", clamp((point.x - origin.x) / 48 - (target === "vertex2" ? n(s, "width", 5) * (family === "trapezoid" ? 0.55 : 1) : 0), -3, 3));
    }
    return s;
  },
});

function perimeterShape(s: PlanarState) { return rectanglePoints({ x: 310, y: 220, width: n(s, "width", 4, 2, 5) * 45, height: n(s, "height", 3, 1, 3.5) * 45 }); }
const perimeterScene = scene("10", t("绕一周，把边排成一条线", "Move the boundary into a straight line"), t("每段保留长度与颜色；可停在搬边中途，观察周长仍由原来的边组成。", "Every edge retains its length and color. Pause midway and observe the same edges forming the perimeter."), {
  create: () => state("10", { width: 4, height: 3 }), progress: true,
  fields: [field("width", "长（u）", "Width (u)", 2, 5), field("height", "宽（u）", "Height (u)", 1, 3.5)],
  toggles: [measures], actions: [phaseAction("straighten-boundary", "搬边排直／围回去", "Straighten or restore the boundary", 2100)],
  draw: (s, api) => {
    const vertices = perimeterShape(s), segments = straightenBoundary(vertices, { x: 95, y: 560 }, s.phase);
    return <>{paper(vertices, 0, 0.12)}{segments.map(({ a, b }, i) => <g key={i}>{line(a, b, colors[i], false, 7)}{s.flags.measures && label({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 15 }, `${fmt(distance(a, b) / 45)} u`)}</g>)}
      {s.phase === 0 && dot(api, "size", vertices[2], textFor(t("改尺寸", "Resize"), api.locale))}
      {s.flags.measures && label({ x: 480, y: 625 }, `P = ${fmt(polygonPerimeter(vertices) / 45)} u`)}</>;
  },
  drag: (s, target, point) => target === "size" && s.phase === 0 ? { ...s, params: { ...s.params, width: clamp((point.x - 310) / 45, 2, 5), height: clamp((point.y - 220) / 45, 1, 3.5) } } : s,
});

function areaGrid(s: PlanarState) {
  const subdivision = !!s.flags.subdivision, columns = subdivision ? 10 : Math.round(n(s, "columns", 4, 1, 7)), rows = subdivision ? 10 : Math.round(n(s, "rows", 3, 1, 5));
  return { subdivision, columns, rows, unit: subdivision ? 34 : 65, origin: { x: 220, y: 180 }, capacity: columns * rows };
}
const unitAreaScene = scene("11", t("铺单位面与面积单位", "Tile with unit squares"), t("点格子逐块铺，或连续铺满。把 1 dm² 划成 100 个 cm²，边长与面积单位同时对应。", "Tap individual squares or fill continuously. Split 1 dm² into 100 cm² while retaining the side-to-area relationship."), {
  create: () => state("11", { columns: 4, rows: 3, filled: 0 }, {}, { subdivision: false }),
  fields: [field("columns", "每行单位数", "Units per row", 1, 7, 1), field("rows", "行数", "Rows", 1, 5, 1)],
  setField: (s, key, value) => {
    const next = setNumber(s, key, Math.round(clamp(value, 1, key === "columns" ? 7 : 5))), capacity = areaGrid(next).capacity;
    return { ...next, params: { ...next.params, filled: Math.min(n(next, "filled", 0), capacity) }, marks: next.marks.filter((mark) => /^cell\d+$/.test(mark) && Number(mark.slice(4)) < capacity) };
  },
  toggles: [toggle("subdivision", "1 dm² 细分为 100 cm²", "Subdivide 1 dm² into 100 cm²"), measures],
  setFlag: (s, key, value) => key === "subdivision" ? { ...s, marks: [], params: { ...s.params, filled: 0 }, flags: { ...s.flags, [key]: value } } : { ...s, flags: { ...s.flags, [key]: value } },
  actions: [
    { id: "unit-square-add", icon: "add", label: t("铺一个单位面", "Add one unit square"), run: (s) => setNumber(s, "filled", Math.min(areaGrid(s).capacity, n(s, "filled", 0) + 1)) },
    { id: "unit-square-fill", icon: "play", label: t("依次铺满", "Fill in sequence"), run: (s) => ({ ...setNumber(s, "filled", areaGrid(s).capacity), marks: [] }), duration: 3000,
      interpolate: (from, to, progress) => {
        if (progress >= 1) return to;
        const capacity = areaGrid(from).capacity, filled = Math.round(n(from, "filled", 0, 0, capacity));
        const cells = Array.from({ length: capacity }, (_, i) => `cell${i}`), covered = cells.filter((cell, i) => i < filled !== from.marks.includes(cell)), empty = cells.filter((cell) => !covered.includes(cell));
        return { ...from, params: { ...from.params, filled: 0 }, marks: [...covered, ...empty.slice(0, Math.floor(empty.length * progress))] };
      },
    },
    { id: "unit-square-clear", icon: "clear", label: t("收起单位面", "Clear the unit squares"), run: (s) => ({ ...setNumber(s, "filled", 0), marks: [] }) },
  ],
  draw: (s, api) => {
    const { columns, rows, unit, origin, capacity, subdivision } = areaGrid(s), filled = Math.round(n(s, "filled", 0, 0, capacity));
    const covered = Array.from({ length: capacity }, (_, i) => i < filled !== s.marks.includes(`cell${i}`)).filter(Boolean).length;
    return <>{Array.from({ length: capacity }, (_, i) => <rect key={i} {...api.bind(`cell${i}`, `${api.locale === "en" ? "Unit" : "单位格"} ${i + 1}`)} x={origin.x + i % columns * unit} y={origin.y + Math.floor(i / columns) * unit} width={unit} height={unit} fill={i < filled !== s.marks.includes(`cell${i}`) ? colors[i % columns % 3] : "var(--paper)"} fillOpacity="0.7" stroke="var(--crater)" strokeWidth="1.2" style={{ cursor: "pointer" }} />)}
      {line({ x: origin.x, y: origin.y + rows * unit + 20 }, { x: origin.x + columns * unit, y: origin.y + rows * unit + 20 }, "var(--muted)")}
      {s.flags.measures && <>{label({ x: origin.x + columns * unit / 2, y: origin.y + rows * unit + 46 }, subdivision ? "1 dm = 10 cm" : `${columns} u`)}{label({ x: 480, y: 610 }, `${covered} / ${capacity} · ${covered} ${subdivision ? "cm²" : "u²"}${subdivision && covered === 100 ? " = 1 dm²" : ""}`)}</>}
    </>;
  },
  tap: (s, target) => /^cell\d+$/.test(target) ? { ...s, marks: s.marks.includes(target) ? s.marks.filter((mark) => mark !== target) : [...s.marks, target] } : s,
});

function ropeRectangle(s: PlanarState) { const width = n(s, "width", 6, 2, 7); return s.flags.lockArea ? sameAreaRectangle(16, width) : samePerimeterRectangle(16, width); }
const samePerimeterScene = scene("12", t("同样的围绳，不同的面积", "Equal perimeter, different area"), t("直接拉动右图改变长宽；切换锁面积后，观察哪一个量保持不变。", "Resize the right rectangle; switch between fixed perimeter and fixed area and observe which measure remains unchanged."), {
  create: () => state("12", { width: 6 }, {}, { lockArea: false }), fields: [field("width", "右图宽（u）", "Right rectangle width (u)", 2, 7)],
  toggles: [toggle("lockArea", "改为锁面积 16 u²", "Keep area fixed at 16 u²"), measures],
  draw: (s, api) => {
    const reference = { x: 0, y: 0, width: 4, height: 4 }, current = ropeRectangle(s), scale = 39;
    return <>{[reference, current].map((r, i) => {
      const vertices = translate(rectanglePoints(r), { x: i === 0 ? 185 : 510, y: 230 }, scale);
      return <g key={i}>{paper(vertices, i)}{i === 1 && dot(api, "resize", vertices[2], textFor(t("拉动", "Drag"), api.locale))}
        {s.flags.measures && <>{label({ x: vertices[0].x + r.width * scale / 2, y: 205 }, `${fmt(r.width)} × ${fmt(r.height)}`)}{label({ x: i === 0 ? 265 : 635, y: 590 }, `P = ${fmt(2 * (r.width + r.height))} u · S = ${fmt(r.width * r.height)} u²`)}</>}
      </g>;
    })}</>;
  },
  drag: (s, target, point) => target === "resize" ? setNumber(s, "width", clamp((point.x - 510) / 39, 2, 7)) : s,
});

function joiningRectangles(s: PlanarState): Rectangle[] { return ["a", "b"].map((key, i) => ({ ...pt(s, key, { x: i === 0 ? 220 : 540, y: i === 0 ? 310 : 350 }), width: 180, height: 120 })); }
const sharedBoundaryScene = scene("13", t("拼接后的外边界与接缝", "Outer boundaries and shared seams"), t("直接移动两个图形，允许部分贴边和重叠；外周长按实际并集计算。", "Drag either piece; partial joins and overlap are supported. The outer perimeter follows the actual union."), {
  create: () => state("13", {}, { a: { x: 220, y: 310 }, b: { x: 540, y: 350 } }, { seams: true, snapping: true }),
  toggles: [toggle("seams", "显示内部接缝", "Show internal seams"), toggle("snapping", "贴边吸附", "Snap matching edges"), measures],
  actions: [{ id: "join-rectangles", icon: "play", label: t("演示贴合", "Demonstrate a join"), run: (s) => setPoint(s, "b", add(pt(s, "a", { x: 220, y: 310 }), { x: 180, y: 0 })), duration: 1200 }],
  draw: (s, api) => {
    const rectangles = joiningRectangles(s), union = rectangleUnion(rectangles), seams = sharedRectangleSeams(rectangles[0], rectangles[1]);
    return <>{rectangles.map((r, i) => <g key={i} {...api.bind(i === 0 ? "a" : "b", i === 0 ? "A" : "B")} style={{ cursor: "grab" }}>{paper(rectanglePoints(r), i, 0.5)}{label({ x: r.x + 90, y: r.y + 70 }, i === 0 ? "A" : "B")}</g>)}
      <g pointerEvents="none">{union.boundary.map(({ a, b }, i) => <g key={i}>{line(a, b, "var(--leaf-deep)", false, 4)}</g>)}
        {s.flags.seams && seams.map(({ a, b }, i) => <g key={i}>{line(a, b, "var(--rose)", true, 3)}</g>)}</g>
      {s.flags.measures && label({ x: 480, y: 590 }, `P = ${fmt(union.perimeter / 60)} u · S = ${fmt(union.area / 3600)} u²`)}</>;
  },
  drag: (s, target, _point, delta) => ["a", "b"].includes(target) ? setPoint(s, target, add(pt(s, target, { x: target === "a" ? 220 : 540, y: target === "a" ? 310 : 350 }), delta)) : s,
  snap: (s, target) => {
    if (!s.flags.snapping || !["a", "b"].includes(target)) return null;
    const rectangles = joiningRectangles(s), own = rectangles[target === "a" ? 0 : 1], other = rectangles[target === "a" ? 1 : 0];
    const next = { x: own.x, y: own.y };
    if (own.y < other.y + other.height && own.y + own.height > other.y) {
      if (Math.abs(own.x - other.x - other.width) < 18) next.x = other.x + other.width;
      if (Math.abs(own.x + own.width - other.x) < 18) next.x = other.x - own.width;
    }
    if (own.x < other.x + other.width && own.x + own.width > other.x) {
      if (Math.abs(own.y - other.y - other.height) < 18) next.y = other.y + other.height;
      if (Math.abs(own.y + own.height - other.y) < 18) next.y = other.y - own.height;
    }
    if (Math.abs(next.x - own.x) < 1e-8 && Math.abs(next.y - own.y) < 1e-8) return null;
    return setPoint(s, target, next);
  },
});

const latticeOrigin = { x: 210, y: 160 }, latticeScale = 46;
function latticeVertices(s: PlanarState) { return Array.from({ length: 5 }, (_, i) => pt(s, `v${i}`, [{ x: 1, y: 1 }, { x: 7, y: 1 }, { x: 8, y: 4 }, { x: 5, y: 7 }, { x: 1, y: 5 }][i])); }
function latticeScene(advanced: boolean) {
  return scene(advanced ? "56" : "34", advanced ? t("格点面积：数点与拼补", "Lattice area: points and dissection") : t("钉板上的面积与边界", "Geoboard area and boundary"),
    t("拖顶点吸附格点，保持简单无孔轮廓。内部点、边界点和单位面分别观察。", "Drag vertices between grid points, retaining a simple polygon without holes. Observe interior points, boundary points and area separately."), {
      create: () => state(advanced ? "56" : "34", {}, Object.fromEntries([{ x: 1, y: 1 }, { x: 7, y: 1 }, { x: 8, y: 4 }, { x: 5, y: 7 }, { x: 1, y: 5 }].map((p, i) => [`v${i}`, p])), { points: true, relation: false, units: true }),
      progress: advanced,
      toggles: [toggle("points", "区分内部点与边界点", "Classify interior and boundary points"), toggle("units", "显示整单位格", "Show full unit squares"), ...(advanced ? [toggle("relation", "显示格点面积关系", "Show the lattice-area relation")] : []), measures],
      actions: advanced ? [{ ...phaseAction("lattice-cut", "拆成三角片／拼回", "Separate into triangles or restore", 1600), run: (s) => ({ ...s, phase: s.phase > 0.99 ? 0 : 1, points: Object.fromEntries(Object.entries(s.points).filter(([key]) => key.startsWith("v"))) }),
        interpolate: (from, to, progress) => {
          if (progress >= 1 || to.phase > 0) return interpolatePlanarState(from, to, progress);
          const frame = interpolatePlanarState(from, to, progress), count = triangulatePolygon(latticeVertices(from)).length;
          for (let i = 0; i < count; i++) { const offset = pt(from, `part${i}`, { x: (i - (count - 1) / 2) * 45 * from.phase, y: (i % 2 ? -1 : 1) * 25 * from.phase }); frame.points[`part${i}`] = { x: offset.x * (1 - progress), y: offset.y * (1 - progress) }; }
          return frame;
        },
      }] : undefined,
      draw: (s, api) => {
        const vertices = latticeVertices(s), counts = latticeCounts(vertices), visual = translate(vertices, latticeOrigin, latticeScale), triangles = triangulatePolygon(vertices);
        return <>{Array.from({ length: 99 }, (_, index) => {
          const p = { x: index % 11, y: Math.floor(index / 11) }, visualPoint = translate([p], latticeOrigin, latticeScale)[0], kind = pointInPolygon(p, vertices);
          return <circle key={index} cx={visualPoint.x} cy={visualPoint.y} r={s.flags.points && kind !== "outside" ? 4 : 2} fill={s.flags.points ? kind === "boundary" ? "var(--rose)" : kind === "inside" ? "var(--leaf-deep)" : "var(--line)" : "var(--muted)"} />;
        })}
          {s.phase === 0 && <>{paper(visual, 0, 0.15)}{s.flags.units && Array.from({ length: 80 }, (_, index) => {
            const x = index % 10, y = Math.floor(index / 10), corners = rectanglePoints({ x, y, width: 1, height: 1 });
            return corners.every((p) => pointInPolygon(p, vertices) !== "outside") && pointInPolygon({ x: x + 0.5, y: y + 0.5 }, vertices) === "inside" ? <rect key={index} x={latticeOrigin.x + x * latticeScale} y={latticeOrigin.y + y * latticeScale} width={latticeScale} height={latticeScale} fill="none" stroke="var(--crater)" strokeWidth="1" /> : null;
          })}{visual.map((p, i) => <g key={i}>{dot(api, `v${i}`, p, String.fromCharCode(65 + i))}</g>)}</>}
          {advanced && s.phase > 0 && triangles.map((piece, i) => {
            const offset = pt(s, `part${i}`, { x: (i - (triangles.length - 1) / 2) * 45 * s.phase, y: (i % 2 ? -1 : 1) * 25 * s.phase });
            const at = translate(translate(piece, latticeOrigin, latticeScale), offset);
            return <g key={i} {...(s.phase > 0 ? api.bind(`part${i}`, `${api.locale === "en" ? "Triangle piece" : "三角片"} ${i + 1}`) : {})} style={{ pointerEvents: s.phase > 0 ? "auto" : "none", cursor: "grab" }}>{paper(at, i, s.phase > 0 ? 0.55 : 0)}{s.phase > 0 && s.flags.measures && label({ x: at.reduce((sum, p) => sum + p.x, 0) / 3, y: at.reduce((sum, p) => sum + p.y, 0) / 3 }, `${fmt(polygonArea(piece))} u²`)}</g>;
          })}
          {s.flags.measures && counts && label({ x: 480, y: 620 }, `${textFor(t("内部", "Inside"), api.locale)} I=${counts.inside.length} · ${textFor(t("边界", "Boundary"), api.locale)} B=${counts.boundary.length} · S=${fmt(counts.area)} u²`)}
          {advanced && s.flags.relation && counts && label({ x: 480, y: 655 }, `S = I + B/2 − 1 = ${fmt(counts.pickArea)} u²`)}
        </>;
      },
      drag: (s, target, point, delta) => {
        if (/^part\d+$/.test(target) && s.phase > 0) { const i = Number(target.slice(4)), count = triangulatePolygon(latticeVertices(s)).length; return setPoint(s, target, add(pt(s, target, { x: (i - (count - 1) / 2) * 45 * s.phase, y: (i % 2 ? -1 : 1) * 25 * s.phase }), delta)); }
        if (!/^v[0-4]$/.test(target) || s.phase > 0) return s;
        const next = setPoint(s, target, { x: Math.round(clamp((point.x - latticeOrigin.x) / latticeScale, 0, 10)), y: Math.round(clamp((point.y - latticeOrigin.y) / latticeScale, 0, 8)) });
        return simplePolygon(latticeVertices(next)) ? next : s;
      },
    });
}

const staircaseScene = scene("43", t("台阶、凹口与周长", "Staircases, notches and perimeter"), t("横边、竖边分别平移排齐；增大凹口，观察额外边界，不套用失效的外框周长。", "Collect horizontal and vertical edges separately. Add a notch to see the extra boundary rather than assume the bounding-box perimeter."), {
  create: () => state("43", { steps: 3, notch: 0 }), progress: true,
  fields: [field("steps", "台阶数", "Number of steps", 2, 8, 1), field("notch", "凹口深度（u）", "Notch depth (u)", 0, 1.5)],
  toggles: [measures], actions: [phaseAction("staircase-edges", "横竖边分别排齐／放回", "Collect horizontal and vertical edges or restore", 1800)],
  draw: (s, api) => {
    const model = staircasePolygon(7, 5, n(s, "steps", 3, 2, 8), n(s, "notch", 0, 0, 1.5)), visual = translate(model, { x: 280, y: 215 }, 40); let horizontal = 0, vertical = 0;
    return <><rect x="280" y="215" width="280" height="200" fill="none" stroke="var(--muted)" strokeDasharray="6 5" />{paper(visual, 0, 0.12)}
      {polygonSegments(visual).map(({ a, b }, i) => {
        const isHorizontal = Math.abs(a.y - b.y) < 1e-8, length = distance(a, b), target = isHorizontal ? { x: 135 + horizontal, y: 545 } : { x: 790, y: 120 + vertical };
        if (isHorizontal) horizontal += length; else vertical += length;
        const start = { x: a.x + (target.x - a.x) * s.phase, y: a.y + (target.y - a.y) * s.phase }, initialAngle = degrees(Math.atan2(b.y - a.y, b.x - a.x)), angle = initialAngle * (1 - s.phase) + (isHorizontal ? 0 : 90) * s.phase;
        return <g key={i}>{line(start, polar(start, length, angle), isHorizontal ? "var(--leaf-deep)" : "var(--crater)", false, 5)}</g>;
      })}
      {s.phase === 0 && dot(api, "notch", { x: 280 + n(s, "notch", 0, 0, 1.5) * 40, y: 315 }, textFor(t("凹口", "Notch"), api.locale))}
      {s.flags.measures && label({ x: 480, y: 625 }, `P = ${fmt(polygonPerimeter(model))} u · ${textFor(t("外框", "Bounding box"), api.locale)} = 24 u`)}</>;
  },
  drag: (s, target, point) => target === "notch" && s.phase === 0 ? setNumber(s, "notch", clamp((point.x - 280) / 40, 0, 1.5)) : s,
});

const clockScene = scene("60", t("钟面追及与夹角", "Clock hands and changing angles"), t("拨分针或调整分钟数；分针每分走 6°，时针同时走 0.5°，可保留起点影子。", "Drag the minute hand or set the time. The minute hand advances 6° per minute while the hour hand advances 0.5°. Keep a starting-time ghost."), {
  create: () => state("60", { minutes: 120, start: 120, span: 60 }, {}, { ghost: true, reflex: false }),
  fields: [field("minutes", "从 0:00 起的分钟数", "Minutes from 0:00", 0, 1440, 0.1), field("span", "每次演示经过分钟数", "Minutes advanced per demonstration", 1, 120, 1)],
  toggles: [toggle("ghost", "保留起始指针影子", "Keep starting-hand ghosts"), toggle("reflex", "观察较大夹角", "Observe the larger angle"), measures],
  actions: [
    { id: "clock-advance", icon: "play", label: t("连续走时", "Run the clock continuously"), run: (s) => ({ ...s, params: { ...s.params, start: n(s, "minutes", 120, 0, 1440), minutes: Math.min(1440, n(s, "minutes", 120) + n(s, "span", 60, 1, 120)) } }), duration: 10000,
      interpolate: (from, to, progress) => { const frame = interpolatePlanarState(from, to, progress); return { ...frame, params: { ...frame.params, start: to.params.start } }; },
    },
    { id: "clock-ghost", icon: "mark", label: t("保留此刻指针", "Keep these hand positions"), run: (s) => setNumber(s, "start", n(s, "minutes", 120)) },
  ],
  draw: (s, api) => {
    const center = { x: 480, y: 350 }, minutes = n(s, "minutes", 120, 0, 1440), angles = clockHands(minutes), ghost = clockHands(n(s, "start", 120));
    const hour = polar(center, 125, angles.hour - 90), minute = polar(center, 180, angles.minute - 90);
    let sweep = ((angles.minute - angles.hour + 540) % 360) - 180;
    if (s.flags.reflex) sweep = sweep >= 0 ? sweep - 360 : sweep + 360;
    const integerMinutes = Math.floor(minutes), hourText = String(Math.floor(integerMinutes / 60) % 24).padStart(2, "0"), minuteText = String(integerMinutes % 60).padStart(2, "0");
    return <><circle cx={center.x} cy={center.y} r="215" fill="var(--paper)" stroke="var(--crater)" strokeWidth="2" />
      {Array.from({ length: 60 }, (_, i) => <g key={i}>{line(polar(center, i % 5 ? 209 : 201, i * 6 - 90), polar(center, 215, i * 6 - 90), "var(--muted)", false, i % 5 ? 1 : 2)}{i % 5 === 0 && label(polar(center, 184, i * 6 - 90), i === 0 ? 12 : i / 5)}</g>)}
      {s.flags.ghost && <g opacity="0.25">{line(center, polar(center, 125, ghost.hour - 90), "var(--ink)", true, 4)}{line(center, polar(center, 180, ghost.minute - 90), "var(--rose)", true, 3)}</g>}
      {Math.abs(sweep) > 0.01 && Math.abs(sweep) < 359.99 && <path d={wedge(center, 64, angles.hour - 90, sweep)} fill="var(--moon)" fillOpacity="0.6" stroke="var(--crater)" />}
      {line(center, hour, "var(--ink)", false, 7)}{line(center, minute, "var(--rose)", false, 4)}{dot(api, "minute", minute, undefined, "var(--rose)")}{dot(api, "hour", hour, undefined, "var(--ink)")}
      <circle cx={center.x} cy={center.y} r="7" fill="var(--crater)" />
      <RightAngleMark vertex={center} along={hour} toward={minute} />
      {label({ x: 480, y: 615 }, `${hourText}:${minuteText}${s.flags.measures ? ` · ${fmt(s.flags.reflex ? angles.largerAngle : angles.smallerAngle)}°` : ""}`)}
    </>;
  },
  drag: (s, target, point) => {
    if (!["minute", "hour"].includes(target)) return s;
    const angle = (degrees(Math.atan2(point.y - 350, point.x - 480)) + 450) % 360, current = n(s, "minutes", 120, 0, 1440);
    if (target === "hour") { const candidates = [angle * 2, angle * 2 + 720]; return setNumber(s, "minutes", candidates.sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0]); }
    const withinHour = angle / 6, baseHour = Math.floor(current / 60) * 60;
    const candidates = [baseHour - 60 + withinHour, baseHour + withinHour, baseHour + 60 + withinHour].filter((value) => value >= 0 && value <= 1440);
    return setNumber(s, "minutes", candidates.sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0]);
  },
});

export const planeGeometryScenes: readonly PlanarSceneDefinition[] = [
  materialScene(false), materialScene(true), linesScene, angleScene, parallelScene, rodsScene, triangleAnglesScene,
  quadrilateralScene, perimeterScene, unitAreaScene, samePerimeterScene, sharedBoundaryScene, latticeScene(false),
  staircaseScene, latticeScene(true), clockScene,
];
