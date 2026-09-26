import type { PlanarState } from "../planar-kit/contract";

const sceneIds = new Set(["14", "15", "16", "17", "18", "27", "33", "37", "38", "39", "40", "41", "42", "44", "45", "46", "58", "59"]);
const triangleScenes = new Set(["18", "37", "38", "39", "41", "42"]);
const finite = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** 纯领域持久化边界；不导入渲染器或运行时 contract，供 tools schema 直接复用。 */
export function isValidPlaneAreaState(state: PlanarState): boolean {
  if (!sceneIds.has(state.sceneId) || !finite(state.phase, 0, 1)) return false;
  const { params: p, points, flags } = state;
  const limits: Record<string, [number, number]> = {
    base: triangleScenes.has(state.sceneId) ? [0.02, 20] : [1, 8],
    height: triangleScenes.has(state.sceneId) ? [0.01, 20] : [0.25, 6],
    slant: [-20, 20], top: [0.5, 5], fraction: [0.05, 0.95], secondary: [0.05, 0.95], count: [4, 64], layers: [1, 5], radius: [0.5, 3], cuts: [0, 10], angle: [-180, 180],
  };
  if (Object.entries(limits).some(([key, range]) => !finite(p[key], ...range))) return false;
  // 未剪完的切线属于宿主持有的 motion 表现帧；持久数学现场只接受完成的刀数。
  if (!Number.isInteger(p.count) || !Number.isInteger(p.layers) || !Number.isInteger(p.cuts)) return false;
  if (Object.keys(p).some((key) => !(key in limits) && (!key.startsWith("turn.") || !finite(p[key], -36_000, 36_000)))) return false;
  if (["grid", "measures", "constraint", "original", "areas", "strips", "complement", "alternate", "snap"].some((key) => typeof flags[key] !== "boolean")) return false;
  if (Object.values(points).some((q) => !finite(q.x, -20, 20) || !finite(q.y, -12, 12))) return false;
  if (Object.keys(points).some((key) => !["A", "B", "C", "D", "P"].includes(key) && !key.startsWith("piece."))) return false;
  if (Object.keys(points).length > 80 || Object.keys(p).length > 80) return false;
  if (triangleScenes.has(state.sceneId)) {
    const { A: a, B: b, C: c } = points;
    if (!a || !b || !c || Math.abs(cross(a, b, c)) < 0.3) return false;
    if (["39", "41"].includes(state.sceneId) && !points.P) return false;
  }
  if (state.sceneId === "14") {
    if (!finite(p.base, 2, 8) || !finite(p.height, 1, 6) || !finite(p.slant, 0.2, 12)) return false;
    const side = Math.hypot(p.slant, p.height);
    const base = flags.alternate ? side : p.base, shear = flags.alternate ? p.base * p.slant / side : p.slant;
    if (p.cuts > Math.ceil(shear / base - 1e-9)) return false;
  }
  if (state.sceneId === "27" && ![8, 16, 32, 64].includes(p.count)) return false;
  if (state.sceneId === "33" && !points.P) return false;
  if (state.sceneId === "40") {
    const vertices = [points.A, points.B, points.C, points.D];
    if (vertices.some((q) => !q)) return false;
    const turns = vertices.map((q, i) => cross(q, vertices[(i + 1) % 4], vertices[(i + 2) % 4]));
    if (!turns.every((n) => n > 0.1) && !turns.every((n) => n < -0.1)) return false;
    if (flags.constraint && (Math.abs(points.A.y - points.B.y) > 1e-8 || Math.abs(points.C.y - points.D.y) > 1e-8)) return false;
  }
  return true;
}
