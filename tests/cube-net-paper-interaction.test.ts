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
async function setupPaper() {
  extend({ Mesh: THREE.Mesh, MeshBasicMaterial: THREE.MeshBasicMaterial, Group: THREE.Group });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    devicePixelRatio: 1, pageXOffset: 0, pageYOffset: 0,
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  }));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const entry = createCubeNetGalleryCatalog().entries.find((item) => item.classification === "legal")!;
  const build = await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id));
  const resolver = createCubeNetWorkbenchResolver(build, "zh");
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
  function Harness() {
    const [saved, setSaved] = useState(session);
    const [preview, setPreview] = useState<CubeNetFoldChange | null>(null);
    const [active, setActive] = useState<CubeNetPaperSelection | null>(null);
    const [dragging, setDragging] = useState(false);
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
      createElement(CubeNetFoldInteraction, { scene: build.page.scene, entityId: build.sceneInput.entityId,
        model, hinges: current.hinges, activeEdgeId: active?.edgeId ?? null, tool: "fold", locale: "zh",
        axisSnapEnabled: false, axesVisible: false, cameraRequestKey: 0, dragging,
        messages: { webglUnavailable: "", contextLost: "" }, onFoldStart: start, onPreview: setPreview,
        onCommit: commit, onDraggingChange: setDragging }),
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
  return { surface, state, pointer, project, starts, commits, current: () => current, session: () => session, rootFaceId: build.sceneInput.layout.rootFaceId };
}

describe("one-gesture paper folding and empty-space observation", () => {
  for (const pointerType of ["mouse", "touch"]) {
    it(`${pointerType}: directly folds A, then rotates from empty space without switching tools`, async () => {
      const rig = await setupPaper();
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
      await rig.pointer("pointerdown", { x: 30, y: 40 }, pointerType);
      await rig.pointer("pointermove", { x: 110, y: 65 }, pointerType);
      await rig.pointer("pointerup", { x: 110, y: 65 }, pointerType);
      expect(rig.state().camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.1);
      expect(rig.commits).toHaveBeenCalledOnce();
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
