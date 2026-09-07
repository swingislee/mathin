import { Box3, Raycaster, Vector2, Vector3, type Camera, type Ray } from "three";
import type { Axis, FaceDirection, VoxelCoordinate } from "@/features/spatial-math/domain";
import { cubeDisplayPosition, cubeIsVisible, type CubeStructureState } from "./cube-structures-contract";
import type { CubeCutHit, CubeCutLine } from "./cube-structures-cut-interaction";

const AXES = ["x", "y", "z"] as const;
const EPSILON = 1e-6;
export const CUBE_CUT_PICK_RADIUS = 8;
export interface CubeCutScreenPoint { readonly x: number; readonly y: number }
type Cell = { id: string; position: VoxelCoordinate; opacity: number; box: Box3 };
type Face = { cell: Cell; axis: Axis; sign: -1 | 1; direction: FaceDirection; key: string };
export interface CubeCutGeometry { readonly cells: readonly Cell[]; readonly faces: readonly Face[]; readonly lines: readonly CubeCutLine[] }
const key = (point: VoxelCoordinate) => AXES.map((axis) => Math.round(point[axis] * 1e6) / 1e6).join(":");
const vector = (point: VoxelCoordinate) => new Vector3(point.x, point.y, point.z);

/** 从展示几何建立可选对象；不读取绘制材质分组、实例索引或逻辑邻格。 */
export function buildCubeCutGeometry(state: CubeStructureState): CubeCutGeometry {
  const cells = state.cubes.filter((cube) => cubeIsVisible(state, cube)).map((cube): Cell => {
    const position = cubeDisplayPosition(cube);
    return { id: cube.id, position, opacity: cube.opacity ?? 1,
      box: new Box3(vector(position).addScalar(-0.5), vector(position).addScalar(0.5)) };
  });
  const faces: Face[] = [];
  const lines = new Map<string, CubeCutLine>();
  for (const cell of cells) {
    for (const along of AXES) {
      for (const sign of [-1, 1] as const) {
        if (cell.opacity > 0) faces.push({ cell, axis: along, sign, direction: `${along}${sign > 0 ? "+" : "-"}`, key: `${key(cell.position)}:${along}:${sign}` });
      }
      const [a, b] = AXES.filter((axis) => axis !== along);
      for (const first of [-0.5, 0.5]) for (const second of [-0.5, 0.5]) {
        const start = { ...cell.position, [along]: cell.position[along] - 0.5, [a]: cell.position[a] + first, [b]: cell.position[b] + second };
        const end = { ...start, [along]: start[along] + 1 };
        const id = `${along}:${key(start)}`;
        const existing = lines.get(id);
        lines.set(id, { key: id, along, start, end, cubeIds: [...(existing?.cubeIds ?? []), cell.id].sort() });
      }
    }
  }
  return { cells, faces, lines: [...lines.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

function coveredFace(geometry: CubeCutGeometry, face: Face, point: VoxelCoordinate): boolean {
  const tangents = AXES.filter((axis) => axis !== face.axis);
  const plane = face.cell.position[face.axis] + face.sign * 0.5;
  return geometry.cells.some((other) => other.id !== face.cell.id && other.opacity > 0
    && Math.abs(other.position[face.axis] - face.sign * 0.5 - plane) < EPSILON
    && tangents.every((axis) => Math.abs(other.position[axis] - face.cell.position[axis]) < 1 - EPSILON
      && Math.abs(point[axis] - other.position[axis]) <= 0.5 + EPSILON));
}

/** 先排内部共用面，再处理最近外露面；近等深按朝向及几何键稳定消歧。 */
export function pickCubeCutFace(geometry: CubeCutGeometry, ray: Ray): Extract<CubeCutHit, { kind: "face" }> | null {
  const candidates: { face: Face; point: Vector3; distance: number; facing: number }[] = [];
  for (const face of geometry.faces) {
    const facing = -ray.direction[face.axis] * face.sign;
    if (facing <= EPSILON) continue;
    const distance = (face.cell.position[face.axis] + face.sign * 0.5 - ray.origin[face.axis]) / ray.direction[face.axis];
    if (distance < 0) continue;
    const point = ray.at(distance, new Vector3());
    if (AXES.some((axis) => axis !== face.axis && Math.abs(point[axis] - face.cell.position[axis]) > 0.5 + EPSILON)) continue;
    if (!coveredFace(geometry, face, point)) candidates.push({ face, point, distance, facing });
  }
  if (!candidates.length) return null;
  const nearest = Math.min(...candidates.map((candidate) => candidate.distance));
  const hit = candidates.filter((candidate) => candidate.distance <= nearest + EPSILON)
    .sort((a, b) => b.facing - a.facing || a.face.key.localeCompare(b.face.key))[0];
  return { kind: "face", cubeId: hit.face.cell.id, face: { cell: hit.face.cell.position, direction: hit.face.direction }, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } };
}

/** 对鼠标在棱边上的投影点做遮挡检测，避免邻近线或实体背后的重复线穿透命中。 */
function visibleLinePoint(geometry: CubeCutGeometry, ray: Ray, point: Vector3): boolean {
  const distance = point.clone().sub(ray.origin).dot(ray.direction);
  const entry = new Vector3();
  return !geometry.cells.some((cell) => cell.opacity > 0 && ray.intersectBox(cell.box, entry)
    && entry.clone().sub(ray.origin).dot(ray.direction) < distance - EPSILON);
}

export function pickCubeCut(geometry: CubeCutGeometry, input: "auto" | "edge" | "face", pointer: CubeCutScreenPoint, camera: Camera,
  size: { readonly width: number; readonly height: number }, previous: CubeCutHit | null = null, radius = CUBE_CUT_PICK_RADIUS): CubeCutHit | null {
  if (size.width <= 0 || size.height <= 0) return null;
  const raycaster = new Raycaster();
  const rayAt = (point: CubeCutScreenPoint) => {
    raycaster.setFromCamera(new Vector2(point.x / size.width * 2 - 1, 1 - point.y / size.height * 2), camera);
    return raycaster.ray;
  };
  if (input === "face") return pickCubeCutFace(geometry, rayAt(pointer));
  const project = (point: VoxelCoordinate) => {
    const ndc = vector(point).project(camera);
    return { x: (ndc.x + 1) * size.width / 2, y: (1 - ndc.y) * size.height / 2, z: ndc.z };
  };
  const candidates: { line: CubeCutLine; distance: number; depth: number }[] = [];
  for (const line of geometry.lines) {
    const a = project(line.start); const b = project(line.end);
    if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue;
    const dx = b.x - a.x; const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < 4) continue;
    const t = Math.max(0, Math.min(1, ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) / lengthSq));
    const closest = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(pointer.x - closest.x, pointer.y - closest.y);
    if (distance > radius) continue;
    const point = vector(line.start).lerp(vector(line.end), t);
    const ray = rayAt(closest);
    if (!visibleLinePoint(geometry, ray, point)) continue;
    const depth = point.clone().sub(ray.origin).dot(ray.direction);
    // 仅露出一个端点的内部棱线不算可见线段；检查端点向内的邻域。
    if (t < 0.001 || t > 0.999) {
      const inside = vector(line.start).lerp(vector(line.end), Math.max(0.001, Math.min(0.999, t)));
      if (!visibleLinePoint(geometry, rayAt(project(inside)), inside)) continue;
    }
    candidates.push({ line, distance, depth });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.depth - b.depth || a.line.key.localeCompare(b.line.key));
  if (!candidates.length) return input === "auto" ? pickCubeCutFace(geometry, rayAt(pointer)) : null;
  // 交点附近保留当前线；2 CSS 像素的滞回量不随缩放和 DPR 改变。
  const retained = previous?.kind === "edge" ? candidates.find((candidate) => candidate.line.key === previous.line.key
    && candidate.distance <= candidates[0].distance + 2 && candidate.depth <= candidates[0].depth + EPSILON) : undefined;
  return { kind: "edge", line: (retained ?? candidates[0]).line };
}

export function cubeCutHitKey(hit: CubeCutHit | null): string {
  return !hit ? "" : hit.kind === "edge" ? hit.line.key : `${hit.cubeId}:${hit.face.direction}`;
}
