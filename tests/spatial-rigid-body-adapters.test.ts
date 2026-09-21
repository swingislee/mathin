// @vitest-environment jsdom
import { createElement, type ComponentProps, type ReactNode } from "react";
import { act, createRoot, extend, _roots } from "@react-three/fiber";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import DiceTeachingCanvas from "@/features/tools/spatial-lab/DiceTeachingCanvas";
import SolidGeometryCanvas from "@/features/tools/solid-geometry/SolidGeometryCanvas";
import { CubeStructuresViewport } from "@/features/tools/spatial-lab/CubeStructuresViewport";
import { createDiceScene, type TeachingDie } from "@/features/tools/spatial-lab/dice-teaching-model";
import { createSolidEntity, createSolidGeometryInitial, type SolidEntity } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { CUBE_COLORS, createCubeHistory, type CubeOperation } from "@/features/tools/spatial-lab/cube-structures-contract";
import type { CubeMoveInteraction } from "@/features/tools/spatial-lab/cube-structures-drag-controller";
import type { VoxelModelCanvasProps } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";

const captured = vi.hoisted(() => ({ interaction: null as CubeMoveInteraction | null }));
vi.mock("three", async () => { const { createRequire } = await import("node:module"); return createRequire(import.meta.url)("three"); });
// 保留工具实际适配器、几何拾取和预览；仅隔离 WebGL、相机和 DOM 手柄绘制。
vi.mock("@react-three/fiber", async (original) => ({ ...await original<object>(), Canvas: ({ children }: { children: ReactNode }) => children }));
vi.mock("@react-three/drei", async (original) => ({ ...await original<object>(), Html: () => null }));
vi.mock("@/features/spatial-math/renderer-r3f/SpatialCameraRig", () => ({ SpatialCameraRig: () => null }));
vi.mock("@/features/spatial-math/renderer-r3f/VoxelCanvas", async (original) => ({ ...await original<object>(), VoxelModelCanvas: ({ sceneOverlay }: VoxelModelCanvasProps) => sceneOverlay }));
vi.mock("@/features/tools/spatial-lab/CubeMoveHandles", () => ({ CubeMoveHandles: ({ interaction }: { interaction: CubeMoveInteraction }) => { captured.interaction = interaction; return null; } }));
vi.mock("@/features/tools/spatial-interaction/SpatialRotationControls", () => ({ SpatialRotationControls: () => null }));
vi.mock("@/features/tools/spatial-interaction/SpatialRollControls", () => ({ SpatialRollControls: () => null }));
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ fillRect() {}, beginPath() {}, arc() {}, fill() {}, createRadialGradient: () => ({ addColorStop() {} }) }) as unknown as CanvasRenderingContext2D);
  captured.interaction = null;
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  extend({ Group: THREE.Group, Mesh: THREE.Mesh, BoxGeometry: THREE.BoxGeometry, PlaneGeometry: THREE.PlaneGeometry,
    MeshBasicMaterial: THREE.MeshBasicMaterial, MeshPhysicalMaterial: THREE.MeshPhysicalMaterial, MeshStandardMaterial: THREE.MeshStandardMaterial,
    AmbientLight: THREE.AmbientLight, DirectionalLight: THREE.DirectionalLight, HemisphereLight: THREE.HemisphereLight });
  const canvas = document.createElement("canvas"), root = createRoot(canvas);
  const gl = { domElement: canvas, setSize() {}, setPixelRatio() {}, render() {}, xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as THREE.WebGLRenderer;
  await root.configure({ gl, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never", dpr: 1 });
  const scene = () => _roots.get(canvas)!.store.getState().scene;
  const render = async (element: ReactNode) => { await act(async () => root.render(element)); scene().updateMatrixWorld(true); };
  const body = () => { const interaction = captured.interaction?.bodyGesture; expect(interaction).toBeDefined(); expect(interaction!.plane).toBe("table"); expect(interaction!.freeRotation).toBe(false); return interaction!; };
  const hit = (position: { x: number; y: number; z: number }) => {
    scene().updateMatrixWorld(true);
    const direction = new THREE.Vector3(3, 5, 7).normalize(), point = new THREE.Vector3(position.x, position.y, position.z);
    const target = body().pick(new THREE.Raycaster(point.clone().addScaledVector(direction, 10), direction.negate()));
    expect(target).not.toBeNull(); return target!;
  };
  cleanups.push(async () => { await act(async () => root.unmount()); });
  return { render, scene, body, hit };
}
const noop = () => {};
describe("current rigid tools bind the shared body contract, not only shared icons", () => {
  it("dice pick the actual unselected surface and preview both XZ axes without changing face offsets", async () => {
    const rig = await setup(), dice = createDiceScene().dice, commit = vi.fn<(die: TeachingDie) => boolean>(() => true);
    dice[1].offsets = { "y-": 0.9 };
    const props: ComponentProps<typeof DiceTeachingCanvas> = { dice, trail: [], selectedId: dice[0].id, selectionActive: false, locale: "en", tool: "orbit", arrows: false,
      busy: false, grid: false, axes: false, floor: false, xrayTarget: null, onClearXRay: noop, onXRayPresentation: noop,
      frame: { center: { x: 0, y: 0, z: 0 }, radius: 4 }, view: "angle", cameraKey: 0, snap: false, moveAxis: "x", onMoveAxis: noop, onDragCommit: noop,
      onMoveUnavailable: noop, onSelect: noop, onFace: noop, onMoveFace: noop, onTransform: commit };
    await rig.render(createElement(DiceTeachingCanvas, props));
    expect(rig.body().handles).toBeUndefined(); const body = rig.body(), target = rig.hit(dice[1].position);
    expect(target.pose.id).toBe(dice[1].id); expect(target.grabPoint).not.toEqual(target.pose.position);
    const pose = { ...target.pose, position: { x: 1.31, y: 0.5, z: 0.27 } }, landing = body.resolve(target, pose, "translate");
    expect(landing.valid).toBe(true); expect(landing.pose.position).toEqual(pose.position);
    await act(async () => body.onPreview({ target, pose, landing: landing.pose, valid: true, phase: "drag" }));
    const moved = rig.scene().children.flatMap((group) => group.children).find((group) => group.userData.spatialObjectId === dice[1].id)!;
    expect(moved.position.toArray()).toEqual([1.31, 0.5, 0.27]); expect(commit).not.toHaveBeenCalled();
    expect(landing.apply()).toBe(true); expect(commit.mock.lastCall![0]).toMatchObject({ id: dice[1].id, position: pose.position, offsets: { "y-": 0.9 } });
    expect(dice[1].position).toEqual({ x: 1, y: 0.5, z: 0 });
    const blocked = body.resolve(target, { ...pose, position: dice[0].position }, "translate"); expect(blocked.valid).toBe(false);
    await act(async () => body.onPreview(null));
    await rig.render(createElement(DiceTeachingCanvas, { ...props, snap: true }));
    const snapped = rig.body().resolve(rig.hit(dice[1].position), { ...pose, position: { x: 1.8, y: 0.5, z: 0.7 } }, "translate");
    expect(snapped.pose.position).toEqual({ x: 2, y: 0.5, z: 1 });
  });
  it("solid geometry can pick and translate with no selected entity, including fractional coordinates", async () => {
    const rig = await setup(), state = createSolidGeometryInitial(), commit = vi.fn<(entity: SolidEntity) => boolean>(() => true);
    state.entities = [createSolidEntity("sphere", "sphere", { x: 4, y: 2, z: 0 })]; state.selectedId = null; state.axes = false;
    await rig.render(createElement(SolidGeometryCanvas, { state, entities: state.entities, selectedId: null, selectionActive: false, objectManipulation: true, frame: { center: { x: 0, y: 0, z: 0 }, radius: 4 },
      cameraRevision: 0, axisSnap: false, moveSnap: false, navigationMode: "orbit", moveAxis: "x", onMoveAxis: noop, onMove: noop, onDragging: noop, fallback: "", onTransform: commit }));
    const body = rig.body(), target = rig.hit(state.entities[0].position);
    expect(target.pose.id).toBe("sphere"); expect(body.selected).toBeNull();
    const pose = { ...target.pose, position: { x: 4.23, y: 2, z: -0.37 } }, landing = body.resolve(target, pose, "translate");
    expect(landing.valid).toBe(true); expect(landing.pose.position).toEqual(pose.position);
    await act(async () => body.onPreview({ target, pose, landing: landing.pose, valid: true, phase: "drag" }));
    expect(rig.scene().getObjectByName("solid:sphere")!.position.toArray()).toEqual([4.23, 2, -0.37]);
    landing.apply(); expect(commit.mock.lastCall![0]).toMatchObject({ id: "sphere", position: pose.position });
  });
  it("cube structures translate the picked group atomically, not the previously selected group", async () => {
    const rig = await setup(), history = createCubeHistory([{ x: -3, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]), state = history.initial;
    const commit = vi.fn<(operations: readonly CubeOperation[]) => typeof history>(() => history);
    const scene: ComponentProps<typeof CubeStructuresViewport>["scene"] = { state, cut: null, cutLines: [], cutConfirmation: null, annotation: { shape: "circle", placement: "face", color: CUBE_COLORS[0], value: 1 }, tool: "orbit", face: null,
      ground: null, origin: null, axesVisible: false, axisLength: 4, validBuild: false, onGroundHover: noop, onGroundClick: noop };
    const interaction: CubeMoveInteraction = { state, ids: ["cube-1"], scopeIds: state.cubes.map((cube) => cube.id), showHandles: false, kind: "move", axis: "x", snapToGrid: true,
      idsForHit: (id) => id === "cube-1" ? [id] : ["cube-2", "cube-3"], onAxisChange: noop, onSelect: noop, onCommit: noop, onUnavailable: noop };
    await rig.render(createElement(CubeStructuresViewport, { scene, sceneKey: state, onMovingChange: noop, moveInteraction: interaction, cutInteraction: null, opacityPreview: null,
      model: { cells: [] } as unknown as VoxelModelCanvasProps["model"], messages: {} as VoxelModelCanvasProps["messages"], onTransformOperations: commit }));
    const body = rig.body(), target = rig.hit({ x: 2, y: 0, z: 0 });
    expect(target.pose.id).toBe("cube-3"); expect(target.pose.position).toEqual({ x: 1.5, y: 0, z: 0 });
    const pose = { ...target.pose, position: { x: 2.6, y: 0, z: 1.8 } }, landing = body.resolve(target, pose, "translate");
    expect(landing.valid).toBe(true); expect(landing.pose.position).toEqual({ x: 2.5, y: 0, z: 2 });
    await act(async () => { expect(landing.apply()).toBe(true); });
    expect(commit).toHaveBeenCalledTimes(1); expect(commit.mock.lastCall![0]).toEqual([
      { kind: "move", ids: ["cube-2", "cube-3"], axis: "x", distance: 1 }, { kind: "move", ids: ["cube-2", "cube-3"], axis: "z", distance: 2 },
    ]);
  });
});
