import { createElement } from "react";
import { act, advance, createRoot, _roots, type RootState } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrthographicCamera, Quaternion, Vector3, type WebGLRenderer } from "three";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";

type Bookmark = Parameters<typeof SpatialCameraRig>[0]["bookmark"];
const front: Bookmark = { id: "front", projection: "orthographic", zoom: 1,
  position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } };
const right: Bookmark = { ...front, id: "right", position: { x: 10, y: 0, z: 0 } };
const top: Bookmark = { ...front, id: "top", position: { x: 0, y: 10, z: 0 }, up: { x: 0, y: 0, z: -1 } };

class CanvasSurface extends EventTarget {
  style = { touchAction: "" };
  clientWidth = 800;
  clientHeight = 600;
  ownerDocument = Object.assign(new EventTarget(), { documentElement: { clientLeft: 0, clientTop: 0 } });
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
  getRootNode() { return this.ownerDocument; }
  setPointerCapture() {}
  releasePointerCapture() {}
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// 保留真实 React/R3F 生命周期与 useFrame；只替换 GPU 输出，逐帧检查实际相机。
async function setupRig(reducedMotion = false, demand = false) {
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
  const render = async (bookmark: Bookmark, requestKey = 0) => {
    await act(async () => { root.render(createElement(SpatialCameraRig, {
      bookmark, radius: 4, interactive: true, requestKey, onTransitionStateChange,
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
  await render(front);
  frame();
  cleanups.push(async () => { await act(async () => { root.unmount(); }); frame(); });
  return { render, state, frame, surface, rendered, onTransitionStateChange,
    elapse: (ms: number) => { now += ms; } };
}

describe("共享相机真实帧循环", () => {
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
    const event = (type: string, x: number, y: number) => Object.assign(new Event(type), {
      pageX: x, pageY: y, clientX: x, clientY: y, button: 0, pointerType: "mouse", pointerId: 1,
    });
    rig.surface.dispatchEvent(event("pointerdown", 400, 300));
    window.dispatchEvent(event("pointermove", 450, 330));
    window.dispatchEvent(event("pointerup", 450, 330));
    const manual = camera.quaternion.clone();
    rig.frame(1_000);
    expect(camera.quaternion.angleTo(manual)).toBeLessThan(1e-7);
    expect(rig.onTransitionStateChange).toHaveBeenLastCalledWith(false);
  });
});
