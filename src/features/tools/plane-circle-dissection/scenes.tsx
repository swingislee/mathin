import type { PlanarState } from "../planar-kit/contract";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { arrangeCircleSectors, changeCircleCount, createCircleDissectionState, dragCircleSector, interpolateCircleSectors, SECTOR_UNIT, sectorPoint, sectorPose, sectorTargetId, sectorToStage, selectSector, setCircleSectorField, snapCircleSector, type SectorPose } from "./model";
import { CIRCLE_DISSECTION_SCENE, isValidCircleDissectionState } from "./validation";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const fmt = (value: number) => Number(value.toFixed(3)).toString();
const missing = (state: PlanarState) => !sectorPose(state);
const styles = { fill: "var(--ink)", stroke: "var(--paper)", strokeWidth: 4, paintOrder: "stroke" as const, fontSize: 16 };

/** 真正圆弧沿数学逆时针方向；SVG 的 Y 向下，因此弧命令 sweep 为 0。 */
export function circleSectorPath(pose: SectorPose, radius: number, count: number) {
  const apex = sectorToStage(pose), a = sectorToStage(sectorPoint(pose, radius, 0)), b = sectorToStage(sectorPoint(pose, radius, 360 / count));
  return `M${apex.x},${apex.y} L${a.x},${a.y} A${radius * SECTOR_UNIT},${radius * SECTOR_UNIT} 0 0 0 ${b.x},${b.y} Z`;
}
function pieceBounds(pose: SectorPose, radius: number, count: number) {
  const sweep = 360 / count, candidates = [pose, sectorPoint(pose, radius, 0), sectorPoint(pose, radius, sweep)];
  for (const angle of [0, 90, 180, 270]) {
    const relative = ((angle - pose.angle) % 360 + 360) % 360;
    if (relative <= sweep) candidates.push(sectorPoint(pose, radius, relative));
  }
  const points = candidates.map(sectorToStage);
  return { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) };
}
function CircleSectors({ state, api }: { state: PlanarState; api: PlanarDrawingApi }) {
  const { count, radius } = state.params, selected = sectorTargetId(api.selected), center = sectorToStage({ x: 3.5, y: 2.5 });
  return <g data-circle-dissection>
    {state.flags.original && <circle data-circle-original cx={center.x} cy={center.y} r={radius * SECTOR_UNIT} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="6 5" pointerEvents="none" />}
    {Array.from({ length: count }, (_, id) => {
      const pose = sectorPose(state, id)!, chosen = selected === id, apex = sectorToStage(pose), label = sectorToStage(sectorPoint(pose, radius * .72, 180 / count));
      return <g key={id} data-circle-sector={id}>
        <path d={circleSectorPath(pose, radius, count)} fill={id < count / 2 ? "var(--rose)" : "var(--leaf)"} fillOpacity={chosen ? .65 : .38} stroke={chosen ? "var(--ink)" : "var(--paper)"} strokeWidth={chosen ? 2.5 : 1.4}
          {...api.bind(`sector.${id}`, textFor(t(`圆片 ${id + 1}`, `Sector ${id + 1}`), api.locale))} style={{ cursor: "grab" }} />
        {state.flags.names && <text x={label.x} y={label.y + 5} textAnchor="middle" style={{ ...styles, fontSize: count > 32 ? 10 : 13 }} pointerEvents="none">{id + 1}</text>}
        {chosen && <circle cx={apex.x} cy={apex.y} r={4} fill="var(--ink)" pointerEvents="none" />}
      </g>;
    })}
    {api.editable && api.operation === "circle-sector-pose" && selected >= 0 && selected < count && (() => {
      const pose = sectorPose(state, selected)!, apex = sectorToStage(pose), grip = sectorToStage(sectorPoint(pose, radius + .5, 180 / count));
      return <g data-circle-turn-handle>
        <line x1={apex.x} y1={apex.y} x2={grip.x} y2={grip.y} stroke="var(--rose)" strokeDasharray="4 4" pointerEvents="none" />
        <g {...api.bind(`sector-turn.${selected}`, textFor(t("绕圆片顶点旋转", "Rotate about this sector's apex"), api.locale))} style={{ cursor: "grab" }}>
          <circle cx={grip.x} cy={grip.y} r={20} fill="transparent" /><circle cx={grip.x} cy={grip.y} r={8} fill="var(--rose)" stroke="var(--paper)" strokeWidth={2} />
        </g>
      </g>;
    })()}
    {state.flags.measures && <g data-circle-measurements pointerEvents="none">
      <text x={90} y={100} style={styles}>{textFor(t(`半径 ${fmt(radius)} u · 半周长 ${fmt(Math.PI * radius)} u · 各片面积和 ${fmt(Math.PI * radius * radius)} u²`, `Radius ${fmt(radius)} u · Half circumference ${fmt(Math.PI * radius)} u · Sum of sector areas ${fmt(Math.PI * radius * radius)} u²`), api.locale)}</text>
      <text x={90} y={129} style={styles}>{textFor(t(`${count} 片 · 每片圆心角 ${fmt(360 / count)}° · 每片面积 ${fmt(Math.PI * radius * radius / count)} u²`, `${count} sectors · Central angle ${fmt(360 / count)}° · Area per sector ${fmt(Math.PI * radius * radius / count)} u²`), api.locale)}</text>
    </g>}
  </g>;
}
const turn = (positive: boolean): PlanarAction => ({
  id: positive ? "circle-sector-positive-turn" : "circle-sector-negative-turn", icon: positive ? "positiveTurn" : "negativeTurn", label: positive ? t("当前圆片逆时针转 90°", "Turn current sector 90° anticlockwise") : t("当前圆片顺时针转 90°", "Turn current sector 90° clockwise"),
  run: (s) => setCircleSectorField(s, "angle", (sectorPose(s)?.angle ?? 0) + (positive ? 90 : -90)), disabled: missing, duration: 500, interpolate: interpolateCircleSectors,
});
const turns = [turn(true), turn(false)];
export const planeCircleDissectionScene: PlanarSceneDefinition = {
  id: CIRCLE_DISSECTION_SCENE, toolId: "plane-circle-area", title: t("真实圆片割补", "Dissect a circle into true sectors"),
  description: t("独立移动、转动和准确摆放圆片；逐次细分延续当前摆法，观察真实弧边逐渐变细。", "Move, turn and precisely place individual sectors. Refine the current arrangement and observe the true curved edges."),
  create: createCircleDissectionState, isExact: isValidCircleDissectionState,
  fields: [{ key: "radius", label: t("半径（u）", "Radius (u)"), min: .5, max: 3 }],
  operations: [{ id: "circle-sector-pose", icon: "move", label: t("圆片的准确位置与方向", "Precise sector position and direction"), fields: [
    { key: "active", label: t("圆片编号", "Sector number"), min: 1, max: 64, step: 1, read: (s) => s.params.active + 1 },
    { key: "x", label: t("圆心顶点 X（u）", "Apex X (u)"), min: -20, max: 20, read: (s) => sectorPose(s)?.x ?? 0, disabled: missing },
    { key: "y", label: t("圆心顶点 Y（u，向上为正）", "Apex Y (u, upwards positive)"), min: -12, max: 12, read: (s) => sectorPose(s)?.y ?? 0, disabled: missing },
    { key: "angle", label: t("第一条半径方向（°）", "First radius direction (°)"), min: -36000, max: 36000, read: (s) => sectorPose(s)?.angle ?? 0, disabled: missing },
  ], actions: turns }],
  actions: [
    { id: "circle-arrange-rows", icon: "paperLayout", label: t("圆片交错排成两行", "Interleave sectors in two rows"), run: (s) => arrangeCircleSectors(s, "rows"), duration: 1500, interpolate: interpolateCircleSectors },
    { id: "circle-arrange-circle", icon: "recenter", label: t("圆片拼回圆", "Reassemble the circle"), run: (s) => arrangeCircleSectors(s, "circle"), duration: 1500, interpolate: interpolateCircleSectors },
    { id: "circle-refine", icon: "cut", label: t("每片再平分", "Bisect every sector"), run: (s) => changeCircleCount(s, s.params.count * 2), disabled: (s) => s.params.count >= 64, duration: 1100, interpolate: interpolateCircleSectors },
    { id: "circle-coarsen", icon: "group", label: t("合并相邻两片", "Join adjacent sector pairs"), run: (s) => changeCircleCount(s, s.params.count / 2), disabled: (s) => s.params.count <= 8 || changeCircleCount(s, s.params.count / 2) === s },
    ...turns,
  ],
  toggles: [{ key: "measures", label: t("显示准确量", "Show measurements") }, { key: "original", label: t("显示原圆参照", "Show the original circle") }, { key: "names", label: t("显示圆片编号", "Show sector numbers") }, { key: "snap", label: t("靠近原位或两行落位时吸附", "Snap near the circle or row arrangement") }],
  draw: (state, api) => <CircleSectors state={state} api={api} />,
  setField: setCircleSectorField, tap: selectSector, drag: dragCircleSector, snap: snapCircleSector,
  selectionAfterChange: (before, after, selected) => before.params.active !== after.params.active || before.params.count !== after.params.count && selected !== null ? after.params.active >= 0 ? `sector.${after.params.active}` : null : selected,
  contextActions: (state, selected) => {
    const id = sectorTargetId(selected), pose = sectorPose(state, id); if (!pose) return null;
    return { bounds: pieceBounds(pose, state.params.radius, state.params.count), items: [{ kind: "operation", id: "circle-sector-pose" }, ...turns.map((action) => ({ kind: "action" as const, id: action.id }))] };
  },
  summary: (state, locale) => textFor(t(`${state.params.count} 片独立圆片`, `${state.params.count} independent sectors`), locale),
};
