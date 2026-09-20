import { createElement } from "react";
import { act, createRoot, extend, _roots } from "@react-three/fiber";
import * as THREE from "three";
import { afterEach, expect, it, vi } from "vitest";
import { SpatialTransformHandles } from "@/features/tools/spatial-interaction/SpatialTransformHandles";
import { planeHandleCorners, type SpatialTransformHandlesSpec } from "@/features/tools/spatial-interaction/transform-handles";
import type { SpatialObjectPreview } from "@/features/tools/spatial-interaction/object-gesture-controller";

vi.mock("three", async () => { const { createRequire } = await import("node:module"); return createRequire(import.meta.url)("three"); });
vi.mock("@react-three/drei", async (original) => ({ ...await original<object>(), Html: () => null }));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });

it("renders the same three plane grips as picking, keeps a frozen settle anchor, and renders three thin axis rings", async () => {
  extend({ Group: THREE.Group, Mesh: THREE.Mesh, BufferGeometry: THREE.BufferGeometry, BufferAttribute: THREE.BufferAttribute, MeshBasicMaterial: THREE.MeshBasicMaterial });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => {});
  const canvas = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
  const gl = { domElement: canvas, setSize() {}, setPixelRatio() {}, render() {}, xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as THREE.WebGLRenderer;
  const root = createRoot(canvas); await root.configure({ gl, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never", dpr: 1 });
  cleanups.push(async () => { await act(async () => root.unmount()); });
  const render = async (spec: SpatialTransformHandlesSpec, preview?: SpatialObjectPreview) => act(async () => { root.render(createElement(SpatialTransformHandles, { spec, preview })); });
  const scene = () => _roots.get(canvas)!.store.getState().scene;
  const spec: SpatialTransformHandlesSpec = { center: { x: 2, y: 3, z: 4 }, radius: 2, mode: "move" };
  await render(spec);
  expect(scene().getObjectByName("spatial-transform-handles")!.children).toHaveLength(3);
  for (const plane of ["table", "xy", "yz"] as const) {
    const group = scene().getObjectByName(`spatial-plane-handle:${plane}`)!, mesh = group.children[0] as THREE.Mesh;
    const position = mesh.geometry.getAttribute("position"), corners = planeHandleCorners(spec, plane);
    for (let i = 0; i < 3; i++) expect(new THREE.Vector3().fromBufferAttribute(position, i).distanceTo(corners[i])).toBeLessThan(1e-6);
    expect(new THREE.Raycaster().intersectObject(mesh)).toEqual([]);
  }
  const pose = { id: "piece", position: spec.center, quaternion: [0, 0, 0, 1] as [number, number, number, number] };
  const moved = { ...pose, position: { ...pose.position, x: 3 } };
  const preview: SpatialObjectPreview = { target: { pose, pivot: spec.center, grabPoint: spec.center }, pose: moved, landing: moved, valid: true, phase: "settle", constraint: { kind: "plane", plane: "table" }, handles: spec };
  await render({ ...spec, center: moved.position }, preview);
  const mesh = scene().getObjectByName("spatial-plane-handle:table")!.children[0] as THREE.Mesh;
  expect(mesh.geometry.getAttribute("position").getX(0)).toBeCloseTo(3 + 0.36 * 1.6);
  await render({ ...spec, mode: "rotate" });
  expect(scene().getObjectByName("spatial-transform-handles")!.children).toHaveLength(3);
  for (const axis of ["x", "y", "z"]) {
    const line = scene().getObjectByName(`spatial-rotation-ring:${axis}`)!.children[0];
    expect(line).toHaveProperty("isLine2", true); expect(line).toHaveProperty("material.linewidth", 1.7);
    expect(new THREE.Raycaster().intersectObject(line)).toEqual([]);
  }
});
