import type { VoxelRenderModel } from "@/features/spatial-math/renderer-r3f/voxel-render-model";
import type { CubeFrame, CubeView } from "./cube-structures-contract";

export const CUBE_WORKBENCH_VIEWS: readonly CubeView[] = ["angle", "front", "left", "right", "top"];

/** 结构体与展开图共用已验收的正交视角、Y 向上与取景距离。 */
export function cubeWorkbenchCamera(frame: CubeFrame, view: CubeView, prefix = "cube-structures"): VoxelRenderModel["camera"] {
  const direction = { angle: { x: 1, y: 0.8, z: 1 }, front: { x: 0, y: 0, z: 1 }, left: { x: -1, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 }, top: { x: 0, y: 1, z: 0 } }[view];
  const center = frame.center;
  const distance = frame.radius * 4;
  return {
    id: `${prefix}.${view}`, projection: "orthographic", target: center,
    position: { x: center.x + direction.x * distance, y: center.y + direction.y * distance, z: center.z + direction.z * distance },
    up: view === "top" ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 }, zoom: 1, fovDegrees: 38,
  };
}
