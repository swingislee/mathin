import { projectUnitCubePositions } from "@/features/spatial-math/domain/voxel-kernel";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import { cubeDisplayPosition, cubeIsVisible, type CubeStructureState } from "../spatial-lab/cube-structures-contract";
import type { ProjectionView } from "./projection-contract";

export type ProjectionPoint = readonly [number, number, number];
/** 投影坐标与内核一致：正面 x/y，右面 -z/y，上面 x/-z。 */
export function projectionPoint(view: ProjectionView, u: number, v: number, plane: number): ProjectionPoint {
  if (view === "front") return [u, v, plane];
  if (view === "right") return [plane, v, -u];
  return [u, plane, -v];
}
export function projectionGeometry(state: CubeStructureState, view: ProjectionView) {
  const positions = state.cubes.filter((cube) => cubeIsVisible(state, cube)).map(cubeDisplayPosition);
  const projection = projectUnitCubePositions(positions, view);
  const depth: keyof VoxelCoordinate = view === "front" ? "z" : view === "right" ? "x" : "y";
  const plane = Math.min(-0.8, ...positions.map((p) => p[depth] - 0.8));
  const bounds = projection.bounds;
  const corners = (u: number, v: number, half = 0.5) => [
    projectionPoint(view, u - half, v - half, plane), projectionPoint(view, u + half, v - half, plane),
    projectionPoint(view, u + half, v + half, plane), projectionPoint(view, u - half, v + half, plane),
  ];
  const cells = projection.cells.map((cell) => ({ ...cell, corners: corners(cell.u, cell.v),
    ray: [[cell.frontmostCell.x, cell.frontmostCell.y, cell.frontmostCell.z] as ProjectionPoint, projectionPoint(view, cell.u, cell.v, plane)],
  }));
  return { view, plane, cells, bounds, frame: bounds ? [
    projectionPoint(view, bounds.minU - 0.65, bounds.minV - 0.65, plane),
    projectionPoint(view, bounds.maxU + 0.65, bounds.minV - 0.65, plane),
    projectionPoint(view, bounds.maxU + 0.65, bounds.maxV + 0.65, plane),
    projectionPoint(view, bounds.minU - 0.65, bounds.maxV + 0.65, plane),
  ] : [] };
}
