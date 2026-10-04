import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { dragFoldProgress } from "../plane-motion/model";
import { buildPaperLayers, compose, distance, inverse, layerMatrix, paperCuts, type LayerCut } from "./geometry";
import { isValidPaperLayersState } from "./validation";
export * from "./geometry";
export { isValidPaperLayersState } from "./validation";

export function createPaperLayersState(): PlanarState {
  return { sceneId: "32-layers", params: { paperCount: 4, foldCount: 0, activeFold: -1, nextCutId: 1, activeCut: -1, activeVertex: 0 }, points: { "paper.0": { x: 260, y: 180 }, "paper.1": { x: 700, y: 180 }, "paper.2": { x: 700, y: 560 }, "paper.3": { x: 260, y: 560 } }, flags: { grid: false, measures: false, crease: true, edit: false, editCut: false }, marks: [], phase: 0 };
}
const checked = (before: PlanarState, next: PlanarState) => isValidPaperLayersState(next) ? next : before;
const angles = (s: PlanarState) => Array.from({ length: s.params.foldCount }, (_, i) => s.params[`foldAngle.${i}`]);
export const isFlat = (s: PlanarState) => angles(s).every((angle) => angle === 0 || angle === 180);
export function flatDepth(s: PlanarState): number { return isFlat(s) ? angles(s).filter((angle) => angle === 180).length : -1; }
export const canChangePaper = (s: PlanarState) => angles(s).every((angle) => angle === 0) && !paperCuts(s).length;
export const canAddFold = (s: PlanarState) => s.params.foldCount < 2 && flatDepth(s) === s.params.foldCount;
export const canCut = (s: PlanarState) => flatDepth(s) > 0 && paperCuts(s).length < 12 && s.params.nextCutId < 99999;
export function canEditFold(s: PlanarState, i = s.params.activeFold) {
  return i >= 0 && i < s.params.foldCount && s.params[`foldAngle.${i}`] === 0 && (i === 0 || s.params[`foldAngle.${i - 1}`] === 180) && !paperCuts(s).some((cut) => cut.depth > i);
}
export const activeCut = (s: PlanarState) => paperCuts(s).find((cut) => cut.id === s.params.activeCut);
function writeCut(s: PlanarState, cut: LayerCut): PlanarState {
  const points = { ...s.points }, params = { ...s.params, [`cutKind.${cut.id}`]: cut.kind === "circle" ? 0 : 1, [`cutVertices.${cut.id}`]: cut.points.length, [`cutRadius.${cut.id}`]: cut.radius, [`cutDepth.${cut.id}`]: cut.depth };
  cut.points.forEach((p, i) => { points[`cut.${cut.id}.${i}`] = p; }); return { ...s, params, points };
}
export function deleteCut(s: PlanarState, id = s.params.activeCut): PlanarState {
  if (!paperCuts(s).some((cut) => cut.id === id)) return s;
  const params = { ...s.params }, points = { ...s.points };
  for (const key of ["Kind", "Vertices", "Radius", "Depth"]) delete params[`cut${key}.${id}`];
  Object.keys(points).filter((key) => key.startsWith(`cut.${id}.`)).forEach((key) => { delete points[key]; });
  if (params.activeCut === id) { params.activeCut = -1; params.activeVertex = 0; }
  return { ...s, params, points };
}
export function clearCuts(s: PlanarState) { return paperCuts(s).reduce((next, cut) => deleteCut(next, cut.id), s); }
export function removeLastFold(s: PlanarState): PlanarState {
  const i = s.params.foldCount - 1;
  if (i < 0 || s.params[`foldAngle.${i}`] !== 0 || paperCuts(s).some((cut) => cut.depth > i)) return s;
  const params: Record<string, number> = { ...s.params, foldCount: i, activeFold: i - 1 }, points = { ...s.points };
  delete params[`foldAngle.${i}`]; delete params[`foldSide.${i}`]; delete points[`foldA.${i}`]; delete points[`foldB.${i}`];
  return { ...s, params, points };
}
export function constructPaperLayers(s: PlanarState, tool: string, input: readonly PlanarPoint[]): PlanarState | null {
  let next = s;
  if (tool === "paper-rectangle" || tool === "paper-polygon") {
    if (!canChangePaper(s)) return null;
    let poly = [...input];
    if (tool === "paper-rectangle") { if (input.length !== 2) return null; const [a, b] = input; poly = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]; }
    else if (poly.length > 3 && distance(poly[0], poly[poly.length - 1]) < 1e-7) poly.pop();
    next = { ...createPaperLayersState(), flags: s.flags, params: { ...createPaperLayersState().params, paperCount: poly.length, nextCutId: s.params.nextCutId }, points: Object.fromEntries(poly.map((p, i) => [`paper.${i}`, p])) };
  } else if (tool === "crease") {
    if (!canAddFold(s) || input.length !== 2) return null;
    const i = s.params.foldCount;
    next = { ...s, params: { ...s.params, foldCount: i + 1, activeFold: i, [`foldAngle.${i}`]: 0, [`foldSide.${i}`]: 1 }, points: { ...s.points, [`foldA.${i}`]: input[0], [`foldB.${i}`]: input[1] } };
  } else if (tool === "cut-circle" || tool === "cut-polygon") {
    if (!canCut(s) || tool === "cut-circle" && input.length !== 2) return null;
    const poly = [...input]; if (tool === "cut-polygon" && poly.length > 3 && distance(poly[0], poly[poly.length - 1]) < 1e-7) poly.pop();
    const id = s.params.nextCutId, cut: LayerCut = { id, kind: tool === "cut-circle" ? "circle" : "polygon", depth: flatDepth(s), points: tool === "cut-circle" ? [input[0]] : poly, radius: tool === "cut-circle" ? distance(input[0], input[1]) : 0 };
    next = writeCut({ ...s, params: { ...s.params, nextCutId: id + 1, activeCut: id, activeVertex: 0 }, flags: { ...s.flags, editCut: true } }, cut);
  } else return null;
  return isValidPaperLayersState(next) ? next : null;
}
export function setPaperLayersField(s: PlanarState, key: string, value: number): PlanarState {
  if (!Number.isFinite(value)) return s;
  if (["activeFold", "activeCut", "activeVertex"].includes(key)) return checked(s, { ...s, params: { ...s.params, [key]: value, ...(key === "activeCut" ? { activeVertex: 0 } : {}) } });
  const i = s.params.activeFold, cut = activeCut(s);
  if (key === "foldAngle") return i < 0 ? s : checked(s, { ...s, params: { ...s.params, [`foldAngle.${i}`]: Math.max(0, Math.min(180, value)) } });
  if (["cutX", "cutY", "cutRadius"].includes(key)) {
    if (!cut || !isFlat(s)) return s;
    const vertex = s.params.activeVertex, nextCut = { ...cut, points: cut.points.map((p, j) => j === vertex ? { ...p, ...(key === "cutX" ? { x: value } : key === "cutY" ? { y: value } : {}) } : p), radius: key === "cutRadius" && cut.kind === "circle" ? value : cut.radius };
    return checked(s, writeCut(s, nextCut));
  }
  if (!canEditFold(s)) return s;
  if (key === "foldSide") return checked(s, { ...s, params: { ...s.params, [`foldSide.${i}`]: value } });
  const a = s.points[`foldA.${i}`], b = s.points[`foldB.${i}`], center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, half = distance(a, b) / 2;
  let aNext = a, bNext = b;
  if (key === "axisX" || key === "axisY") { const dx = key === "axisX" ? value - center.x : 0, dy = key === "axisY" ? value - center.y : 0; aNext = { x: a.x + dx, y: a.y + dy }; bNext = { x: b.x + dx, y: b.y + dy }; }
  else if (key === "axisAngle") { const dx = half * Math.cos(value * Math.PI / 180), dy = half * Math.sin(value * Math.PI / 180); aNext = { x: center.x - dx, y: center.y - dy }; bNext = { x: center.x + dx, y: center.y + dy }; }
  else return s;
  return checked(s, { ...s, points: { ...s.points, [`foldA.${i}`]: aNext, [`foldB.${i}`]: bNext } });
}
export function foldStep(s: PlanarState, unfold = false): PlanarState {
  const available = angles(s).map((angle, i) => ({ angle, i })).filter(({ angle }) => unfold ? angle > 0 : angle < 180), target = unfold ? available.at(-1) : available[0];
  return target ? { ...s, params: { ...s.params, activeFold: target.i, [`foldAngle.${target.i}`]: unfold ? 0 : 180 } } : s;
}
export function cutEditingPose(s: PlanarState): PlanarState {
  const cut = activeCut(s); if (!cut) return s;
  const params: Record<string, number> = { ...s.params, activeFold: cut.depth - 1 }; for (let i = 0; i < s.params.foldCount; i++) params[`foldAngle.${i}`] = i < cut.depth ? 180 : 0;
  return { ...s, params, flags: { ...s.flags, editCut: true } };
}
export function interpolateFold(from: PlanarState, to: PlanarState, progress: number): PlanarState {
  if (progress >= 1) return to; if (progress <= 0) return from;
  const params: Record<string, number> = { ...to.params, layerFrame: 1 }; for (let i = 0; i < to.params.foldCount; i++) params[`foldAngle.${i}`] = from.params[`foldAngle.${i}`] + (to.params[`foldAngle.${i}`] - from.params[`foldAngle.${i}`]) * progress;
  return { ...to, params };
}
export function selectPaperLayerTarget(s: PlanarState, target: string): PlanarState {
  const match = /^cut-(?:body|vertex|radius)\.(\d+)\.(\d+)\.(\d+)$/.exec(target);
  return match ? checked(s, { ...s, params: { ...s.params, activeCut: Number(match[1]), activeVertex: target.startsWith("cut-vertex") ? Number(match[2]) : 0 } }) : s;
}
export function dragPaperLayers(s: PlanarState, target: string, _point: PlanarPoint, delta: PlanarPoint): PlanarState {
  const i = s.params.activeFold, layerTarget = /^layer\.(\d+)$/.exec(target);
  if (layerTarget && i >= 0 && (Number(layerTarget[1]) & (1 << i))) {
    const a = s.points[`foldA.${i}`], b = s.points[`foldB.${i}`], length = distance(a, b), axis = { point: a, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI }, side = s.params[`foldSide.${i}`];
    const phase = dragFoldProgress(s.params[`foldAngle.${i}`] / 180, delta, axis, { x: a.x + (b.y - a.y) / length * side, y: a.y - (b.x - a.x) / length * side });
    return setPaperLayersField(s, "foldAngle", phase * 180);
  }
  const cutTarget = /^cut-(body|vertex|radius)\.(\d+)\.(\d+)\.(\d+)$/.exec(target);
  if (cutTarget && isFlat(s)) {
    const [, part, id, vertex, bits] = cutTarget, cut = paperCuts(s).find((item) => item.id === Number(id)), layer = buildPaperLayers(s).layers.find((item) => item.bits === Number(bits));
    if (!cut || !layer) return s;
    const map = compose(layer.maps[cut.depth], inverse(layerMatrix(s, layer))), d = { x: map[0] * delta.x + map[2] * delta.y, y: map[1] * delta.x + map[3] * delta.y };
    const moved = { ...cut, points: cut.points.map((p, j) => part === "body" || part === "vertex" && j === Number(vertex) ? { x: p.x + d.x, y: p.y + d.y } : p), radius: part === "radius" ? Math.hypot(cut.radius + d.x, d.y) : cut.radius };
    return checked(s, writeCut(selectPaperLayerTarget(s, target), moved));
  }
  if (target.startsWith("fold") && canEditFold(s)) {
    const points = { ...s.points }; for (const key of [`foldA.${i}`, `foldB.${i}`]) if (target === `fold.${i}` || target === key) points[key] = { x: points[key].x + delta.x, y: points[key].y + delta.y };
    return checked(s, { ...s, points });
  }
  if (/^paper\.(\d+)$/.test(target) && s.flags.edit && canChangePaper(s) && s.points[target]) return checked(s, { ...s, points: { ...s.points, [target]: { x: s.points[target].x + delta.x, y: s.points[target].y + delta.y } } });
  return s;
}
