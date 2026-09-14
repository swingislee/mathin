import { createElement, Fragment, useState } from "react";
import { act, advance, createRoot, events, extend, _roots } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest } from "@/features/spatial-math/domain";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import { CubeNetCutInteraction } from "@/features/tools/spatial-lab/CubeNetCutInteraction";
import { createCubeNetWorkbenchResolver, frameCubeNetWorkbench } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { cubeNetCutEdges } from "@/features/tools/spatial-lab/cube-net-cutting";
import { useCubeNetPlayback } from "@/features/tools/spatial-lab/useCubeNetPlayback";

vi.mock("three", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("three");
});
class Surface extends EventTarget {
  style = { touchAction: "" };
  clientWidth = 800; clientHeight = 600;
  ownerDocument = Object.assign(new EventTarget(), { documentElement: { clientLeft: 0, clientTop: 0 } });
  captures = new Set<number>();
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
  getRootNode() { return this.ownerDocument; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function setup() {
  extend({ Mesh: THREE.Mesh, MeshBasicMaterial: THREE.MeshBasicMaterial, Group: THREE.Group, CylinderGeometry: THREE.CylinderGeometry });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    devicePixelRatio: 1, pageXOffset: 0, pageYOffset: 0,
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const surface = new Surface(), canvas = surface as unknown as HTMLCanvasElement;
  const renderer = { domElement: canvas, setSize() {}, setPixelRatio() {}, render() {},
    xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }),
  } as unknown as THREE.WebGLRenderer;
  const root = createRoot(canvas);
  await root.configure({ gl: renderer, events, size: { width: 800, height: 600, top: 0, left: 0 }, frameloop: "never", dpr: 1 });
  const state = () => _roots.get(canvas)!.store.getState();
  const frame = () => { advance(performance.now() / 1000, false, state()); state().scene.updateMatrixWorld(true); };
  cleanups.push(async () => { await act(async () => { root.unmount(); }); });
  const pointer = async (type: string, point: { x: number; y: number }, pointerType = "mouse") => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pageX: point.x, pageY: point.y, clientX: point.x, clientY: point.y, offsetX: point.x, offsetY: point.y,
      button: 0, buttons: type === "pointerup" || type === "click" ? 0 : 1, pointerType, pointerId: 1, isPrimary: true,
    });
    await act(async () => { surface.dispatchEvent(event); if (type !== "pointerdown") surface.ownerDocument.dispatchEvent(event); }); frame();
  };
  const clock = async (timestamp: number) => {
    const callbacks = [...frames.values()]; frames.clear();
    await act(async () => { callbacks.forEach((callback) => callback(timestamp)); });
  };
  return { root, state, frame, pointer, clock, frames };
}

describe("edge cutting and teaching playback input lifecycle", () => {
  for (const pointerType of ["mouse", "touch"]) it(`${pointerType}: clicks cut and restore an edge, drags orbit, and hidden edges stay occluded`, async () => {
    const rig = await setup();
    const entry = createCubeNetGalleryCatalog().entries.find((item) => item.classification === "legal")!;
    const build = await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id));
    const angles = Object.fromEntries(build.sceneInput.hingeGraph.hinges.map((hinge) => [hinge.edgeId, 90]));
    const closed = createCubeNetWorkbenchResolver(build, "zh").resolve(angles).model;
    const model = frameCubeNetWorkbench(closed, closed.bounds, "angle");
    const toggles = vi.fn();
    const transition = vi.fn();
    function Harness() {
      const [cuts, setCuts] = useState<readonly string[]>([]);
      return createElement(Fragment, null,
        createElement(SpatialCameraRig, { bookmark: model.camera, radius: model.bounds.radius, interactive: true, navigationMode: "orbit", onTransitionStateChange: transition }),
        createElement(CubeNetCutInteraction, { model, edges: cubeNetCutEdges(build.sceneInput, model, cuts),
          onToggle: (id) => { toggles(id); setCuts((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); },
        }),
      );
    }
    await act(async () => { rig.root.render(createElement(Harness)); }); rig.frame();
    const targets = cubeNetCutEdges(build.sceneInput, model, []).map((edge) => {
      const projected = new THREE.Vector3((edge.start.x + edge.end.x) / 2, (edge.start.y + edge.end.y) / 2, (edge.start.z + edge.end.z) / 2).project(rig.state().camera);
      rig.state().raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), rig.state().camera);
      const first = rig.state().raycaster.intersectObjects(rig.state().scene.children, true)[0];
      return { id: edge.edgeId, visible: first?.object.userData.cubeNetCutEdge === edge.edgeId, point: { x: (projected.x + 1) * 400, y: (1 - projected.y) * 300 } };
    });
    const visible = targets.find((target) => target.visible)!, hidden = targets.find((target) => !target.visible)!;
    expect(visible).toBeTruthy(); expect(hidden).toBeTruthy();
    for (let repeat = 0; repeat < 2; repeat++) {
      await rig.pointer("pointerdown", visible.point, pointerType); await rig.pointer("pointerup", visible.point, pointerType); await rig.pointer("click", visible.point, pointerType);
    }
    expect(toggles.mock.calls.map(([id]) => id)).toEqual([visible.id, visible.id]);
    await rig.pointer("pointerdown", hidden.point, pointerType); await rig.pointer("pointerup", hidden.point, pointerType); await rig.pointer("click", hidden.point, pointerType);
    expect(toggles).toHaveBeenCalledTimes(2);
    const orientation = rig.state().camera.quaternion.clone();
    await rig.pointer("pointerdown", visible.point, pointerType);
    const moved = { x: visible.point.x + 90, y: visible.point.y + 30 };
    await rig.pointer("pointermove", moved, pointerType); await rig.pointer("pointerup", moved, pointerType); await rig.pointer("click", moved, pointerType);
    expect(toggles).toHaveBeenCalledTimes(2);
    expect(rig.state().camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.1);
  });

  it("previews only, commits once, cancels on Escape/blur, replaces stale jobs and honors reduced motion", async () => {
    const rig = await setup();
    let playback!: ReturnType<typeof useCubeNetPlayback<number>>;
    function Harness() { playback = useCubeNetPlayback<number>(); return null; }
    await act(async () => { rig.root.render(createElement(Harness)); });
    const finished = vi.fn();
    const job = { durationMs: 100, sample: (elapsed: number) => elapsed, onFinish: finished };
    await act(async () => { playback.start(job); });
    expect(playback.frame).toBe(0); expect(finished).not.toHaveBeenCalled();
    await rig.clock(0); await rig.clock(50); expect(playback.frame).toBe(50);
    await rig.clock(100); expect(finished).toHaveBeenCalledOnce(); expect(playback.playing).toBe(false);
    await rig.clock(200); expect(finished).toHaveBeenCalledOnce();
    for (const type of ["keydown", "blur"]) {
      await act(async () => { playback.start(job); }); await rig.clock(300); await rig.clock(350);
      await act(async () => { window.dispatchEvent(Object.assign(new Event(type), { key: "Escape" })); });
      await rig.clock(500); expect(playback.frame).toBeNull(); expect(finished).toHaveBeenCalledOnce();
    }
    await act(async () => { playback.start(job); });
    const staleCallbacks = [...rig.frames.values()];
    const replacement = vi.fn();
    await act(async () => { playback.start({ ...job, onFinish: replacement }); staleCallbacks.forEach((callback) => callback(1000)); });
    await rig.clock(1100); await rig.clock(1200);
    expect(replacement).toHaveBeenCalledOnce(); expect(finished).toHaveBeenCalledOnce();
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    await act(async () => { playback.start(job); });
    expect(finished).toHaveBeenCalledTimes(2); expect(playback.frame).toBeNull();
  });
});
