import { Vector3 } from "three";
import type { CubeNetGalleryFoldingBuild, SquareCell } from "@/features/spatial-math/domain";
import type { PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { cubeNetFaceBasis, transformCubeNetWorkbenchModel } from "./cube-net-workbench-model";
import { sampleCubeNetPlanarStep, transformCubeNetCell, type CubeNetPlanarPlan, type CubeNetPlanarTile } from "./cube-net-planar-motion";
import type { CubeNetTeachingAnchor } from "./cube-net-teaching-session";

export const CUBE_NET_PLANAR_STEP_MS = 750;
export function cubeNetPlanarTiles(build: CubeNetGalleryFoldingBuild): CubeNetPlanarTile[] {
  return build.sceneInput.layout.faces.map((face) => ({ id: face.faceId, quarterTurns: 0,
    x: Math.round(face.vertices.reduce((sum, vertex) => sum + vertex.position.x / 4, 0) - 0.5),
    y: Math.round(face.vertices.reduce((sum, vertex) => sum + vertex.position.y / 4, 0) - 0.5) }));
}

export function createCubeNetPlanarPresentation(from: CubeNetGalleryFoldingBuild, target: CubeNetGalleryFoldingBuild, flat: PolyhedronFoldRenderModel, plan: CubeNetPlanarPlan) {
  const original = cubeNetPlanarTiles(from);
  const reference = from.sceneInput.layout.faces[0];
  const worldReference = flat.faces.find((face) => face.faceId === reference.faceId)!;
  const plane = cubeNetFaceBasis(worldReference.vertices.map((vertex) => vertex.position))
    .multiply(cubeNetFaceBasis(reference.vertices.map((vertex) => ({ x: vertex.position.x, y: 0, z: vertex.position.y }))).invert());
  const inversePlane = plane.clone().invert();
  const world = (point: SquareCell) => {
    const placed = new Vector3(point.x, 0, point.y).applyMatrix4(plane);
    return { x: placed.x, y: placed.y, z: placed.z };
  };
  const targetTiles = cubeNetPlanarTiles(target);
  const key = (point: SquareCell) => `${point.x},${point.y}`;
  const finalCells = new Map(plan.target.map((tile) => [key(tile), tile]));
  let alignment: { transform: number; x: number; y: number } | null = null;
  for (let transform = 0; transform < 8 && !alignment; transform++) {
    const transformed = targetTiles.map((tile) => transformCubeNetCell(tile, transform));
    for (const origin of plan.target) {
      const x = origin.x - transformed[0].x, y = origin.y - transformed[0].y;
      if (transformed.every((tile) => finalCells.has(key({ x: tile.x + x, y: tile.y + y })))) { alignment = { transform, x, y }; break; }
    }
  }
  if (!alignment) throw new Error("CUBE_NET_PLANAR_ALIGNMENT_FAILED");
  const aligned = (point: SquareCell) => {
    const transformed = transformCubeNetCell(point, alignment.transform);
    return { x: transformed.x + alignment.x, y: transformed.y + alignment.y };
  };
  const labels = Object.fromEntries(targetTiles.map((tile) => {
    const source = finalCells.get(key(aligned(tile)))!;
    return [tile.id, flat.faces.find((face) => face.faceId === source.id)!.label];
  }));
  const support = target.sceneInput.layout.faces[0];
  const supportVertices = support.vertices.slice(0, 3).map((vertex) => {
    const point = aligned({ x: vertex.position.x - 0.5, y: vertex.position.y - 0.5 });
    return world({ x: point.x + 0.5, y: point.y + 0.5 });
  });
  const anchor: CubeNetTeachingAnchor = { faceId: support.faceId, vertices: [supportVertices[0], supportVertices[1], supportVertices[2]] };
  const durationMs = plan.steps.length * CUBE_NET_PLANAR_STEP_MS;
  const sample = (elapsedMs: number) => {
    const index = Math.min(plan.steps.length, Math.floor(Math.max(0, elapsedMs) / CUBE_NET_PLANAR_STEP_MS));
    const step = plan.steps[index];
    const tiles = step ? sampleCubeNetPlanarStep(step, (elapsedMs - index * CUBE_NET_PLANAR_STEP_MS) / CUBE_NET_PLANAR_STEP_MS) : plan.target;
    const transformed = transformCubeNetWorkbenchModel(flat, (point, faceId) => {
      const start = original.find((tile) => tile.id === faceId)!, current = tiles.find((tile) => tile.id === faceId)!;
      const local = new Vector3(point.x, point.y, point.z).applyMatrix4(inversePlane);
      const x = local.x - start.x - 0.5, y = local.z - start.y - 0.5;
      const angle = current.quarterTurns * Math.PI / 2;
      return world({ x: current.x + 0.5 + x * Math.cos(angle) - y * Math.sin(angle), y: current.y + 0.5 + x * Math.sin(angle) + y * Math.cos(angle) });
    });
    const model = { ...transformed, faces: transformed.faces.map((face) => ({ ...face, selected: step?.movingIds.includes(face.faceId) ?? false })) };
    return { model, step: Math.min(index + 1, plan.steps.length), total: plan.steps.length, movingCount: plan.movingIds.length };
  };
  return { durationMs, sample, anchor, labels };
}
