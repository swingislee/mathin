import { createElement, type ComponentRef } from "react";
import type { OrbitControls } from "@react-three/drei";
import { act, advance, createRoot, _roots, type RootState } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrthographicCamera, Quaternion, Vector3, type WebGLRenderer } from "three";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import { bindCubeAxisDrag } from "@/features/tools/spatial-lab/cube-structures-drag-controller";
import { createCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import { beginSpatialObjectGesture } from "@/features/spatial-math/renderer-r3f/spatial-object-gesture";

// Node 下 drei 使用 CJS；统一真实 Three 构造器，避免 ESM/CJS 双实例误判相机类型。
vi.mock("three", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("three");
});

type Bookmark = Parameters<typeof SpatialCameraRig>[0]["bookmark"];
type Orbit = ComponentRef<typeof OrbitControls>;
const front: Bookmark = { id: "front", projection: "orthographic", zoom: 1,
  position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } };
const right: Bookmark = { ...front, id: "right", position: { x: 10, y: 0, z: 0 } };
const top: Bookmark = { ...front, id: "top", position: { x: 0, y: 10, z: 0 }, up: { x: 0, y: 0, z: -1 } };

class CanvasSurface extends EventTarget {
  style = { touchAction: "", cursor: "" };
  clientWidth = 800;
  clientHeight = 600;
  ownerDocument = Object.assign(new EventTarget(), { documentElement: { clientLeft: 0, clientTop: 0 } });
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
  getRootNode() { return this.ownerDocument; }
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
}

function pointer(surface: CanvasSurface, type: string, x: number, y: number, button = 0, pointerType = "mouse") {
  const target = type === "pointerdown" ? surface : surface.ownerDocument;
  target.dispatchEvent(Object.assign(new Event(type), {
    pageX: x, pageY: y, clientX: x, clientY: y, button, pointerType, pointerId: 1,
  }));
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// 保留真实 React/R3F 生命周期与 useFrame；只替换 GPU 输出，逐帧检查实际相机。
async function setupRig(reducedMotion = false, demand = false, initialBookmark: Bookmark = front) {
  let now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    devicePixelRatio: 1, pageXOffset: 0, pageYOffset: 0,
    matchMedia: () => Object.assign(new EventTarget(), { matches: reducedMotion }),
  }));
  const animationFrames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    animationFrames.set(++nextFrameId, callback);
    return nextFrameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { animationFrames.delete(id); });
  const surface = new CanvasSurface();
  const canvas = surface as unknown as HTMLCanvasElement;
  const rendered: Quaternion[] = [];
  const renderer = {
    domElement: canvas, setSize() {}, setPixelRatio() {},
    render: (_scene: unknown, camera: RootState["camera"]) => rendered.push(camera.quaternion.clone()),
    xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }),
  } as unknown as WebGLRenderer;
  const root = createRoot(canvas);
  await root.configure({ gl: renderer, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: demand ? "demand" : "never", dpr: 1 });
  const onTransitionStateChange = vi.fn();
  const render = async (bookmark: Bookmark, requestKey = 0, navigationMode: "orbit" | "pan" | "object" = "orbit") => {
    await act(async () => { root.render(createElement(SpatialCameraRig, {
      bookmark, radius: 4, interactive: true, requestKey, navigationMode, onTransitionStateChange,
    })); });
  };
  const state = () => _roots.get(canvas)!.store.getState();
  const frame = (elapsedMs = 16) => {
    now += elapsedMs;
    if (demand) {
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of callbacks) callback(now);
    } else {
      advance(now / 1_000, false, state());
    }
  };
  await render(initialBookmark);
  frame();
  cleanups.push(async () => { await act(async () => { root.unmount(); }); frame(); });
  return { render, state, frame, surface, rendered, onTransitionStateChange,
    elapse: (ms: number) => { now += ms; } };
}

describe("共享相机真实帧循环", () => {
  it("对象接管保留当前姿态，不触发 Orbit 的 up 重置或继续旧视角动画", async () => {
    const rig = await setupRig(); await rig.render(top); rig.frame(); rig.frame(720);
    const camera = rig.state().camera, before = camera.quaternion.clone(), up = camera.up.clone();
    beginSpatialObjectGesture(rig.surface as unknown as HTMLCanvasElement); rig.frame();
    expect(camera.up.distanceTo(up)).toBeLessThan(1e-7);
    expect(camera.quaternion.angleTo(before)).toBeLessThan(1e-7);
    await rig.render(right); rig.frame(); rig.frame(240);
    const position = camera.position.clone();
    beginSpatialObjectGesture(rig.surface as unknown as HTMLCanvasElement); rig.frame(900);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-7);
  });
  for (const pointerType of ["mouse", "touch"] as const) {
    it(`${pointerType} 对象模式保留空白旋转、滚轮缩放与右键平移`, async () => {
      const rig = await setupRig();
      await rig.render(front, 0, "object");
      const camera = rig.state().camera as OrthographicCamera;
      const controls = rig.state().controls as unknown as Orbit;
      const before = camera.quaternion.clone();
      pointer(rig.surface, "pointerdown", 400, 300, 0, pointerType);
      pointer(rig.surface, "pointermove", 490, 340, 0, pointerType);
      pointer(rig.surface, "pointerup", 490, 340, 0, pointerType);
      rig.frame();
      expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.1);
      expect(controls.target.length()).toBeLessThan(1e-7);
      const zoom = camera.zoom;
      rig.surface.dispatchEvent(Object.assign(new Event("wheel"), { deltaY: -100 }));
      expect(camera.zoom).toBeGreaterThan(zoom);
      pointer(rig.surface, "pointerdown", 400, 300, 2);
      pointer(rig.surface, "pointermove", 440, 340, 2);
      pointer(rig.surface, "pointerup", 440, 340, 2);
      expect(controls.target.length()).toBeGreaterThan(0.1);
    });

    it(`${pointerType} 命中物体只移动物体，随后拖空白无需切换按钮即可旋转`, async () => {
      const rig = await setupRig(); await rig.render(front, 0, "object");
      const camera = rig.state().camera, controls = rig.state().controls as unknown as Orbit;
      const state = createCubeHistory([{ x: 0, y: 0, z: 0 }]).initial, commit = vi.fn();
      // Node EventTarget 没有 DOM 树阶段；按浏览器的 capture → bubble 顺序注册。
      controls.dispose();
      const dispose = bindCubeAxisDrag(rig.surface as unknown as HTMLCanvasElement, () => ({ state, ids: ["cube-1"], scopeIds: ["cube-1"], axis: "x", kind: "move", snapToGrid: true,
        onAxisChange: vi.fn(), onSelect: vi.fn(), onCommit: commit, onUnavailable: vi.fn() }), () => camera, vi.fn(), (active) => { if (active) beginSpatialObjectGesture(rig.surface as unknown as HTMLCanvasElement); });
      controls.connect(rig.surface as unknown as HTMLElement);
      const before = camera.quaternion.clone();
      pointer(rig.surface, "pointerdown", 400, 300, 0, pointerType);
      pointer(rig.surface, "pointermove", 480, 300, 0, pointerType);
      pointer(rig.surface, "pointerup", 480, 300, 0, pointerType);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit.mock.calls[0][0]).toMatchObject({ axis: "x", ids: ["cube-1"] });
      expect(camera.quaternion.angleTo(before)).toBeLessThan(1e-7);
      pointer(rig.surface, "pointerdown", 60, 60, 0, pointerType);
      pointer(rig.surface, "pointermove", 120, 100, 0, pointerType);
      pointer(rig.surface, "pointerup", 120, 100, 0, pointerType);
      expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.1);
      expect(commit).toHaveBeenCalledTimes(1); dispose();
    });

    it(`${pointerType} 点击俯视后，手动旋转仍围绕世界 Y 轴`, async () => {
      const rig = await setupRig();
      await rig.render(top);
      rig.frame(); rig.frame(720);
      const camera = rig.state().camera;
      expect(camera.up.toArray()).toEqual([0, 0, -1]);
      pointer(rig.surface, "pointerdown", 400, 300, 0, pointerType);
      pointer(rig.surface, "pointermove", 480, 300, 0, pointerType);
      pointer(rig.surface, "pointerup", 480, 300, 0, pointerType);
      expect(camera.up.toArray()).toEqual([0, 1, 0]);
      expect(camera.position.y).toBeCloseTo(10, 6);
      expect(Math.hypot(camera.position.x, camera.position.z)).toBeLessThan(0.0001);
      // 从俯视向下拖动恢复仰角，左右转动仍保持相同高度。
      pointer(rig.surface, "pointerdown", 400, 300, 0, pointerType);
      pointer(rig.surface, "pointermove", 400, 240, 0, pointerType);
      pointer(rig.surface, "pointerup", 400, 240, 0, pointerType);
      expect(camera.position.y).toBeLessThan(9);
      const elevation = camera.position.y;
      pointer(rig.surface, "pointerdown", 400, 300, 0, pointerType);
      pointer(rig.surface, "pointermove", 440, 300, 0, pointerType);
      pointer(rig.surface, "pointerup", 440, 300, 0, pointerType);
      expect(camera.position.y).toBeCloseTo(elevation, 7);
    });
  }
  for (const pointerType of ["mouse", "touch"] as const) {
    it(`${pointerType} 平移工具只移动视野，切回观察恢复原旋转`, async () => {
      const rig = await setupRig();
      await rig.render(front, 0, "pan");
      const camera = rig.state().camera;
      const controls = rig.state().controls as unknown as Orbit;
      const orientation = camera.quaternion.clone();
      const relativePosition = camera.position.clone().sub(controls.target);
      pointer(rig.surface, "pointerdown", 400, 300, 0, pointerType);
      pointer(rig.surface, "pointermove", 450, 330, 0, pointerType);
      pointer(rig.surface, "pointerup", 450, 330, 0, pointerType);
      rig.frame();
      expect(controls.target.length()).toBeGreaterThan(0.1);
      expect(camera.position.clone().sub(controls.target).distanceTo(relativePosition)).toBeLessThan(1e-7);
      expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
      await rig.render(front, 0, "orbit");
      pointer(rig.surface, "pointerdown", 400, 300, 0, pointerType);
      pointer(rig.surface, "pointermove", 450, 330, 0, pointerType);
      pointer(rig.surface, "pointerup", 450, 330, 0, pointerType);
      expect(camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.1);
    });
  }

  it("正视到侧视再到俯视：保留同一个相机，渲染中间姿态并精确到达", async () => {
    const rig = await setupRig();
    const camera = rig.state().camera;
    const initial = camera.quaternion.clone();
    await rig.render(right);
    expect(rig.state().camera).toBe(camera);
    expect(camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
    rig.frame(16);
    rig.frame(360);
    expect(camera.position.x).toBeGreaterThan(3);
    expect(camera.position.z).toBeGreaterThan(3);
    rig.frame(720);
    expect(camera.position.distanceTo(new Vector3(10, 0, 0))).toBeLessThan(1e-7);
    await rig.render(top);
    rig.frame(16);
    rig.frame(360);
    expect(camera.position.x).toBeGreaterThan(3);
    expect(camera.position.y).toBeGreaterThan(3);
    rig.frame(720);
    expect(camera.position.distanceTo(new Vector3(0, 10, 0))).toBeLessThan(1e-7);
    expect(camera.up.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-7);
    expect(rig.onTransitionStateChange).toHaveBeenLastCalledWith(false);
  });

  it("点击后首帧延迟也从当前姿态开始，不把等待绘制的时间算成已播放", async () => {
    const rig = await setupRig();
    const camera = rig.state().camera;
    const initial = camera.quaternion.clone();
    await rig.render(right);
    rig.elapse(2_000);
    rig.frame();
    expect(camera.quaternion.angleTo(initial)).toBeLessThan(0.02);
    rig.frame(360);
    expect(camera.position.x).toBeGreaterThan(3);
    expect(camera.position.z).toBeGreaterThan(3);
  });

  it("真实 demand 调度主动续帧，不只在点击时绘制一次", async () => {
    const rig = await setupRig(false, true);
    await rig.render(right);
    rig.elapse(2_000);
    const before = rig.rendered.length;
    for (let frame = 0; frame < 24; frame++) rig.frame(16);
    expect(rig.rendered.length - before).toBe(24);
    const camera = rig.state().camera;
    expect(camera.position.x).toBeGreaterThan(3);
    expect(camera.position.z).toBeGreaterThan(3);
    for (let frame = 0; frame < 24; frame++) rig.frame(16);
    expect(camera.position.distanceTo(new Vector3(10, 0, 0))).toBeLessThan(1e-7);
  });

  it("连续点视角和重复点同一视角，从画面当前姿态接续", async () => {
    const rig = await setupRig();
    await rig.render(right);
    rig.frame(16);
    rig.frame(240);
    const camera = rig.state().camera;
    const middle = camera.quaternion.clone();
    await rig.render(top);
    expect(camera.quaternion.angleTo(middle)).toBeLessThan(1e-7);
    rig.frame(16);
    expect(camera.quaternion.angleTo(middle)).toBeLessThan(0.02);
    rig.frame(720);
    camera.position.set(4, 8, 4);
    camera.lookAt(0, 0, 0);
    const manual = camera.quaternion.clone();
    await rig.render(top, 1);
    expect(camera.quaternion.angleTo(manual)).toBeLessThan(1e-7);
    rig.frame(16);
    rig.frame(720);
    expect(camera.position.distanceTo(new Vector3(0, 10, 0))).toBeLessThan(1e-7);
  });

  it("正交相机的取景尺寸由空间模型控制，R3F 不覆盖为屏幕像素", async () => {
    const rig = await setupRig();
    const camera = rig.state().camera as OrthographicCamera;
    expect(camera.top).toBeCloseTo(4 * 1.35);
    expect(camera.right / camera.top).toBeCloseTo(4 / 3);
  });

  it("非原点模型接入与投影切换保持当前中心，不闪回默认原点", async () => {
    const target = { x: 3, y: 2, z: 1 };
    const position = { x: 3, y: 2, z: 11 };
    const rig = await setupRig(false, false, { ...front, target, position });
    const initial = rig.state().camera.quaternion.clone();
    expect(initial.angleTo(new Quaternion())).toBeLessThan(1e-7);
    expect((rig.state().controls as unknown as Orbit).target.toArray()).toEqual([3, 2, 1]);
    await rig.render({ ...front, id: "3d", projection: "perspective", fovDegrees: 38,
      target, position: { x: 13, y: 10, z: 11 } });
    const camera = rig.state().camera;
    expect(camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
    rig.frame();
    expect(camera.position.distanceTo(new Vector3(3, 2, 11))).toBeLessThan(1e-7);
    rig.frame(360);
    expect(camera.position.x).toBeGreaterThan(3);
    expect(camera.position.x).toBeLessThan(13);
    rig.frame(360);
    expect(camera.position.distanceTo(new Vector3(13, 10, 11))).toBeLessThan(1e-7);
  });

  it("减少动态效果偏好下，主动切换仍渲染简短中间姿态", async () => {
    const rig = await setupRig(true);
    const camera = rig.state().camera;
    const initial = camera.quaternion.clone();
    await rig.render(right);
    expect(camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
    rig.frame();
    rig.frame(120);
    expect(camera.position.x).toBeGreaterThan(3);
    expect(camera.position.z).toBeGreaterThan(3);
    rig.frame(120);
    expect(camera.position.distanceTo(new Vector3(10, 0, 0))).toBeLessThan(1e-7);
  });

  it("拖动立即接管动画，松手后不被旧动画拉回", async () => {
    const rig = await setupRig();
    await rig.render(right);
    rig.frame();
    rig.frame(240);
    const camera = rig.state().camera;
    const before = camera.quaternion.clone();
    pointer(rig.surface, "pointerdown", 400, 300);
    pointer(rig.surface, "pointermove", 450, 330);
    pointer(rig.surface, "pointerup", 450, 330);
    const manual = camera.quaternion.clone();
    expect(manual.angleTo(before)).toBeGreaterThan(0.1);
    rig.frame(1_000);
    expect(camera.quaternion.angleTo(manual)).toBeLessThan(1e-7);
    expect(rig.onTransitionStateChange).toHaveBeenLastCalledWith(false);
  });

  for (const projection of ["orthographic", "perspective"] as const) {
    for (const pointerType of ["mouse", "touch"] as const) {
      it(`${projection}/${pointerType}：沿用原 Orbit 控件与默认手势参数`, async () => {
        const bookmark: Bookmark = projection === "orthographic" ? front : {
          ...front, projection: "perspective", fovDegrees: 38,
        };
        const rig = await setupRig(false, false, bookmark);
        const controls = rig.state().controls as unknown as Orbit;
        expect(controls.constructor.name).toBe("OrbitControls");
        expect(controls.enableDamping).toBe(false);
        expect(controls.rotateSpeed).toBe(1);
        expect(controls.minPolarAngle).toBe(0);
        expect(controls.maxPolarAngle).toBe(Math.PI);
        expect(controls.minAzimuthAngle).toBe(-Infinity);
        expect(controls.maxAzimuthAngle).toBe(Infinity);

        // 对照同版本原控件，不重写另一套旋转算法；包含普通拖动和顶部之后的拖动。
        const baselineCamera = rig.state().camera.clone();
        const baselineSurface = new CanvasSurface();
        const Constructor = controls.constructor as new (camera: typeof baselineCamera) => Orbit;
        const baseline = new Constructor(baselineCamera);
        baseline.enableDamping = false;
        baseline.connect(baselineSurface as unknown as HTMLElement);
        for (const [dx, dy] of [[80, 40], [-60, 700], [80, 0], [0, -120]]) {
          for (const surface of [rig.surface, baselineSurface]) {
            pointer(surface, "pointerdown", 400, 300, 0, pointerType);
            pointer(surface, "pointermove", 400 + dx, 300 + dy, 0, pointerType);
            pointer(surface, "pointerup", 400 + dx, 300 + dy, 0, pointerType);
          }
          rig.frame();
          baseline.update();
          expect(rig.state().camera.position.distanceTo(baselineCamera.position)).toBeLessThan(1e-7);
          expect(rig.state().camera.quaternion.angleTo(baselineCamera.quaternion)).toBeLessThan(1e-7);
        }
        baseline.dispose();
      });
    }

    it(`${projection}：原缩放和平移保留，按钮从平移后的姿态平滑恢复`, async () => {
      const bookmark: Bookmark = projection === "orthographic" ? front : { ...front, projection: "perspective", fovDegrees: 38 };
      const rig = await setupRig(false, false, bookmark);
      const camera = rig.state().camera;
      const controls = rig.state().controls as unknown as Orbit;
      const visibleScale = () => camera instanceof OrthographicCamera ? camera.zoom : 1 / camera.position.distanceTo(controls.target);
      const initialScale = visibleScale();
      rig.surface.dispatchEvent(Object.assign(new Event("wheel"), { deltaY: -100 }));
      expect(visibleScale()).toBeGreaterThan(initialScale);
      pointer(rig.surface, "pointerdown", 400, 300, 2);
      pointer(rig.surface, "pointermove", 450, 330, 2);
      pointer(rig.surface, "pointerup", 450, 330, 2);
      expect(controls.target.length()).toBeGreaterThan(0.1);
      const position = camera.position.clone();
      await rig.render(bookmark, 1);
      expect(camera.position.distanceTo(position)).toBeLessThan(1e-7);
      rig.frame();
      rig.frame(720);
      expect(controls.target.length()).toBeLessThan(1e-7);
      expect(camera.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(1e-7);
    });
  }
});
