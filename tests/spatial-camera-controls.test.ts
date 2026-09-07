import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  interpolateSpatialCameraPose,
  snapSpatialCameraPoseToPrincipalAxis,
  spatialCameraTransitionProgress,
  type SpatialCameraPose,
} from "@/features/spatial-math/renderer-r3f/spatial-camera-motion";

const origin = { x: 0, y: 0, z: 0 };
const views: SpatialCameraPose[] = [
  { target: origin, position: { x: 0, y: 0, z: 10 }, up: { x: 0, y: 1, z: 0 } },
  { target: origin, position: { x: 10, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  { target: origin, position: { x: 0, y: 10, z: 0 }, up: { x: 0, y: 0, z: -1 } },
  { target: origin, position: { x: 0, y: -10, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  { target: origin, position: { x: 0, y: 0, z: -10 }, up: { x: 0, y: 1, z: 0 } },
];
function v(value: { x: number; y: number; z: number }) { return new Vector3(value.x, value.y, value.z); }

describe("统一空间相机运动", () => {
  it("所有正面、侧面、顶面、底面和背面切换都保持观察距离及正交屏幕方向", () => {
    for (const from of views) for (const to of views) {
      expect(interpolateSpatialCameraPose(from, to, 0)).toEqual(from);
      expect(interpolateSpatialCameraPose(from, to, 1)).toEqual(to);
      for (let step = 1; step < 20; step++) {
        const pose = interpolateSpatialCameraPose(from, to, step / 20);
        const offset = v(pose.position).sub(v(pose.target));
        expect(offset.length()).toBeCloseTo(10, 10);
        expect(v(pose.up).length()).toBeCloseTo(1, 10);
        expect(offset.normalize().dot(v(pose.up))).toBeCloseTo(0, 10);
        expect(v(pose.up).cross(offset).normalize().y).toBeCloseTo(0, 10);
        expect(pose.up.y).toBeGreaterThanOrEqual(-1e-10);
      }
    }
  });

  it("倾斜、平移后的相机连续切换，从当前中间姿态接着走而不回到旧书签", () => {
    const from = { ...views[0], target: { x: 3, y: 2, z: 1 }, position: { x: 3, y: 2, z: 11 }, up: { x: 1, y: 0, z: 0 } };
    const current = interpolateSpatialCameraPose(from, views[2], 0.35);
    expect(interpolateSpatialCameraPose(current, views[1], 0)).toEqual(current);
    const next = interpolateSpatialCameraPose(current, views[1], 0.001);
    expect(v(next.position).distanceTo(v(current.position))).toBeLessThan(0.04);
    expect(spatialCameraTransitionProgress(360, 720)).toBe(0.5);
    expect(spatialCameraTransitionProgress(0, 0)).toBe(1);
  });

  it("顶面吸附使用精确方向，范围外不吸附", () => {
    expect(snapSpatialCameraPoseToPrincipalAxis({ ...views[2], position: { x: 0.1, y: 10, z: 0 } })?.up).toEqual(views[2].up);
    expect(snapSpatialCameraPoseToPrincipalAxis({ ...views[0], position: { x: 5, y: 5, z: 5 } })).toBeNull();
    expect(snapSpatialCameraPoseToPrincipalAxis({ ...views[0], up: { x: 0.03, y: -1, z: 0 } })?.up).toEqual({ x: 0, y: 1, z: 0 });
    expect(snapSpatialCameraPoseToPrincipalAxis({ ...views[0], up: { x: 1, y: 1, z: 0 } })?.up).toEqual(views[0].up);
  });

  it("两个 renderer 使用同一个相机层，所有工作台使用同一吸附偏好", () => {
    for (const file of ["VoxelCanvas.tsx", "PolyhedronFoldCanvas.tsx"]) {
      const source = readFileSync(`src/features/spatial-math/renderer-r3f/${file}`, "utf8");
      expect(source).toContain("<SpatialCameraRig");
      expect(source).not.toContain("OrbitControls");
      expect(source).toContain("axisSnapEnabled={axisSnapEnabled}");
      expect(source).toContain('data-camera-controls="orbit"');
    }
    for (const file of ["renderer-r3f/VoxelTeachingStage.tsx", "renderer-r3f/PolyhedronFoldTeachingStage.tsx", "editor/VoxelTemplateEditorStage.tsx"]) {
      const source = readFileSync(`src/features/spatial-math/${file}`, "utf8");
      expect(source).toContain("useSpatialAxisSnap()");
      expect(source).toContain("<SpatialAxisSnapButton");
    }
    const preview = readFileSync("src/features/spatial-math/editor/VoxelLessonEditorStage.tsx", "utf8");
    expect(preview).toContain("page={displayedPreview.page} state={displayedPreview.runtime}");
    expect(preview).not.toContain('previewStatus === "ready" && readyLesson && readyPreview ?');
  });
});
