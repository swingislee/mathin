import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import {
  interpolateSpatialCameraPose,
  snapSpatialCameraPoseToPrincipalAxis,
  spatialCameraTransitionProgress,
  type SpatialCameraPose,
} from "@/features/spatial-math/renderer-r3f/spatial-camera-motion";
import { createSpatialArcballControls } from "@/features/spatial-math/renderer-r3f/spatial-arcball-controls";

const origin = { x: 0, y: 0, z: 0 };
const views: SpatialCameraPose[] = [
  { target: origin, position: { x: 0, y: 0, z: 10 }, up: { x: 0, y: 1, z: 0 } },
  { target: origin, position: { x: 10, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  { target: origin, position: { x: 0, y: 10, z: 0 }, up: { x: 0, y: 0, z: -1 } },
  { target: origin, position: { x: 0, y: -10, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  { target: origin, position: { x: 0, y: 0, z: -10 }, up: { x: 0, y: 1, z: 0 } },
];
function v(value: { x: number; y: number; z: number }) { return new Vector3(value.x, value.y, value.z); }

// 通过真实 controls 的 DOM 事件验证，不依赖 WebGL、截图或模拟另一套旋转算法。
class ControlSurface extends EventTarget {
  style = { touchAction: "" };
  clientWidth = 800;
  clientHeight = 600;
  ownerDocument = Object.assign(new EventTarget(), { documentElement: { clientLeft: 0, clientTop: 0 } });
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
}
function pointer(target: EventTarget, type: string, x: number, y: number, button = 0, pointerType = "mouse") {
  target.dispatchEvent(Object.assign(new Event(type), { pageX: x, pageY: y, clientX: x, clientY: y, button, pointerType, pointerId: 1 }));
}
function setup(projection: "orthographic" | "perspective", pose = views[0]) {
  vi.stubGlobal("window", Object.assign(new EventTarget(), { pageXOffset: 0, pageYOffset: 0, devicePixelRatio: 1 }));
  const surface = new ControlSurface();
  const camera = projection === "orthographic" ? new OrthographicCamera(-5, 5, 5, -5) : new PerspectiveCamera(38, 4 / 3);
  camera.position.copy(v(pose.position));
  camera.up.copy(v(pose.up));
  camera.lookAt(v(pose.target));
  const controls = createSpatialArcballControls(camera, surface as unknown as HTMLElement);
  const drag = (dx: number, dy: number, button = 0, pointerType = "mouse") => {
    pointer(surface, "pointerdown", 400, 300, button, pointerType);
    pointer(window, "pointermove", 400 + dx, 300 + dy, button, pointerType);
    controls.update();
    pointer(window, "pointerup", 400 + dx, 300 + dy, button, pointerType);
    controls.update();
  };
  const dragPath = (points: readonly (readonly [number, number])[], pointerType = "mouse") => {
    pointer(surface, "pointerdown", 400, 300, 0, pointerType);
    for (const [x, y] of points) pointer(window, "pointermove", x, y, 0, pointerType);
    const [x, y] = points.at(-1) ?? [400, 300];
    pointer(window, "pointerup", x, y, 0, pointerType);
    controls.update();
  };
  return { surface, camera, controls, drag, dragPath };
}

afterEach(() => vi.unstubAllGlobals());

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
    expect(snapSpatialCameraPoseToPrincipalAxis({ ...views[0], up: { x: 0.03, y: -1, z: 0 } })?.up).toEqual({ x: 0, y: -1, z: 0 });
    expect(snapSpatialCameraPoseToPrincipalAxis({ ...views[0], up: { x: 1, y: 1, z: 0 } })).toBeNull();
  });

  for (const projection of ["orthographic", "perspective"] as const) {
    for (const pointerType of ["mouse", "touch"] as const) {
      it(`${projection} / ${pointerType}：一次拖动绕圈回到起点，精确恢复按下时姿态`, () => {
        const { camera, controls, dragPath } = setup(projection, views[2]);
        const original = camera.quaternion.clone();
        dragPath([[520, 300], [520, 420], [400, 420], [400, 300]], pointerType);
        expect(original.angleTo(camera.quaternion)).toBeLessThan(1e-7);
        controls.dispose();
      });

      it(`${projection} / ${pointerType}：相同拖动终点不受事件采样频率影响`, () => {
        const coarse = setup(projection);
        coarse.dragPath([[520, 360]], pointerType);
        const expected = coarse.camera.quaternion.clone();
        coarse.controls.dispose();
        const fine = setup(projection);
        fine.dragPath(Array.from({ length: 12 }, (_, index) => [400 + (index + 1) * 10, 300 + (index + 1) * 5] as const), pointerType);
        expect(expected.angleTo(fine.camera.quaternion)).toBeLessThan(1e-7);
        fine.controls.dispose();
      });

      it(`${projection} / ${pointerType}：顶面水平拖动与正面具有相同角速度和屏幕方向`, () => {
        const angles: number[] = [];
        for (const pose of [views[0], views[2], views[3]]) {
          const { camera, controls, drag } = setup(projection, pose);
          const orientation = camera.quaternion.clone();
          drag(80, 0, 0, pointerType);
          angles.push(orientation.angleTo(camera.quaternion));
          const relativeDirection = camera.position.clone().normalize().applyQuaternion(orientation.clone().invert());
          expect(relativeDirection.x).toBeLessThan(0);
          expect(Math.abs(relativeDirection.y)).toBeLessThan(1e-8);
          expect(camera.position.length()).toBeCloseTo(10, 9);
          const stopped = camera.quaternion.clone();
          for (let frame = 0; frame < 10; frame++) controls.update();
          expect(stopped.angleTo(camera.quaternion)).toBeLessThan(1e-7);
          controls.dispose();
        }
        expect(angles[1]).toBeCloseTo(angles[0], 9);
        expect(angles[2]).toBeCloseTo(angles[0], 9);
      });
    }

    it(`${projection}：连续越过顶点，松手保持视角，反向拖动能返回`, () => {
      const { camera, controls, drag } = setup(projection);
      const original = camera.quaternion.clone();
      let previous = original.clone();
      let firstAngle = 0;
      for (let i = 0; i < 16; i++) {
        drag(0, 40);
        const angle = previous.angleTo(camera.quaternion);
        if (i === 0) firstAngle = angle;
        expect(angle).toBeCloseTo(firstAngle, 8);
        expect(angle).toBeGreaterThan(0.1);
        expect(angle).toBeLessThan(0.3);
        expect(camera.position.clone().normalize().dot(camera.up)).toBeCloseTo(0, 8);
        previous = camera.quaternion.clone();
      }
      expect(camera.position.z).toBeLessThan(0);
      for (let i = 0; i < 16; i++) drag(0, -40);
      expect(original.angleTo(camera.quaternion)).toBeLessThan(1e-7);
      controls.dispose();
    });

    it(`${projection}：缩放双向可用，平移保持观察方向`, () => {
      const { surface, camera, controls, drag } = setup(projection);
      const size = () => camera instanceof OrthographicCamera ? camera.zoom : 1 / camera.position.distanceTo(controls.rotationTarget);
      const originalSize = size();
      surface.dispatchEvent(Object.assign(new Event("wheel"), { deltaMode: 0, deltaY: -100 }));
      controls.update();
      expect(size()).toBeGreaterThan(originalSize);
      const enlarged = size();
      surface.dispatchEvent(Object.assign(new Event("wheel"), { deltaMode: 0, deltaY: 100 }));
      controls.update();
      expect(size()).toBeLessThan(enlarged);
      const before = camera.quaternion.clone();
      drag(80, 30, 2);
      expect(controls.rotationTarget.length()).toBeGreaterThan(0);
      expect(before.angleTo(camera.quaternion)).toBeLessThan(1e-7);
      const target = controls.rotationTarget.clone();
      drag(50, 0);
      expect(controls.rotationTarget.distanceTo(target)).toBeLessThan(1e-8);
      controls.dispose();
    });

    it(`${projection}：平移后显式视角恢复中心，下一次旋转从该视角接手`, () => {
      const { camera, controls, drag } = setup(projection);
      drag(80, 30, 2);
      expect(controls.rotationTarget.length()).toBeGreaterThan(0);
      camera.position.copy(v(views[2].position));
      camera.up.copy(v(views[2].up));
      camera.lookAt(v(origin));
      controls.setRotationTarget(origin);
      controls.syncFromCamera();
      const original = camera.quaternion.clone();
      drag(80, 0);
      const relative = camera.position.clone().normalize().applyQuaternion(original.clone().invert());
      expect(relative.x).toBeLessThan(0);
      expect(relative.y).toBeCloseTo(0, 8);
      expect(controls.rotationTarget.length()).toBeLessThan(1e-8);
      controls.dispose();
    });
  }

  it("两个 renderer 使用同一个相机层，所有工作台使用同一吸附偏好", () => {
    for (const file of ["VoxelCanvas.tsx", "PolyhedronFoldCanvas.tsx"]) {
      const source = readFileSync(`src/features/spatial-math/renderer-r3f/${file}`, "utf8");
      expect(source).toContain("<SpatialCameraRig");
      expect(source).not.toContain("OrbitControls");
      expect(source).toContain("axisSnapEnabled={axisSnapEnabled}");
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
