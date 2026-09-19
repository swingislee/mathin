import { createElement, type ReactNode } from "react";
import { act, createRoot, extend, _roots } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3, type WebGLRenderer } from "three";
import * as THREE from "three";
import SomaCanvas, { type SomaCanvasProps } from "@/features/tools/soma-cube/SomaCanvas";
import { createSomaInitial, somaRotate } from "@/features/tools/soma-cube/model";
import { somaRigidPoses } from "@/features/tools/soma-cube/motion";

vi.mock("three", async () => {
  const { createRequire } = await import("node:module"); return createRequire(import.meta.url)("three");
});
// 保留真实 Soma 渲染、VoxelGeometry、React 及动画 hook，仅隔离 DOM 外壳和 HTML 手柄。
vi.mock("@/features/spatial-math/renderer-r3f/VoxelCanvas", async (original) => ({
  ...await original<object>(), VoxelModelCanvas: ({ sceneOverlay }: { sceneOverlay: ReactNode }) => sceneOverlay,
}));
vi.mock("@/features/tools/spatial-lab/CubeMoveHandles", () => ({ CubeMoveHandles: () => null }));
vi.mock("@/features/tools/spatial-interaction/SpatialRotationControls", () => ({ SpatialRotationControls: () => null }));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });

async function setup(reduced = false) {
  extend({ Group: THREE.Group, Mesh: THREE.Mesh, InstancedMesh: THREE.InstancedMesh, BoxGeometry: THREE.BoxGeometry, PlaneGeometry: THREE.PlaneGeometry, MeshBasicMaterial: THREE.MeshBasicMaterial });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { devicePixelRatio: 1, matchMedia: () => ({ matches: reduced }) });
  const frames = new Map<number, FrameRequestCallback>(); let id = 0, now = 100;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const canvas = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
  const gl = { domElement: canvas, setSize() {}, setPixelRatio() {}, render() {}, xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as WebGLRenderer;
  const root = createRoot(canvas); await root.configure({ gl, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never", dpr: 1 });
  const onMoving = vi.fn(), initial = { ...createSomaInitial(), labels: false, grid: false, axes: false };
  const props: SomaCanvasProps = { snapshot: initial, messages: {} as SomaCanvasProps["messages"], title: "Soma", locale: "en", readOnly: false, axisSnap: false, navigation: "orbit", moveAxis: "x",
    onMoveAxis: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onRotate: vi.fn(), onUnavailable: vi.fn(), onDragging: vi.fn(), onMoving };
  const render = async (next: Partial<SomaCanvasProps>) => { await act(async () => { root.render(createElement(SomaCanvas, { ...props, ...next })); }); };
  await render({});
  const frame = async (ms = 16) => { now += ms; const pending = [...frames.values()]; frames.clear(); await act(async () => pending.forEach((callback) => callback(now))); };
  const group = () => _roots.get(canvas)!.store.getState().scene.getObjectByName("soma-rigid:bao-1")!;
  cleanups.push(async () => { await act(async () => root.unmount()); });
  return { initial, render, frame, group, onMoving };
}

describe("Soma renders the shared rigid animation instead of replacing cells", () => {
  it.each([false, true])("shows intermediate rotation with reduced motion = %s and ends at the exact pose", async (reduced) => {
    const rig = await setup(reduced), before = rig.group().quaternion.clone();
    const next = somaRotate(rig.initial, "y", 1)!;
    await rig.render({ snapshot: next });
    expect(rig.group().quaternion.angleTo(before)).toBeLessThan(1e-7);
    expect(rig.onMoving).toHaveBeenLastCalledWith(true);
    await rig.frame(); await rig.frame(reduced ? 120 : 325);
    expect(rig.group().quaternion.angleTo(before)).toBeCloseTo(Math.PI / 4);
    await rig.frame(650);
    const target = somaRigidPoses(next.pieces)[0];
    expect(rig.group().quaternion.angleTo(new Quaternion(...target.quaternion))).toBeLessThan(1e-7);
    expect(rig.group().position.distanceTo(new Vector3(target.position.x, target.position.y, target.position.z))).toBeLessThan(1e-7);
    expect(rig.onMoving).toHaveBeenLastCalledWith(false);
    const settled = rig.group().quaternion.clone();
    await rig.render({ snapshot: structuredClone(next) }); await rig.frame(650);
    expect(rig.group().quaternion.angleTo(settled)).toBeLessThan(1e-7);
  });
  it("a direct drag endpoint does not animate the already completed motion again", async () => {
    const rig = await setup();
    const next = { ...rig.initial, pieces: rig.initial.pieces.map((piece) => piece.id === "bao-1" ? { ...piece, position: { ...piece.position, x: piece.position.x + 1 } } : piece) };
    const poses = somaRigidPoses(next.pieces);
    await rig.render({ snapshot: next, instantKey: JSON.stringify(poses) });
    expect(rig.group().position.x).toBe(poses[0].position.x);
    expect(rig.onMoving).toHaveBeenLastCalledWith(false);
    await rig.render({ snapshot: { ...next, selectedId: "bao-2" }, instantKey: null }); await rig.frame(300);
    expect(rig.group().position.x).toBe(poses[0].position.x);
    expect(rig.onMoving).toHaveBeenLastCalledWith(false);
  });
});
