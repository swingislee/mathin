import { createElement, type ReactNode } from "react";
import { act, createRoot, extend, _roots } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3, type WebGLRenderer } from "three";
import * as THREE from "three";
import SomaCanvas, { type SomaCanvasProps } from "@/features/tools/soma-cube/SomaCanvas";
import { createSomaInitial, somaRotate, somaRoll } from "@/features/tools/soma-cube/model";
import { somaRigidPoses } from "@/features/tools/soma-cube/motion";
import type { CubeMoveInteraction } from "@/features/tools/spatial-lab/cube-structures-drag-controller";
import { spatialArcball, spatialArcballRotation } from "@/features/tools/spatial-interaction/arcball";
import type { SpatialGestureTarget } from "@/features/tools/spatial-interaction/object-gesture-controller";
import { somaRotationPivot } from "@/features/tools/soma-cube/model";
import { interpolateRigidPoses } from "@/features/tools/spatial-interaction/rigid-motion";
import { CUBE_COLORS, CUBE_SELECTION_COLOR } from "@/features/tools/spatial-lab/cube-structures-contract";
import type { SpatialObjectToolbarTarget } from "@/features/tools/spatial-interaction/SpatialObjectToolbar";
import { unitCubeCorners } from "@/features/tools/spatial-interaction/rolling";
import { spatialRigidPoint } from "@/features/tools/spatial-interaction/rigid-geometry";
import { somaDefinition } from "@/features/tools/soma-cube/pieces";
import { spatialMoveBasis } from "@/features/tools/spatial-interaction/object-gesture-math";

const controls = vi.hoisted(() => ({ interaction: null as CubeMoveInteraction | null, toolbar: null as SpatialObjectToolbarTarget | null }));

vi.mock("three", async () => {
  const { createRequire } = await import("node:module"); return createRequire(import.meta.url)("three");
});
// 保留真实 Soma 渲染、VoxelGeometry、React 及动画 hook，仅隔离 DOM 外壳和 HTML 手柄。
vi.mock("@/features/spatial-math/renderer-r3f/VoxelCanvas", async (original) => ({
  ...await original<object>(), VoxelModelCanvas: ({ sceneOverlay }: { sceneOverlay: ReactNode }) => sceneOverlay,
}));
vi.mock("@/features/tools/spatial-lab/CubeMoveHandles", () => ({ CubeMoveHandles: ({ interaction }: { interaction: CubeMoveInteraction }) => { controls.interaction = interaction; return null; } }));
vi.mock("@/features/tools/spatial-interaction/SpatialRotationControls", () => ({ SpatialRotationControls: (props: SpatialObjectToolbarTarget) => { controls.toolbar = props; return null; }, SpatialRotationAnchor: () => null }));
vi.mock("@/features/tools/spatial-interaction/SpatialArcballGuide", () => ({ SpatialArcballGuide: () => null }));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });

async function setup(reduced = false) {
  extend({ Group: THREE.Group, Mesh: THREE.Mesh, InstancedMesh: THREE.InstancedMesh, BoxGeometry: THREE.BoxGeometry, PlaneGeometry: THREE.PlaneGeometry, MeshBasicMaterial: THREE.MeshBasicMaterial,
    LineSegments: THREE.LineSegments, BufferGeometry: THREE.BufferGeometry, BufferAttribute: THREE.BufferAttribute, LineDashedMaterial: THREE.LineDashedMaterial });
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
  const viewFrame = async (elevation: number, azimuth = 0) => {
    const state = _roots.get(canvas)!.store.getState(), pitch = elevation * Math.PI / 180, yaw = azimuth * Math.PI / 180;
    state.camera.position.set(10 * Math.cos(pitch) * Math.sin(yaw), 10 * Math.sin(pitch), 10 * Math.cos(pitch) * Math.cos(yaw));
    state.camera.lookAt(0, 0, 0); state.camera.updateMatrixWorld();
    await act(async () => state.advance((now += 16) / 1000));
    return state.camera;
  };
  cleanups.push(async () => { await act(async () => root.unmount()); });
  return { initial, render, frame, viewFrame, group, onMoving, scene: () => _roots.get(canvas)!.store.getState().scene };
}

describe("Soma renders the shared rigid animation instead of replacing cells", () => {
  it("links the passive plane guide, live camera readout and next drag, retaining the plane throughout a drag", async () => {
    const rig = await setup(), onMoveViewChange = vi.fn(), onPoseCommit = () => true;
    const props = { movePlane: "auto" as const, lowViewAngle: 20, onMoveViewChange, onPoseCommit };
    await rig.render(props);
    const guide = () => rig.scene().getObjectByName("spatial-move-plane")!;
    const normal = () => new Vector3(0, 0, 1).applyQuaternion(guide().quaternion);
    await rig.viewFrame(35);
    expect(onMoveViewChange).toHaveBeenLastCalledWith({ plane: "table", elevation: 35 });
    expect(Math.abs(normal().y)).toBeCloseTo(1);
    await rig.viewFrame(15);
    expect(onMoveViewChange).toHaveBeenLastCalledWith({ plane: "xy", elevation: 15 });
    const camera = await rig.viewFrame(22); // 共享 4° 缓冲，起拖与可视方向相同。
    const body = controls.interaction!.bodyGesture!;
    expect(body.resolvePlane!(camera)).toBe("xy");
    expect(onMoveViewChange).toHaveBeenLastCalledWith({ plane: "xy", elevation: 22 });
    expect(Math.abs(normal().z)).toBeCloseTo(1);
    expect(guide().children).toHaveLength(9);
    for (const line of guide().children) {
      expect(line).toHaveProperty("isLine2", true);
      expect(new THREE.Raycaster().intersectObject(line)).toEqual([]);
    }
    const target = body.selected!;
    await act(async () => body.onPreview({ target, pose: target.pose, landing: target.pose, valid: true, phase: "drag", moveBasis: spatialMoveBasis("xy") }));
    await rig.viewFrame(45, 90);
    expect(onMoveViewChange).toHaveBeenLastCalledWith({ plane: "xy", elevation: 45 });
    expect(Math.abs(normal().z)).toBeCloseTo(1);
    await act(async () => body.onPreview(null));
    await rig.viewFrame(15, 90);
    expect(onMoveViewChange).toHaveBeenLastCalledWith({ plane: "yz", elevation: 15 });
    expect(Math.abs(normal().x)).toBeCloseTo(1);
    await rig.render({ ...props, navigation: "rotate" });
    expect(rig.scene().getObjectByName("spatial-move-guide")).toBeUndefined();
    await rig.render({ ...props, readOnly: true });
    expect(rig.scene().getObjectByName("spatial-move-guide")).toBeUndefined();
  });
  it("gives the shared toolbar real rotated vertices and the visible movement handles", async () => {
    const rig = await setup();
    const snapshot = { ...rig.initial, pieces: [{ id: "bao-1" as const, position: { x: 0, y: 3, z: 0 }, quaternion: new Quaternion().setFromAxisAngle(new THREE.Vector3(1, 2, 0).normalize(), 0.7).toArray() as [number, number, number, number] }] };
    await rig.render({ snapshot, onPoseCommit: () => true, instantKey: JSON.stringify(somaRigidPoses(snapshot.pieces)) });
    const pose = somaRigidPoses(snapshot.pieces)[0];
    expect(controls.toolbar!.vertices).toEqual(unitCubeCorners(somaDefinition("bao-1").cells).map((p) => spatialRigidPoint(p, pose)));
    expect(controls.toolbar!.moveHandles!.axes).toEqual(["y"]);
    await rig.render({ snapshot, onPoseCommit: () => true, preciseAxes: true });
    expect(controls.toolbar!.moveHandles!.axes).toEqual(["x", "y", "z"]);
    await rig.render({ snapshot, onPoseCommit: () => true, navigation: "rotate" });
    expect(controls.toolbar!.moveHandles!.axes).toEqual([]);
  });
  it("shows a nearby snap ghost without replacing the freely dragged pose, then keeps the settled classroom endpoint", async () => {
    const rig = await setup(), onPoseCommit = vi.fn<(next: SomaCanvasProps["snapshot"]) => boolean>(() => true);
    const source = { ...rig.initial, pieces: [{ ...rig.initial.pieces[0], position: { x: 0, y: 4, z: 0 } }] };
    await rig.render({ snapshot: source, onPoseCommit, instantKey: JSON.stringify(somaRigidPoses(source.pieces)) });
    const body = controls.interaction!.bodyGesture!, target = body.selected!;
    const c = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 100); c.position.set(0, 0, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld();
    const arcball = spatialArcball(target.pivot, target.radius!, c, { left: 0, top: 0, width: 800, height: 600 });
    const pose = spatialArcballRotation(target.pose, target.pivot, arcball.center, { x: arcball.center.x + arcball.radius * Math.sin(40 * Math.PI / 180), y: arcball.center.y }, arcball);
    const landing = body.resolve(target, pose, "rotate"); expect(landing.snapped).toBe(true);
    await act(async () => { body.onDragging(true); body.onPreview({ target, pose, landing: landing.pose, valid: landing.valid, phase: "drag", arcball, snapped: landing.snapped }); });
    const ghost = rig.scene().getObjectByName("soma-landing-preview")!;
    expect(ghost).toBeDefined(); expect(ghost.quaternion.angleTo(new Quaternion(...landing.pose.quaternion))).toBeLessThan(1e-7);
    expect(ghost.children).toHaveLength(1);
    const outline = ghost.children[0] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineDashedMaterial>;
    expect(outline.isLineSegments).toBe(true); expect(outline.material.isLineDashedMaterial).toBe(true);
    expect(outline.material.linewidth).toBe(1); expect(outline.material.dashSize).toBeGreaterThan(0); expect(outline.material.gapSize).toBeGreaterThan(0);
    expect(outline.geometry.getAttribute("lineDistance").count).toBe(outline.geometry.getAttribute("position").count);
    expect(outline.material.depthWrite).toBe(false); expect(new THREE.Raycaster().intersectObject(outline)).toEqual([]);
    expect(rig.group().quaternion.angleTo(new Quaternion(...pose.quaternion))).toBeLessThan(1e-7); expect(onPoseCommit).not.toHaveBeenCalled();
    expect(landing.apply()).toBe(true); const next = onPoseCommit.mock.lastCall![0];
    await rig.render({ snapshot: next, onPoseCommit, instantKey: JSON.stringify(somaRigidPoses(next.pieces)), readOnly: true });
    const middle = interpolateRigidPoses([pose], [landing.pose], 0.5)[0];
    await act(async () => body.onPreview({ target, pose: middle, landing: landing.pose, valid: true, phase: "settle" }));
    expect(rig.scene().getObjectByName("soma-landing-preview")).toBeUndefined();
    expect(rig.group().quaternion.angleTo(new Quaternion(...landing.pose.quaternion))).toBeCloseTo(5 * Math.PI / 180);
    await act(async () => { body.onPreview(null); body.onDragging(false); });
    expect(rig.group().quaternion.angleTo(new Quaternion(...landing.pose.quaternion))).toBeLessThan(1e-7);
    await rig.render({ snapshot: structuredClone(next), onPoseCommit, instantKey: JSON.stringify(somaRigidPoses(next.pieces)), readOnly: true }); await rig.frame(650);
    expect(rig.group().quaternion.angleTo(new Quaternion(...landing.pose.quaternion))).toBeLessThan(1e-7);
    expect(rig.onMoving).toHaveBeenLastCalledWith(false); expect(onPoseCommit).toHaveBeenCalledTimes(1);
  });
  it("keeps the free rotation after release and through the classroom commit without an extra landing", async () => {
    const rig = await setup(), onPoseCommit = vi.fn<(next: SomaCanvasProps["snapshot"]) => boolean>(() => true);
    const source = { ...rig.initial, pieces: [ { ...rig.initial.pieces[0], position: { x: 0, y: 4, z: 0 } } ] };
    await rig.render({ snapshot: source, onPoseCommit, rotationSnap: "free", instantKey: JSON.stringify(somaRigidPoses(source.pieces)) });
    const body = controls.interaction!.bodyGesture!, target = body.selected as SpatialGestureTarget;
    const c = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 100); c.position.set(0, 0, 10); c.lookAt(0, 0, 0); c.updateMatrixWorld();
    const arcball = spatialArcball(target.pivot, target.radius!, c, { left: 0, top: 0, width: 800, height: 600 });
    const pose = spatialArcballRotation(target.pose, target.pivot, arcball.center, { x: arcball.center.x + 95, y: arcball.center.y + 17 }, arcball), landing = body.resolve(target, pose, "rotate");
    await act(async () => { body.onDragging(true); body.onPreview({ target, pose, landing: landing.pose, valid: landing.valid, phase: "drag", arcball }); });
    expect(rig.group().quaternion.angleTo(new Quaternion(...pose.quaternion))).toBeLessThan(1e-7);
    expect(rig.scene().getObjectByName("soma-landing-preview")).toBeUndefined(); expect(onPoseCommit).not.toHaveBeenCalled();
    expect(controls.interaction!.enabled).toBe(false); expect(controls.interaction!.bodyGesture!.enabled).toBe(true);
    expect(landing.apply()).toBe(true); const next = onPoseCommit.mock.lastCall![0];
    await rig.render({ snapshot: next, onPoseCommit, instantKey: JSON.stringify(somaRigidPoses(next.pieces)), readOnly: true });
    expect(rig.group().quaternion.angleTo(new Quaternion(...pose.quaternion))).toBeLessThan(1e-7);
    await act(async () => { body.onPreview(null); body.onDragging(false); });
    expect(rig.group().quaternion.angleTo(new Quaternion(...landing.pose.quaternion))).toBeLessThan(1e-7);
    expect(rig.scene().getObjectByName("soma-landing-preview")).toBeUndefined(); expect(onPoseCommit).toHaveBeenCalledTimes(1);
    expect(somaRotationPivot(next.pieces[0], true)).toEqual(somaRotationPivot(source.pieces[0], true));
    expect(new Quaternion(...landing.pose.quaternion).angleTo(new Quaternion(...pose.quaternion))).toBeLessThan(1e-7);
    const reopened = await setup();
    await reopened.render({ snapshot: JSON.parse(JSON.stringify(next)), readOnly: true, instantKey: JSON.stringify(somaRigidPoses(next.pieces)) });
    expect(reopened.group().quaternion.angleTo(new Quaternion(...pose.quaternion))).toBeLessThan(1e-7);
  });
  it.each([true, false])("translation shares the thin unfilled dashed landing outline (valid=%s)", async (valid) => {
    const rig = await setup(); await rig.render({ onPoseCommit: () => true });
    const body = controls.interaction!.bodyGesture!, target = body.selected!;
    const pose = { ...target.pose, position: { ...target.pose.position, x: target.pose.position.x + 1.2 } };
    const landing = body.resolve(target, pose, "translate");
    await act(async () => body.onPreview({ target, pose, landing: landing.pose, valid, phase: "drag" }));
    const ghost = rig.scene().getObjectByName("soma-landing-preview")!;
    expect(ghost.position.x).toBe(landing.pose.position.x); expect(rig.group().position.x).toBe(pose.position.x);
    expect(ghost.children).toHaveLength(1);
    const outline = ghost.children[0] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineDashedMaterial>;
    expect(outline.isLineSegments).toBe(true); expect(outline.material.isLineDashedMaterial).toBe(true); expect(outline.material.linewidth).toBe(1);
    expect(outline.material.color.getHexString()).toBe(new THREE.Color(valid ? CUBE_COLORS[0] : CUBE_SELECTION_COLOR).getHexString());
    await act(async () => body.onPreview(null)); expect(rig.scene().getObjectByName("soma-landing-preview")).toBeUndefined();
  });
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
  it("renders the same rigid contact-edge arc for a roll received from a classroom snapshot", async () => {
    const rig = await setup();
    const source = { ...rig.initial, pieces: [rig.initial.pieces[0]] };
    await rig.render({ snapshot: source });
    const next = somaRoll(source, "z-")!; expect(next).not.toBeNull();
    await rig.render({ snapshot: structuredClone(next) }); await rig.frame(); await rig.frame(325);
    const target = somaRigidPoses(next.pieces)[0];
    expect(rig.group().quaternion.angleTo(new Quaternion(...target.quaternion))).toBeCloseTo(Math.PI / 4);
    expect(rig.group().position.y).toBeGreaterThan(target.position.y);
    await rig.frame(650); expect(rig.group().position.distanceTo(new Vector3(target.position.x, target.position.y, target.position.z))).toBeLessThan(1e-7);
  });
});
