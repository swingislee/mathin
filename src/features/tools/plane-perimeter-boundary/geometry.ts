import type { PlanarPoint as Point } from "../planar-kit/contract";

export interface BoundaryMaterial { id: number; points: Point[] }
export interface BoundarySource { id: number; edge: number }
export interface BoundarySegment { a: Point; b: Point; sources: BoundarySource[] }
export interface BoundaryLoop { points: Point[]; segments: BoundarySegment[]; length: number; signedArea: number; component: number }
export interface UnionBoundary {
  valid: boolean; boundary: BoundarySegment[]; seams: BoundarySegment[]; covered: BoundarySegment[];
  outer: BoundaryLoop[]; holes: BoundaryLoop[]; components: number;
  perimeter: number; outerPerimeter: number; holePerimeter: number; originalPerimeter: number; area: number;
}
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (p: Point, amount: number): Point => ({ x: p.x * amount, y: p.y * amount });
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const length = (p: Point) => Math.hypot(p.x, p.y);
export const distance = (a: Point, b: Point) => length(subtract(a, b));
const midpoint = (a: Point, b: Point) => scale(add(a, b), 0.5);
export const signedArea = (poly: readonly Point[]) => poly.slice(1, -1).reduce((sum, p, i) => sum + cross(subtract(p, poly[0]), subtract(poly[i + 2], poly[0])), 0) / 2;
const empty = (valid = true): UnionBoundary => ({ valid, boundary: [], seams: [], covered: [], outer: [], holes: [], components: 0, perimeter: 0, outerPerimeter: 0, holePerimeter: 0, originalPerimeter: 0, area: 0 });
const bounds = (points: readonly Point[]) => ({ minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) });
type Box = ReturnType<typeof bounds>;
const apart = (a: Box, b: Box, eps: number) => a.maxX < b.minX - eps || a.minX > b.maxX + eps || a.maxY < b.minY - eps || a.minY > b.maxY + eps;

/** 容差只用于当前坐标的浮点舍入，不按屏幕像素、格点或固定面积吞掉窄缝。 */
function pointRelation(p: Point, poly: readonly Point[], eps: number): "inside" | "outside" | "boundary" {
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], d = subtract(b, a), q = subtract(p, a);
    if (Math.abs(cross(d, q)) <= eps * length(d) && dot(q, d) >= -eps * length(d) && dot(subtract(p, b), d) <= eps * length(d)) return "boundary";
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + (b.x - a.x) * (p.y - a.y) / (b.y - a.y)) inside = !inside;
  }
  return inside ? "inside" : "outside";
}
interface Edge { owner: number; index: number; a: Point; b: Point; aNode: number; bNode: number; box: Box; cuts: { t: number; node: number }[] }
interface Atom { a: number; b: number; refs: { edge: Edge; forward: boolean }[] }
interface Directed { a: number; b: number; segment: BoundarySegment; owner: number }

/** 真实直边 arrangement：先统一交点及共边端点，再按每个开放边段两侧的纸片覆盖决定边界。 */
export function polygonUnionBoundary(materials: readonly BoundaryMaterial[]): UnionBoundary {
  if (!materials.length) return empty();
  if (materials.length > 16 || materials.reduce((sum, m) => sum + m.points.length, 0) > 192 || materials.some((m) => m.points.length < 3 || m.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || signedArea(m.points) === 0)) return empty(false);
  const extent = Math.max(1, ...materials.flatMap((m) => m.points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]))), eps = 8 * Number.EPSILON * extent;
  const nodes: Point[] = [], buckets = new Map<string, number[]>();
  const nodeAt = (p: Point) => {
    const x = Math.floor(p.x / eps), y = Math.floor(p.y / eps);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const id of buckets.get(`${x + dx}:${y + dy}`) ?? []) if (distance(nodes[id], p) <= eps) return id;
    const id = nodes.length, key = `${x}:${y}`; nodes.push({ ...p }); buckets.set(key, [...(buckets.get(key) ?? []), id]); return id;
  };
  const parents = materials.map((_, i) => i), root = (i: number): number => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const connect = (a: number, b: number) => { const x = root(a), y = root(b); if (x !== y) parents[Math.max(x, y)] = Math.min(x, y); };
  const edges: Edge[] = materials.flatMap((material, owner) => material.points.map((a, index) => {
    const b = material.points[(index + 1) % material.points.length], aNode = nodeAt(a), bNode = nodeAt(b);
    return { owner, index, a, b, aNode, bNode, box: bounds([a, b]), cuts: [{ t: 0, node: aNode }, { t: 1, node: bNode }] };
  }));
  if (edges.some((edge) => edge.aNode === edge.bNode)) return empty(false);
  const addCut = (edge: Edge, t: number, node: number) => edge.cuts.push({ t: Math.max(0, Math.min(1, t)), node });
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const first = edges[i], second = edges[j]; if (first.owner === second.owner || apart(first.box, second.box, eps)) continue;
    const r = subtract(first.b, first.a), s = subtract(second.b, second.a), w = subtract(second.a, first.a), rLength = length(r), sLength = length(s), denominator = cross(r, s);
    const parallelError = 8 * Number.EPSILON * (Math.abs(r.x * s.y) + Math.abs(r.y * s.x));
    // 坐标旋转后的相减误差可大于乘法舍入；先认同线，避免除以几乎平行方向的舍入残差。
    if (Math.abs(cross(r, w)) <= eps * rLength && Math.abs(cross(r, subtract(second.b, first.a))) <= eps * rLength) {
      for (const [own, other] of [[first, second], [second, first]]) {
        const d = subtract(own.b, own.a), l2 = dot(d, d), tolerance = eps / Math.sqrt(l2);
        for (const id of [other.aNode, other.bNode]) { const t = dot(subtract(nodes[id], own.a), d) / l2; if (t >= -tolerance && t <= 1 + tolerance) { addCut(own, t, id); connect(own.owner, other.owner); } }
      }
      continue;
    }
    if (Math.abs(denominator) <= parallelError) continue;
    const t = cross(w, s) / denominator, u = cross(w, r) / denominator, tError = eps / rLength, uError = eps / sLength;
    if (t < -tError || t > 1 + tError || u < -uError || u > 1 + uError) continue;
    const at = t <= tError ? first.a : t >= 1 - tError ? first.b : u <= uError ? second.a : u >= 1 - uError ? second.b : midpoint(add(first.a, scale(r, t)), add(second.a, scale(s, u)));
    const node = nodeAt(at); addCut(first, t, node); addCut(second, u, node); connect(first.owner, second.owner);
  }
  const boxes = materials.map((m) => bounds(m.points)), winding = materials.map((m) => Math.sign(signedArea(m.points)));
  for (let i = 0; i < materials.length; i++) for (let j = i + 1; j < materials.length; j++) if (!apart(boxes[i], boxes[j], eps)
    && (pointRelation(materials[i].points[0], materials[j].points, eps) !== "outside" || pointRelation(materials[j].points[0], materials[i].points, eps) !== "outside")) connect(i, j);
  const atoms = new Map<string, Atom>();
  for (const edge of edges) {
    const cuts = edge.cuts.sort((a, b) => a.t - b.t).filter((cut, i, all) => !i || cut.node !== all[i - 1].node);
    for (let j = 0; j + 1 < cuts.length; j++) {
      const start = cuts[j].node, end = cuts[j + 1].node; if (start === end || distance(nodes[start], nodes[end]) <= eps) continue;
      const a = Math.min(start, end), b = Math.max(start, end), key = `${a}:${b}`, atom = atoms.get(key) ?? { a, b, refs: [] };
      atom.refs.push({ edge, forward: start === a }); atoms.set(key, atom);
    }
  }
  const result = empty(), directed: Directed[] = [];
  result.originalPerimeter = edges.reduce((sum, edge) => sum + distance(edge.a, edge.b), 0);
  result.components = new Set(materials.map((_, i) => root(i))).size;
  const componentIds = [...new Set(materials.map((_, i) => root(i)))].sort((a, b) => a - b);
  for (const atom of atoms.values()) {
    const a = nodes[atom.a], b = nodes[atom.b], at = midpoint(a, b), direction = subtract(b, a), owners = new Set(atom.refs.map((ref) => ref.edge.owner));
    let left = false, right = false, seamLeft = false, seamRight = false;
    for (const ref of atom.refs) { const filledLeft = winding[ref.edge.owner] * (ref.forward ? 1 : -1) > 0; left ||= filledLeft; right ||= !filledLeft; seamLeft ||= filledLeft; seamRight ||= !filledLeft; }
    for (let owner = 0; owner < materials.length && !(left && right); owner++) {
      if (owners.has(owner) || apart(bounds([at]), boxes[owner], eps)) continue;
      const relation = pointRelation(at, materials[owner].points, eps);
      if (relation === "inside") { left = true; right = true; }
      else if (relation === "boundary") {
        // 共线端点只相差浮点舍入时，用真实边的内侧恢复分类，不采样法线两侧的像素点。
        for (const edge of edges.filter((item) => item.owner === owner)) {
          const d = subtract(edge.b, edge.a), q = subtract(at, edge.a);
          if (Math.abs(cross(d, q)) > eps * length(d) || dot(q, d) < -eps * length(d) || dot(subtract(at, edge.b), d) > eps * length(d)) continue;
          const filledLeft = winding[owner] * Math.sign(dot(d, direction)) > 0; left ||= filledLeft; right ||= !filledLeft;
        }
      }
    }
    const sources = atom.refs.map((ref) => ({ id: materials[ref.edge.owner].id, edge: ref.edge.index }));
    const segment = { a, b, sources };
    if (left !== right) {
      const oriented = left ? segment : { ...segment, a: b, b: a }; result.boundary.push(oriented);
      directed.push({ a: left ? atom.a : atom.b, b: left ? atom.b : atom.a, segment: oriented, owner: atom.refs[0].edge.owner });
    } else if (left && right) {
      if (owners.size > 1 && seamLeft && seamRight) result.seams.push(segment); else result.covered.push(segment);
    }
  }
  const outgoing = new Map<number, number[]>(); directed.forEach((edge, index) => outgoing.set(edge.a, [...(outgoing.get(edge.a) ?? []), index]));
  const tau = 2 * Math.PI, visited = new Set<number>();
  const next = directed.map((edge) => {
    const reverse = Math.atan2(nodes[edge.a].y - nodes[edge.b].y, nodes[edge.a].x - nodes[edge.b].x);
    return [...(outgoing.get(edge.b) ?? [])].sort((a, b) => {
      const clockwise = (id: number) => { const item = directed[id]; return (reverse - Math.atan2(nodes[item.b].y - nodes[item.a].y, nodes[item.b].x - nodes[item.a].x) + tau) % tau; };
      return clockwise(a) - clockwise(b);
    })[0];
  });
  for (let start = 0; start < directed.length; start++) {
    if (visited.has(start)) continue;
    const sequence: Directed[] = []; let current: number | undefined = start;
    while (current !== undefined && !visited.has(current)) { visited.add(current); sequence.push(directed[current]); current = next[current]; }
    if (current !== start || sequence.length < 3) { result.valid = false; continue; }
    const points = sequence.map((edge) => nodes[edge.a]), area = signedArea(points), segments = sequence.map((edge) => edge.segment);
    const loop = { points, segments, signedArea: area, length: segments.reduce((sum, edge) => sum + distance(edge.a, edge.b), 0), component: componentIds.indexOf(root(sequence[0].owner)) };
    if (area > 0) result.outer.push(loop); else if (area < 0) result.holes.push(loop); else result.valid = false;
  }
  result.outerPerimeter = result.outer.reduce((sum, loop) => sum + loop.length, 0); result.holePerimeter = result.holes.reduce((sum, loop) => sum + loop.length, 0);
  result.perimeter = result.boundary.reduce((sum, edge) => sum + distance(edge.a, edge.b), 0); result.area = [...result.outer, ...result.holes].reduce((sum, loop) => sum + loop.signedArea, 0);
  return result;
}
