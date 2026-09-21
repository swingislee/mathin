import { createElement, Fragment, useCallback, useState } from "react";
import { act, advance, createRoot, events, extend, _roots } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest, type PolyhedronFoldVector3 } from "@/features/spatial-math/domain";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import { CubeNetFoldInteraction } from "@/features/tools/spatial-lab/CubeNetFoldViewport";
import { createCubeNetWorkbenchResolver, frameCubeNetWorkbench } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { beginCubeNetPaperDrag, type CubeNetFoldChange, type CubeNetPaperSelection } from "@/features/tools/spatial-lab/cube-net-fold-drag";
import { createCubeNetTeachingSession, reduceCubeNetTeachingSession } from "@/features/tools/spatial-lab/cube-net-teaching-session";
import { createDefaultPaperFoldingSnapshot } from "@/features/tools/paper-folding/contract";
import { resolvePaperFolding } from "@/features/tools/paper-folding/model";
import { createDefaultSolidNetsSnapshot } from "@/features/tools/solid-nets/contract";
import { resolveSolidNet } from "@/features/tools/solid-nets/model";

type PaperKind = "cube" | "free-paper" | "cuboid" | "triangular-prism";
type PaperFrame = ReturnType<ReturnType<typeof createCubeNetWorkbenchResolver>["resolve"]>;
type PaperResolver = (angles: Readonly<Record<string, number>>, edgeId?: string | null,
  anchor?: CubeNetPaperSelection["anchor"] | null, moving?: readonly string[]) => Pick<PaperFrame, "model" | "hinges">;

async function createPaperFixture(kind: PaperKind) {
  if (kind === "cube") {
    const entry = createCubeNetGalleryCatalog().entries.find((item) => item.classification === "legal")!;
    const build = await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id));
    const resolver = createCubeNetWorkbenchResolver(build, "zh");
    return { resolve: resolver.resolve as PaperResolver, rootFaceId: build.sceneInput.layout.rootFaceId };
  }
  if (kind === "free-paper") {
    const initial = createDefaultPaperFoldingSnapshot();
    const resolve: PaperResolver = (angles, _edgeId, anchor, moving) => resolvePaperFolding({ ...initial, angles: { ...initial.angles, ...angles },
      anchor: anchor ? { ...anchor, vertices: [...anchor.vertices] } : null }, moving);
    return { resolve, rootFaceId: initial.squares[0].id };
  }
  const initial = createDefaultSolidNetsSnapshot(kind);
  const resolve: PaperResolver = (angles, _edgeId, anchor, moving) => resolveSolidNet({ ...initial, angles: { ...initial.angles, ...angles },
    anchor: anchor ? { ...anchor, vertices: [...anchor.vertices] } : null }, moving);
  return { resolve, rootFaceId: "base" };
}

vi.mock("three", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("three");
});

class CanvasSurface extends EventTarget {
  style = { touchAction: "" };
  clientWidth = 800;
  clientHeight = 600;
  ownerDocument = Object.assign(new EventTarget(), { documentElement: { clientLeft: 0, clientTop: 0 } });
  captures = new Set<number>();
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
  getRootNode() { return this.ownerDocument; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) {
    if (this.captures.delete(id)) this.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: id }));
  }
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// 真实 R3F 射线命中、原生指针捕获和 OrbitControls；仅替换 GPU 输出，不启动浏览器。
async function setupPaper(kind: PaperKind = "cube") {
  extend({ Mesh: THREE.Mesh, MeshBasicMaterial: THREE.MeshBasicMaterial, Group: THREE.Group });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    devicePixelRatio: 1, pageXOffset: 0, pageYOffset: 0,
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  }));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const resolver = await createPaperFixture(kind);
  const flat = resolver.resolve({});
  const surface = new CanvasSurface();
  const canvas = surface as unknown as HTMLCanvasElement;
  const renderer = {
    domElement: canvas, setSize() {}, setPixelRatio() {}, render() {},
    xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }),
  } as unknown as THREE.WebGLRenderer;
  const root = createRoot(canvas);
  await root.configure({ gl: renderer, events, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never", dpr: 1 });
  let session = createCubeNetTeachingSession(flat.hinges.map((hinge) => hinge.edgeId));
  let current = flat;
  const starts = vi.fn();
  const commits = vi.fn();
  const transition = vi.fn();
  const draggingChanges = vi.fn();
  type Interaction = { mounted: boolean; tool: "fold" | "orbit"; enabled: boolean };
  let configure!: (next: Partial<Interaction>) => void;
  let isDragging = false;
  let currentPreview: CubeNetFoldChange | null = null;
  function Harness() {
    const [saved, setSaved] = useState(session);
    const [preview, setPreview] = useState<CubeNetFoldChange | null>(null);
    const [active, setActive] = useState<CubeNetPaperSelection | null>(null);
    const [dragging, setDragging] = useState(false);
    const [interaction, setInteraction] = useState<Interaction>({ mounted: true, tool: "fold", enabled: true });
    configure = (next) => setInteraction((previous) => ({ ...previous, ...next }));
    isDragging = dragging; currentPreview = preview;
    const start = useCallback((selection: CubeNetPaperSelection) => { starts(selection); setActive(selection); }, []);
    const commit = useCallback((value: CubeNetFoldChange) => {
      commits(value);
      setSaved((previous) => reduceCubeNetTeachingSession(previous, { kind: "fold", ...value }));
      setPreview(null);
    }, []);
    session = saved;
    current = resolver.resolve(preview ? { ...saved.angles, [preview.edgeId]: preview.degrees } : saved.angles,
      active?.edgeId, preview?.anchor ?? saved.anchor, active?.movingFaceIds);
    const model = frameCubeNetWorkbench(current.model, flat.model.bounds, "angle");
    return createElement(Fragment, null,
      createElement(SpatialCameraRig, { bookmark: model.camera, radius: model.bounds.radius, interactive: !dragging,
        navigationMode: "orbit", onTransitionStateChange: transition }),
      interaction.mounted && createElement(CubeNetFoldInteraction, {
        model, hinges: current.hinges, activeEdgeId: active?.edgeId ?? null, tool: interaction.tool, foldingEnabled: interaction.enabled, locale: "zh",
        axisSnapEnabled: false, axesVisible: false, cameraRequestKey: 0, dragging,
        // 与真实工作台一致：选中、预览和宿主更新都可能提供新的回调引用。
        messages: { webglUnavailable: "", contextLost: "" }, onFoldStart: start, onPreview: (value) => setPreview(value),
        onCommit: (value) => commit(value), onDraggingChange: (value) => { draggingChanges(value); setDragging(value); } }),
    );
  }
  const state = () => _roots.get(canvas)!.store.getState();
  const frame = () => { advance(performance.now() / 1000, false, state()); state().scene.updateMatrixWorld(true); };
  await act(async () => { root.render(createElement(Harness)); });
  frame();
  cleanups.push(async () => { await act(async () => { root.unmount(); }); });
  const project = (point: PolyhedronFoldVector3) => {
    const projected = new THREE.Vector3(point.x, point.y, point.z).project(state().camera);
    return { x: (projected.x + 1) * 400, y: (1 - projected.y) * 300 };
  };
  const pointer = async (type: string, point: { x: number; y: number }, pointerType = "mouse") => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pageX: point.x, pageY: point.y, clientX: point.x, clientY: point.y, offsetX: point.x, offsetY: point.y,
      button: 0, buttons: type === "pointerup" ? 0 : 1, pointerType, pointerId: 1, isPrimary: true,
    });
    await act(async () => {
      surface.dispatchEvent(event);
      if (type !== "pointerdown") surface.ownerDocument.dispatchEvent(event);
    });
    frame();
  };
  return { surface, state, pointer, project, starts, commits, draggingChanges, dragging: () => isDragging, preview: () => currentPreview,
    configure: async (next: Partial<Interaction>) => { await act(async () => configure(next)); frame(); },
    current: () => current, session: () => session, rootFaceId: resolver.rootFaceId };
}

describe("one-gesture paper folding and empty-space observation", () => {
  for (const kind of ["cube", "free-paper", "cuboid", "triangular-prism"] as const) for (const pointerType of ["mouse", "touch"]) {
    it(`${kind}/${pointerType}: keeps folding through callback refreshes and then observes from empty space`, async () => {
      const rig = await setupPaper(kind);
      const current = rig.current();
      const face = current.model.faces.find((item) => item.faceId === rig.rootFaceId)!;
      const initial = rig.project(face.centroid);
      const gesture = beginCubeNetPaperDrag(face, current.model.faces, current.hinges, face.centroid, initial, rig.project)!;
      const orientation = rig.state().camera.quaternion.clone();
      await rig.pointer("pointerdown", initial, pointerType);
      expect(rig.starts).toHaveBeenCalledOnce();
      expect(rig.starts.mock.calls[0][0].faceId).toBe(face.faceId);
      expect(rig.surface.hasPointerCapture(1)).toBe(true);
      for (const degrees of [10, 20, 30, 40]) await rig.pointer("pointermove", gesture.samples.find((sample) => sample.degrees === degrees)!.point, pointerType);
      expect(rig.state().camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
      expect(rig.commits).not.toHaveBeenCalled();
      await rig.pointer("pointerup", gesture.samples.find((sample) => sample.degrees === 40)!.point, pointerType);
      expect(rig.commits).toHaveBeenCalledOnce();
      expect(rig.session().angles[gesture.edgeId]).toBe(40);
      expect(rig.session().past).toHaveLength(1);
      expect(rig.surface.hasPointerCapture(1)).toBe(false);
      expect(rig.dragging()).toBe(false);
      expect(rig.draggingChanges.mock.calls.map(([value]) => value)).toEqual([true, false]);
      await rig.pointer("pointerdown", { x: 30, y: 40 }, pointerType);
      await rig.pointer("pointermove", { x: 110, y: 65 }, pointerType);
      await rig.pointer("pointerup", { x: 110, y: 65 }, pointerType);
      expect(rig.state().camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.1);
      expect(rig.commits).toHaveBeenCalledOnce();
    });
  }

  for (const reason of ["pointercancel", "lostpointercapture", "blur", "mode", "disabled", "unmount"] as const) {
    it(`${reason}: clears preview and dragging without committing, and releases empty-space observation`, async () => {
      const rig = await setupPaper();
      const current = rig.current(), face = current.model.faces[0], initial = rig.project(face.centroid);
      const gesture = beginCubeNetPaperDrag(face, current.model.faces, current.hinges, face.centroid, initial, rig.project)!;
      await rig.pointer("pointerdown", initial);
      await rig.pointer("pointermove", gesture.samples.find((sample) => sample.degrees === 35)!.point);
      expect(rig.dragging()).toBe(true);
      expect(rig.preview()).not.toBeNull();
      if (reason === "mode") await rig.configure({ tool: "orbit" });
      else if (reason === "disabled") await rig.configure({ enabled: false });
      else if (reason === "unmount") await rig.configure({ mounted: false });
      else if (reason === "blur") await act(async () => window.dispatchEvent(new Event("blur")));
      else if (reason === "lostpointercapture") await act(async () => rig.surface.releasePointerCapture(1));
      else await rig.pointer("pointercancel", initial);
      expect(rig.commits).not.toHaveBeenCalled();
      expect(rig.preview()).toBeNull();
      expect(rig.dragging()).toBe(false);
      expect(rig.draggingChanges.mock.calls.map(([value]) => value)).toEqual([true, false]);
      expect(rig.surface.hasPointerCapture(1)).toBe(false);
      const orientation = rig.state().camera.quaternion.clone();
      await rig.pointer("pointerdown", { x: 30, y: 40 });
      await rig.pointer("pointermove", { x: 110, y: 65 });
      await rig.pointer("pointerup", { x: 110, y: 65 });
      expect(rig.state().camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.1);
    });
  }

  it("taps do not fold; Escape restores paper and releases the camera for the next blank-space drag", async () => {
    const rig = await setupPaper();
    const current = rig.current();
    const face = current.model.faces[0];
    const initial = rig.project(face.centroid);
    await rig.pointer("pointerdown", initial);
    await rig.pointer("pointerup", initial);
    expect(rig.commits).not.toHaveBeenCalled();
    const gesture = beginCubeNetPaperDrag(face, current.model.faces, current.hinges, face.centroid, initial, rig.project)!;
    await rig.pointer("pointerdown", initial);
    await rig.pointer("pointermove", gesture.samples.find((sample) => sample.degrees === 35)!.point);
    await act(async () => { window.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" })); });
    expect(rig.commits).not.toHaveBeenCalled();
    expect(rig.session().anchor).toBeNull();
    expect(rig.surface.hasPointerCapture(1)).toBe(false);
    await rig.pointer("pointerup", initial);
    const orientation = rig.state().camera.quaternion.clone();
    await rig.pointer("pointerdown", { x: 30, y: 40 });
    await rig.pointer("pointermove", { x: 110, y: 65 });
    await rig.pointer("pointerup", { x: 110, y: 65 });
    expect(rig.state().camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.1);
  });
});
