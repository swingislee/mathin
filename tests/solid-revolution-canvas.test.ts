import { createElement, type ReactNode } from "react";
import { act, createRoot, extend, _roots } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SolidRevolutionCanvas, type SolidRevolutionCanvasProps } from "@/features/tools/solid-revolution/SolidRevolutionCanvas";
import { createDefaultSolidRevolutionInitial, solidRevolutionSnapshot } from "@/features/tools/solid-revolution/contract";
import { revolutionDimensions, revolutionPoint } from "@/features/tools/solid-revolution/model";

vi.mock("three", async () => { const { createRequire } = await import("node:module"); return createRequire(import.meta.url)("three"); });
// 保留真实纸片、扫体与 Line 几何，仅隔离 WebGL 外壳、HTML 标签及指针绑定。
vi.mock("@react-three/fiber", async (original) => ({ ...await original<object>(), Canvas: ({ children }: { children: ReactNode }) => children }));
vi.mock("@react-three/drei", async (original) => ({ ...await original<object>(), Html: () => null }));
vi.mock("@/features/spatial-math/renderer-r3f/SpatialCameraRig", () => ({ SpatialCameraRig: () => null }));
vi.mock("@/features/tools/solid-revolution/RevolutionInteraction", () => ({ RevolutionInteraction: () => null }));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });
async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("window", { devicePixelRatio: 1 });
  extend({ Group: THREE.Group, Mesh: THREE.Mesh, MeshBasicMaterial: THREE.MeshBasicMaterial, SphereGeometry: THREE.SphereGeometry });
  const canvas = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
  const gl = { domElement: canvas, setSize() {}, setPixelRatio() {}, render() {}, xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as THREE.WebGLRenderer;
  const root = createRoot(canvas); await root.configure({ gl, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never", dpr: 1 });
  cleanups.push(async () => { await act(async () => root.unmount()); });
  const snapshot = solidRevolutionSnapshot({ ...createDefaultSolidRevolutionInitial(), grid: false, showMeasures: false });
  const props: SolidRevolutionCanvasProps = { snapshot, angle: 0, locale: "en", navigation: "orbit", axisSnap: false, interactive: true, gestureEnabled: true, selected: true,
    onSelect() {}, onPreview() {}, onCommit: () => true, onDragging() {}, onUnavailable() {} };
  const render = async (patch: Partial<SolidRevolutionCanvasProps>) => act(async () => { root.render(createElement(SolidRevolutionCanvas, { ...props, ...patch })); });
  const arc = (index: number) => _roots.get(canvas)!.store.getState().scene.getObjectByName(`revolution-boundary-${index}`) as THREE.Mesh | undefined;
  return { snapshot, render, arc };
}

describe("revolution boundary rendering", () => {
  it.each(["height", "width"] as const)("renders both rectangle boundaries at the live angle around %s", async (axis) => {
    const rig = await setup(), snapshot = { ...rig.snapshot, axis }, { radius, height } = revolutionDimensions(snapshot);
    await rig.render({ snapshot }); expect(rig.arc(0)).toBeUndefined(); expect(rig.arc(1)).toBeUndefined();
    for (const angle of [45, 180, 360, 90]) {
      await rig.render({ snapshot, angle });
      for (const index of [0, 1]) {
        const line = rig.arc(index)!; expect(line).toBeDefined();
        const ends = line.geometry.getAttribute("instanceEnd"), end = new THREE.Vector3().fromBufferAttribute(ends, ends.count - 1);
        const expected = revolutionPoint(radius, index === 0 ? 0 : height, angle);
        expect(end.x).toBeCloseTo(expected.x); expect(end.y).toBeCloseTo(expected.y); expect(end.z).toBeCloseTo(expected.z);
        expect(line.renderOrder).toBe(2); expect(line).toHaveProperty("material.depthWrite", false);
        expect(new THREE.Raycaster().intersectObject(line)).toEqual([]);
      }
    }
    await rig.render({ snapshot: { ...snapshot, showSweep: false }, angle: 360 }); expect(rig.arc(1)).toBeDefined();
    await rig.render({ snapshot: { ...snapshot, shape: "right-triangle" }, angle: 360 }); expect(rig.arc(0)).toBeDefined(); expect(rig.arc(1)).toBeUndefined();
    await rig.render({ snapshot, angle: 0 }); expect(rig.arc(0)).toBeUndefined(); expect(rig.arc(1)).toBeUndefined();
  });
});
