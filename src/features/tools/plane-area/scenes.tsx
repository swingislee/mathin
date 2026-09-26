import type { PlanarAction, PlanarDrawingApi, PlanarField, PlanarSceneDefinition, PlanarText, PlanarToggle } from "../planar-kit/types";
import { textFor } from "../planar-kit/types";
import type { PlanarState } from "../planar-kit/contract";
import { HeightMark, RightAngleMark } from "../planar-kit/geometry";
import { AREA_ORIGIN, AREA_SCALE, AREA_SCENES, add, applyPose, buildAreaModel, clamp, createAreaState, cutNextAreaPaper, dragAreaState, duplicateMidpointTriangle, midpointCopyPoints, mix, movableAreaPiece, param, point, requiredAreaCuts, scale, selectedMidpointLayer, snapAreaState, sub, toScreen, vertex, type AreaPiece, type AreaSceneId } from "./model";

const words = (zh: string, en: string): PlanarText => ({ zh, en });
const descriptions: Record<AreaSceneId, { title: PlanarText; description: PlanarText }> = {
  "14": { title: words("平行四边形的多种剪拼", "Parallelogram dissections"), description: words("沿高逐刀剪开，再抓住纸片搬动。开启斜边作底，或增大倾斜量，比较不同底与两次切割。高始终带直角标记。", "Cut along an altitude, then move the pieces. Change the base or increase the shear to explore two successive cuts. Each altitude carries a right-angle mark.") },
  "15": { title: words("两个三角形拼成平行四边形", "Two triangles make a parallelogram"), description: words("先复制同一个三角形，再播放或拖动纸片；原底与高保留在现场。", "Duplicate the triangle, then animate or drag the copy. The original base and altitude remain visible.") },
  "16": { title: words("两个梯形拼成平行四边形", "Two trapezoids make a parallelogram"), description: words("复制后转动拼合，改变上下底和高，观察总底长与原来的两条底。", "Duplicate and turn a trapezoid. Change its two bases and height to inspect the combined base.") },
  "17": { title: words("组合图形的分割与补形", "Split and complete composite shapes"), description: words("抓凹口改变形状，切换横分或竖分。补入的纸片单独标色，面积读数只计原图。", "Drag the notch, compare horizontal and vertical cuts, or add the missing region. Added paper uses a separate color and is not counted as original area.") },
  "18": { title: words("等底等高与正方形细条", "Equal heights and square strips"), description: words("三个顶点都可拖动。锁平行时每条方格只平移、不增减；细分后阶梯轮廓逼近三角形。解除平行可比较高度变化，也可另选完整格与边界格覆盖。", "Drag any vertex. With parallel lines locked, each square strip slides without gaining or losing cells. Finer strips approach the triangle. Release the constraint to change height, or compare inner and boundary-cell coverage.") },
  "27": { title: words("圆的扇形剪拼", "Rearrange circle sectors"), description: words("扇形逐片平移、转向并交错排列；增加份数后比较。每一片始终保留真实弧边。", "Move and turn equal sectors into alternating rows. Increase the number of pieces and compare; the curved edges stay curved.") },
  "33": { title: words("重叠与区域", "Overlap and regions"), description: words("直接拖动第二张方形纸，或准确调整转角。对照重叠、合在一起与未重叠部分的面积。", "Drag the second square or set its angle. Compare the overlap, union and remaining area.") },
  "37": { title: words("等高变底与面积关系", "Bases and areas with equal heights"), description: words("拖动底边分点 D 或顶点 C。两片始终共高，面积和底边的分配同时变化。", "Drag D along the base or move C. The two triangles share an altitude while their bases and areas change.") },
  "38": { title: words("共角与鸟头", "Triangles sharing one angle"), description: words("D、E 分别沿共角的两边移动。两条边可以各自变化，共角不表示相似。", "Move D and E independently along the sides of the common angle. Sharing an angle does not make the triangles similar.") },
  "39": { title: words("燕尾：内点与两翼", "An interior point and four regions"), description: words("拖动 D 和 P；共线开启时 P 留在顶点与 D 的连线上。解除共线后对照两翼关系。", "Drag D and P. With collinearity enabled, P stays on the line from the apex to D. Release the constraint and compare the wings.") },
  "40": { title: words("蝴蝶：四边形的四片", "Four regions of a quadrilateral"), description: words("四个顶点均可拖动。先保留一组平行边，再解除平行，比较两翼面积。", "Drag all four vertices. Compare the wing areas with and without a pair of parallel sides.") },
  "41": { title: words("共边与共同部分", "A shared base and a common region"), description: words("拖动内点改变共同部分，或把共同纸片移开。两条高都用直角标记连接到底边。", "Move the interior point or remove the common piece. Both altitudes meet the shared base with right-angle marks.") },
  "42": { title: words("中点与层层嵌套", "Midpoints and nested triangles"), description: words("点选内层三角形，再复制出独立纸片，拖动或转动来对比，每层最多一张。原图顶点可继续拖动；已复制纸片保留复制时的形状与面积，不随原图变化。", "Select an inner triangle and duplicate it as independent paper to move and turn; keep one copy per layer. Original vertices remain movable. Copies retain their shape and area when the original changes.") },
  "44": { title: words("叶形与弓形割补", "Leaf and circular-segment regions"), description: words("圆心、半径和辅助对角线一起展示。把叶形分成两片弓形，移动、配对，再回到原位。", "Inspect the centers, radii and auxiliary diagonal. Separate the leaf into two circular segments, move them and restore them.") },
  "45": { title: words("方中圆与圆中方", "Circles and squares"), description: words("比较外接与内接正方形；相同颜色的四块曲边区域可以分别拿开。圆弧和对应半径保持不变。", "Compare circumscribed and inscribed squares. Move the four matching curved regions while preserving the circles and radii.") },
  "46": { title: words("等面积的不同分法", "Equal areas, different shapes"), description: words("长方形和两个三角形可以各占三分之一。解除等积约束，直接拖动切口，观察面积变化，再拆开比较。", "A rectangle and two triangles can each cover one third. Release equal-area locking, drag the cut, and separate the pieces.") },
  "58": { title: words("勾股弦图的四片剪拼", "Four congruent right triangles"), description: words("在同一外框中重新摆放四片全等直角三角形。过程只平移、转动，纸片不变形也不翻面。", "Rearrange four congruent right triangles inside one square. Every piece moves rigidly without stretching or reflection.") },
  "59": { title: words("沙漏与金字塔", "Hourglass and nested triangles"), description: words("拖动平行截线端点，对照对应长度与面积。解除平行时，两端可独立移动，关系随之变化。", "Move the parallel cross-section and compare lengths and areas. Release parallelism to move its endpoints independently.") },
};
const colors = ["var(--leaf)", "var(--moon)", "var(--cheek)", "var(--crater)"];
const labels: Record<string, PlanarText> = {
  area: words("原图面积", "Original area"), cuts: words("所需切割", "Cuts needed"), base: words("所选底", "Selected base"), height: words("对应高", "Altitude"),
  lower: words("完整正方形覆盖", "Inner square cover"), upper: words("含边界格覆盖", "Outer square cover"), small: words("小三角形", "Small triangle"), ratio: words("面积比", "Area ratio"),
  stripArea: words("方格条总面积（近似）", "Square-strip area (approx.)"), squareSize: words("小正方形边长", "Small-square side"),
  common: words("共同部分", "Common region"), remainder: words("剩余部分", "Remaining region"), single: words("一片面积", "One piece"), total: words("现有纸片总面积", "Total paper area"), added: words("补入面积", "Added area"),
  halfCircumference: words("半周长", "Half circumference"), radius: words("半径", "Radius"), count: words("扇形片数", "Sectors"), intersection: words("重叠", "Intersection"), union: words("合在一起", "Union"), difference: words("A 未重叠部分", "A outside B"),
  leaf: words("叶形", "Leaf"), segment: words("一片弓形", "One segment"), outerDifference: words("方中圆外部", "Outside the inscribed circle"), innerDifference: words("圆中方外部", "Outside the inscribed square"),
  outer: words("外框面积", "Outer square"), fourPieces: words("四片总面积", "Four pieces"), remaining: words("空白总面积", "Remaining area"), lengthRatio: words("对应边倍率", "Length factor"), areaRatio: words("小大面积比", "Small-to-large area"), sandglassRatio: words("沙漏下上面积比", "Lower-to-upper area"),
};
const number = (v: number) => Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(2);
const pointsString = (points: { x: number; y: number }[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
const poseTransform = (p: { x: number; y: number; angle: number }) => `translate(${p.x} ${p.y}) rotate(${p.angle})`;
const stroke = { stroke: "var(--ink)", strokeWidth: 2, vectorEffect: "non-scaling-stroke" as const, strokeLinejoin: "round" as const };

function PieceShape({ piece, ghost = false }: { piece: AreaPiece; ghost?: boolean }) {
  const props = { ...stroke, fill: ghost || piece.outline ? "none" : colors[piece.tone % colors.length], fillOpacity: 0.72, fillRule: piece.fillRule, stroke: ghost ? "var(--muted)" : "var(--ink)", strokeDasharray: ghost ? "5 5" : undefined, strokeWidth: ghost ? 1 : 2 };
  return piece.path ? <path d={piece.path} {...props} /> : <polygon points={pointsString(piece.points ?? [])} {...props} />;
}

function drawArea(state: PlanarState, api: PlanarDrawingApi) {
  const model = buildAreaModel(state), showMeasures = state.flags.measures !== false;
  return <g data-plane-area-scene={state.sceneId}>
    <g transform={`translate(${AREA_ORIGIN.x} ${AREA_ORIGIN.y}) scale(${AREA_SCALE} ${-AREA_SCALE})`}>
      {state.flags.original && model.outlines.map((outline, index) => <polygon key={`outline${index}`} points={pointsString(outline)} fill="none" stroke="var(--muted)" strokeWidth="1" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
      {state.flags.original && model.pieces.filter((piece) => !(state.sceneId === "42" && piece.id.startsWith("copy.level")) && (piece.path || piece.pose.x !== piece.original.x || piece.pose.y !== piece.original.y || piece.pose.angle !== piece.original.angle)).map((piece) => <g key={`ghost${piece.id}`} transform={poseTransform(piece.original)} pointerEvents="none"><PieceShape piece={piece} ghost /></g>)}
      {model.pieces.map((piece) => {
        const target = `piece.${piece.id}`, movable = movableAreaPiece(state, piece.id), layer = selectedMidpointLayer(state, target);
        const label = layer === null ? `${api.locale === "en" ? "Paper" : "纸片"} ${piece.label ?? piece.id}` : api.locale === "en" ? `Layer ${layer}: select to duplicate` : `第 ${layer} 层三角形，点选后可复制`;
        return <g key={piece.id} transform={poseTransform(piece.pose)} {...(movable || layer !== null ? api.bind(target, label) : {})} style={{ cursor: api.editable ? movable ? "grab" : layer !== null ? "pointer" : undefined : undefined }} data-area-paper={piece.id}>
          <PieceShape piece={piece} />
          {api.selected === target && <g fill="none" stroke="var(--leaf-deep)" strokeWidth="1" strokeDasharray="5 4" pointerEvents="none">{piece.path ? <path d={piece.path} fill="none" vectorEffect="non-scaling-stroke" /> : <polygon points={pointsString(piece.points ?? [])} fill="none" vectorEffect="non-scaling-stroke" />}</g>}
        </g>;
      })}
      {state.sceneId === "33" && model.pieces.find((piece) => piece.id === "B")?.points && <polygon points={pointsString(model.pieces.find((piece) => piece.id === "B")!.points!)} fill="transparent" stroke="none" {...api.bind("piece.B", api.locale === "en" ? "Drag paper B" : "拖动纸片 B")} style={{ cursor: api.editable ? "grab" : undefined }} />}
      {model.cells?.map((cell, index) => <polygon key={`cell${index}`} points={pointsString(cell.points)} fill={cell.row !== undefined ? colors[cell.row % 2] : cell.inside ? "var(--leaf-deep)" : "var(--moon)"} fillOpacity={cell.row !== undefined ? 0.85 : cell.inside ? 0.4 : 0.35} stroke="var(--muted)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" pointerEvents="none" data-area-cell={cell.row !== undefined ? "strip" : cell.inside ? "inner" : "boundary"} data-area-strip={cell.row} />)}
    </g>
    {model.guides.filter((guide) => showMeasures || guide.kind === "cut").map((guide, i) => {
      const a = toScreen(guide.a), b = toScreen(guide.b);
      const end = mix(a, b, guide.amount ?? 0);
      return <g key={`guide${i}`} pointerEvents="none"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted)" strokeWidth="1.2" strokeDasharray={guide.kind === "line" ? undefined : "6 5"} />{guide.kind === "cut" && (guide.amount ?? 0) > 0 && <line x1={a.x} y1={a.y} x2={end.x} y2={end.y} stroke="var(--rose)" strokeWidth="2.3" data-cut-progress={guide.amount} />}</g>;
    })}
    {showMeasures && model.heights.map((height, i) => <HeightMark key={`height${i}`} vertex={toScreen(height.vertex)} baseA={toScreen(height.baseA)} baseB={toScreen(height.baseB)} label={height.label} />)}
    {showMeasures && model.rightAngles?.map((mark, i) => <RightAngleMark key={`right${i}`} vertex={toScreen(mark.vertex)} along={toScreen(mark.along)} toward={toScreen(mark.toward)} />)}
    {showMeasures && state.sceneId === "58" && model.pieces.map((piece) => <RightAngleMark key={`triangleRight${piece.id}`} vertex={toScreen(applyPose(piece.points![0], piece.pose))} along={toScreen(applyPose(piece.points![1], piece.pose))} toward={toScreen(applyPose(piece.points![2], piece.pose))} />)}
    {model.handles.map((handle) => {
      const p = toScreen(handle.point), disabled = state.sceneId === "46" && state.flags.constraint;
      return <g key={handle.id} {...(!disabled ? api.bind(`handle.${handle.id}`, `${api.locale === "en" ? "Point" : "顶点"} ${handle.label}`) : {})} style={{ cursor: api.editable && !disabled ? "grab" : undefined }} data-area-handle={handle.id}>
        <circle cx={p.x} cy={p.y} r="18" fill="transparent" />
        <circle cx={p.x} cy={p.y} r="6.5" fill="var(--paper)" stroke="var(--leaf-deep)" strokeWidth="2" />
        <text x={p.x + 12} y={p.y - 12} fill="var(--ink)" paintOrder="stroke" stroke="var(--paper)" strokeWidth="4" fontSize="16" pointerEvents="none">{handle.label}</text>
      </g>;
    })}
    {state.flags.areas && <g data-area-readouts="true" pointerEvents="none" fontSize="16" fill="var(--ink)">
      {Object.entries(model.values).map(([key, value], i) => <text key={key} x={76 + (i % 3) * 276} y={616 + Math.floor(i / 3) * 26} paintOrder="stroke" stroke="var(--paper)" strokeWidth="5">{labels[key] ? textFor(labels[key], api.locale) : key} = {number(value)}</text>)}
    </g>}
    {state.flags.areas && ["18", "37", "38", "39", "40", "41", "42"].includes(state.sceneId) && model.pieces.filter((piece) => piece.points?.length && !piece.outline).map((piece) => {
      const center = piece.points!.reduce((sum, p) => add(sum, p), point(0, 0)), p = toScreen(applyPose(scale(center, 1 / piece.points!.length), piece.pose));
      return <text key={`area${piece.id}`} x={p.x} y={p.y} textAnchor="middle" fontSize="15" fill="var(--ink)" paintOrder="stroke" stroke="var(--paper)" strokeWidth="5" pointerEvents="none">{piece.label} · {number(piece.area)}</text>;
    })}
  </g>;
}

const field = (key: string, zh: string, en: string, min: number, max: number, step = 0.1): PlanarField => ({ key, label: words(zh, en), min, max, step });
const base = field("base", "底边", "Base", 2, 7), height = field("height", "高", "Height", 1, 6), slant = field("slant", "倾斜量", "Shear", 0.2, 8), radius = field("radius", "半径", "Radius", 1, 2.5);
const ratio = field("fraction", "分点位置", "Division position", 0.05, 0.95, 0.01), secondary = field("secondary", "第二个分点", "Second position", 0.05, 0.95, 0.01);
const fields: Record<AreaSceneId, readonly PlanarField[]> = {
  "14": [field("base", "底边", "Base", 2, 6), height, slant], "15": [base, height, field("slant", "顶点沿底位置", "Apex projection", -1, 5)], "16": [field("base", "下底", "Bottom base", 2, 6), field("top", "上底", "Top base", 1, 4), height, field("slant", "倾斜量", "Shear", 0.2, 2.5)],
  "17": [base, height, ratio, secondary], "18": [base, height, field("slant", "顶点沿底位置", "Apex projection", -1.5, 10), { ...field("count", "正方形细分档位", "Square refinement", 4, 48, 4), options: [4, 8, 16, 32, 48].map((n) => ({ value: n, label: words(`${n} 格${n === 4 ? "（粗）" : n === 48 ? "（细）" : ""}`, `${n} divisions${n === 4 ? " (coarse)" : n === 48 ? " (fine)" : ""}`) })) }],
  "27": [radius, { ...field("count", "扇形片数", "Sector count", 8, 64, 8), options: [8, 16, 32, 64].map((n) => ({ value: n, label: words(`${n} 等份`, `${n} equal sectors`) })) }], "33": [field("base", "方形边长", "Square side", 2, 5), field("angle", "第二张纸转角", "Second square angle", -180, 180, 1)],
  "37": [base, height, ratio], "38": [ratio, secondary], "39": [ratio, secondary], "40": [], "41": [secondary], "42": [field("layers", "嵌套层数", "Nested layers", 1, 5, 1)],
  "44": [radius], "45": [radius], "46": [base, height, { ...ratio, label: words("切口位置（改动解除等积）", "Cut position (releases equal areas)") }], "58": [field("base", "直角边 a", "Leg a", 1, 4), field("height", "直角边 b", "Leg b", 1, 4)], "59": [ratio, secondary],
};
const toggle = (key: string, zh: string, en: string): PlanarToggle => ({ key, label: words(zh, en) });
const commonToggles = [toggle("areas", "显示面积与关系读数", "Show areas and relationships"), toggle("original", "保留原位轮廓", "Keep original outlines")];
const toggles: Partial<Record<AreaSceneId, readonly PlanarToggle[]>> = {
  "14": [toggle("alternate", "改用斜边作底", "Use the oblique side as base")], "17": [toggle("alternate", "竖向分割", "Split vertically"), toggle("complement", "补齐外框", "Add the missing region")],
  "18": [toggle("constraint", "锁定两条平行线", "Keep parallel lines"), toggle("strips", "显示正方形细条", "Show square strips"), toggle("cover", "改为完整格与边界格覆盖", "Compare inner and boundary-cell coverage")], "33": [toggle("intersection", "强调重叠区域", "Highlight the intersection"), toggle("union", "强调两张纸合在一起", "Highlight the union"), toggle("difference", "强调 A 未重叠的部分", "Highlight A outside B")],
  "39": [toggle("constraint", "保持顶点、P、D 共线", "Keep apex, P and D collinear")], "40": [toggle("constraint", "保持上下底平行", "Keep bases parallel")], "41": [toggle("constraint", "内点沿中线移动", "Keep the point on the median")],
  "46": [toggle("constraint", "锁定三片等面积", "Keep three equal areas")], "59": [toggle("constraint", "保持截线平行", "Keep parallel cross-sections")],
};
const movingScenes = new Set<AreaSceneId>(["14", "15", "16", "17", "27", "41", "44", "45", "46", "58"]);
const clearPieces = (state: PlanarState): PlanarState => ({ ...state, points: Object.fromEntries(Object.entries(state.points).filter(([key]) => !key.startsWith("piece."))), params: Object.fromEntries(Object.entries(state.params).filter(([key]) => !key.startsWith("turn."))) });
export function interpolateAreaArrangement(from: PlanarState, to: PlanarState, t: number): PlanarState {
  if (t >= 1) return to;
  const points = { ...to.points }, params = { ...to.params };
  for (const [key, position] of Object.entries(from.points)) if (key.startsWith("piece.")) points[key] = mix(position, to.points[key] ?? point(0, 0), t);
  for (const [key, angle] of Object.entries(from.params)) if (key.startsWith("turn.")) params[key] = angle + ((to.params[key] ?? 0) - angle) * t;
  return { ...to, points, params, phase: from.phase + (to.phase - from.phase) * t };
}
function interpolateMidpointCopy(from: PlanarState, to: PlanarState, t: number): PlanarState {
  if (t >= 1) return to;
  const points = { ...to.points };
  for (let layer = 1; layer <= 5; layer += 1) {
    if (!midpointCopyPoints(to, layer) || midpointCopyPoints(from, layer)) continue;
    const key = `piece.copy.level${layer}`;
    points[key] = scale(to.points[key], t);
  }
  return { ...to, points };
}
export function setAreaField(state: PlanarState, key: string, value: number): PlanarState {
  const definition = fields[state.sceneId as AreaSceneId]?.find((entry) => entry.key === key);
  if (!definition) return state;
  let amount = clamp(value, definition.min, definition.max);
  if (key === "layers" || key === "count") amount = Math.round(amount);
  if (key === "count" && state.sceneId === "27") amount = amount < 12 ? 8 : amount < 24 ? 16 : amount < 48 ? 32 : 64;
  let next = { ...state, params: { ...state.params, [key]: amount } };
  if (state.sceneId === "46" && key === "fraction") next.flags = { ...next.flags, constraint: Math.abs(amount - 1 / 3) < 1e-8 };
  if (state.sceneId === "59" && state.flags.constraint && ["fraction", "secondary"].includes(key)) next.params = { ...next.params, fraction: amount, secondary: amount };
  if (["39", "41"].includes(state.sceneId) && key === "secondary" && !state.flags.constraint) next.points = { ...next.points, P: mix(state.points.C, mix(state.points.A, state.points.B, state.sceneId === "39" ? param(state, "fraction") : 0.5), amount) };
  if (["18", "37"].includes(state.sceneId) && ["base", "height", "slant"].includes(key)) {
    const a = vertex(state, "A", point(0, 0)), b = vertex(state, "B", point(6, 0)), c = vertex(state, "C", point(1.8, 3.5)), d = sub(b, a), length = Math.max(0.001, Math.hypot(d.x, d.y)), along = scale(d, 1 / length), normal = point(-along.y, along.x);
    const currentHeight = (c.x - a.x) * normal.x + (c.y - a.y) * normal.y, currentSlant = (c.x - a.x) * along.x + (c.y - a.y) * along.y;
    const nextB = key === "base" ? add(a, scale(along, amount)) : b;
    const nextC = add(a, add(scale(along, key === "slant" ? amount : currentSlant), scale(normal, key === "height" ? amount * (Math.sign(currentHeight) || 1) : currentHeight)));
    next = { ...next, points: { ...next.points, B: nextB, C: nextC } };
  }
  if (["14", "15", "16", "17", "27", "44", "45", "46", "58"].includes(state.sceneId)) next = { ...clearPieces(next), phase: 0, params: { ...clearPieces(next).params, cuts: 0 } };
  return next;
}
function setAreaFlag(state: PlanarState, key: string, value: boolean): PlanarState {
  let next = { ...state, flags: { ...state.flags, [key]: value } };
  if (state.sceneId === "33" && ["intersection", "union", "difference"].includes(key) && value) next = { ...next, flags: { ...next.flags, intersection: false, union: false, difference: false, [key]: true } };
  if (state.sceneId === "14" && key === "alternate") next = { ...clearPieces(next), phase: 0, params: { ...clearPieces(next).params, cuts: 0 } };
  if (["39", "41"].includes(state.sceneId) && key === "constraint" && !value) {
    const model = buildAreaModel(state), p = model.handles.find((handle) => handle.id === "P")?.point;
    if (p) next = { ...next, points: { ...next.points, P: p } };
  }
  if (state.sceneId === "40" && key === "constraint" && value) next = { ...next, points: { ...next.points, B: { ...next.points.B, y: next.points.A.y }, D: { ...next.points.D, y: next.points.C.y } } };
  if (state.sceneId === "59" && key === "constraint" && value) next = { ...next, params: { ...next.params, secondary: next.params.fraction } };
  return next;
}
function sceneActions(id: AreaSceneId): PlanarAction[] {
  const actions: PlanarAction[] = [];
  if (id === "18") actions.push({ id: "refine-strips", icon: "increase", label: words("继续细分方格条", "Refine the square strips"), duration: 1100,
    run: (s) => ({ ...s, flags: { ...s.flags, strips: true, cover: false }, params: { ...s.params, count: [4, 8, 16, 32, 48].find((n) => n > param(s, "count", 16)) ?? 48 } }), disabled: (s) => param(s, "count", 16) >= 48,
    interpolate: (from, to, t) => ({ ...to, params: { ...to.params, count: Math.round(param(from, "count", 16) + (to.params.count - param(from, "count", 16)) * t) } }),
  });
  if (id === "14") actions.push({ id: "cut", icon: "cut", label: words("沿下一条高剪开", "Make the next cut"), duration: 480, run: cutNextAreaPaper, disabled: (s) => param(s, "cuts") >= requiredAreaCuts(s), interpolate: (from, to, t) => t >= 1 ? to : ({ ...from, phase: 0, params: { ...from.params, cuts: from.params.cuts + (to.params.cuts - from.params.cuts) * t } }) });
  if (["15", "16"].includes(id)) actions.push({ id: "duplicate", icon: "duplicate", label: words("复制同一张纸片", "Duplicate the paper"), run: (s) => ({ ...s, phase: 0, flags: { ...s.flags, duplicate: true } }), disabled: (s) => !!s.flags.duplicate });
  if (id === "42") actions.push({ id: "duplicate", icon: "duplicate", label: words("复制选中层的纸片", "Duplicate the selected layer"), duration: 700,
    run: (s, context) => duplicateMidpointTriangle(s, context.selected), disabled: (s, context) => { const layer = selectedMidpointLayer(s, context.selected); return layer === null || !!midpointCopyPoints(s, layer); },
    interpolate: interpolateMidpointCopy,
  });
  if (movingScenes.has(id)) actions.push({ id: "arrange", icon: "demonstrate", label: words("演示剪拼过程", "Demonstrate the rearrangement"), duration: id === "27" ? 3200 : 1800, run: (s) => ({ ...clearPieces(s), phase: s.phase > 0.95 ? 0 : 1 }), disabled: (s) => id === "14" ? param(s, "cuts") < requiredAreaCuts(s) : ["15", "16"].includes(id) && !s.flags.duplicate,
    interpolate: interpolateAreaArrangement });
  if (id === "14") actions.push({ id: "two-cuts", icon: "dimensions", label: words("试一块需要两次剪切的纸", "Try a two-cut parallelogram"), run: () => ({ ...createAreaState("14"), params: { ...createAreaState("14").params, base: 3.5, slant: 5.5, height: 3 } }) });
  if (movingScenes.has(id) || id === "42") for (const direction of [-1, 1] as const) actions.push({
    id: direction > 0 ? "turn-positive" : "turn-negative", icon: direction > 0 ? "positiveTurn" : "negativeTurn", label: direction > 0 ? words("选中纸片逆时针转 90°", "Turn selected paper 90° counterclockwise") : words("选中纸片顺时针转 90°", "Turn selected paper 90° clockwise"), duration: 420,
    disabled: (s, context) => !context.selected?.startsWith("piece.") || !movableAreaPiece(s, context.selected.slice(6)),
    run: (s, context) => { const id = context.selected?.slice(6); return id && movableAreaPiece(s, id) ? { ...s, params: { ...s.params, [`turn.${id}`]: param(s, `turn.${id}`) + direction * 90 } } : s; },
    interpolate: (from, to, t) => ({ ...to, params: Object.fromEntries(Object.entries(to.params).map(([key, value]) => [key, key.startsWith("turn.") ? param(from, key) + (value - param(from, key)) * t : value])) }),
  });
  return actions;
}
export const planeAreaScenes: PlanarSceneDefinition[] = AREA_SCENES.map((id) => ({
  id, toolId: "plane-area", ...descriptions[id], create: () => ({ ...createAreaState(id), flags: { ...createAreaState(id).flags, intersection: true } }),
  progress: movingScenes.has(id), fields: fields[id], toggles: [...commonToggles, ...(movingScenes.has(id) || id === "42" ? [toggle("snap", "纸片落点吸附", "Snap paper positions")] : []), ...(toggles[id] ?? [])],
  actions: sceneActions(id), setField: setAreaField, setFlag: setAreaFlag, draw: drawArea, drag: dragAreaState, snap: snapAreaState,
  summary: (state, locale) => {
    const model = buildAreaModel(state);
    if (id === "14") return `${locale === "en" ? "Cuts" : "已剪"} ${Math.floor(param(state, "cuts"))} / ${requiredAreaCuts(state)}`;
    if (id === "18" && state.flags.strips) return state.flags.cover ? `${number(model.values.lower)} ≤ S ≤ ${number(model.values.upper)}` : `${locale === "en" ? "Approximate square strips" : "方格长条近似模型"} · ${number(model.values.squareSize)}`;
    return state.flags.areas ? Object.entries(model.values).slice(0, 3).map(([key, value]) => `${labels[key] ? textFor(labels[key], locale) : key} ${number(value)}`).join(" · ") : "";
  },
}));
