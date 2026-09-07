import { createElement, Fragment } from "react";
import { act, createRoot, extend, _roots } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { WebGLRenderLists } from "three/src/renderers/webgl/WebGLRenderLists.js";
import { WebGLProperties } from "three/src/renderers/webgl/WebGLProperties.js";
import { VoxelEdgeInstances } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import { CubeStructuresScene } from "@/features/tools/spatial-lab/CubeStructuresScene";
import { buildCubeStructureRenderModel, createCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import { buildCubeCutGeometry } from "@/features/tools/spatial-lab/cube-structures-cut-picking";
import { cubeToolCursor } from "@/features/tools/spatial-lab/cube-structures-cursor";

vi.mock("three", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("three");
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });

async function renderScene(tool: "cut" | "orbit" | "pan") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => undefined);
  extend({ Group: THREE.Group, InstancedMesh: THREE.InstancedMesh, BoxGeometry: THREE.BoxGeometry, MeshBasicMaterial: THREE.MeshBasicMaterial });
  const state = createCubeHistory([{ x: 0, y: 0, z: 0 }]).initial;
  const model = buildCubeStructureRenderModel(state, [], "Cut visibility");
  const line = buildCubeCutGeometry(state).lines.find((line) => line.along === "y" && line.start.x === 0.5 && line.start.z === 0.5)!;
  const surface = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
  const gl = { domElement: surface, setSize() {}, setPixelRatio() {}, render() {}, xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as THREE.WebGLRenderer;
  const root = createRoot(surface);
  await root.configure({ gl, size: { width: 800, height: 600, left: 0, top: 0 }, frameloop: "never", dpr: 1 });
  cleanups.push(async () => { await act(async () => root.unmount()); });
  await act(async () => root.render(createElement(Fragment, null,
    createElement(VoxelEdgeInstances, { model, hiddenEdgeUniforms: null }),
    createElement(CubeStructuresScene, {
      state, tool, cut: null, cutLines: [line], cutConfirmation: null,
      annotation: { shape: "circle", placement: "face", color: "#8fbf88", value: 1 },
      face: null, ground: null, origin: null, axesVisible: false, axisLength: 3, validBuild: false,
      onGroundHover() {}, onGroundClick() {},
    }),
  )));
  return _roots.get(surface)!.store.getState().scene;
}

function opaqueDrawOrder(scene: THREE.Scene) {
  const lists = new WebGLRenderLists(new WebGLProperties());
  const list = lists.get(scene, 0);
  // 与 WebGLRenderer 一致地传递最近 Group 的顺序，实际排序交给 Three。
  const visit = (object: THREE.Object3D, groupOrder = 0) => {
    if (object instanceof THREE.Group) groupOrder = object.renderOrder;
    if (object instanceof THREE.Mesh && !Array.isArray(object.material)) {
      list.push(object, object.geometry, object.material, groupOrder, 0, null);
    }
    for (const child of object.children) visit(child, groupOrder);
  };
  visit(scene);
  list.sort(null!, null!, false);
  const objects = list.opaque.map((item) => item.object);
  lists.dispose();
  return objects;
}

describe("cut lines remain visible over the rendered bars", () => {
  it.each(["cut", "orbit", "pan"] as const)("draws the real highlight after the opaque bars while using %s", async (tool) => {
    const scene = await renderScene(tool);
    const group = scene.getObjectByName("cube-cut-lines")!;
    const line = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    expect(line.material.depthTest).toBe(false);
    expect(line.material.depthWrite).toBe(false);
    const order = opaqueDrawOrder(scene);
    const bars = order.filter((object) => object instanceof THREE.InstancedMesh);
    expect(bars).toHaveLength(3);
    expect(order.indexOf(line)).toBeGreaterThan(Math.max(...bars.map((bar) => order.indexOf(bar))));
    // 旧实现仅设置 Line.renderOrder；默认组顺序会让黑棱边再次盖住它。
    group.renderOrder = 0;
    const oldOrder = opaqueDrawOrder(scene);
    expect(oldOrder.indexOf(line)).toBeLessThan(Math.min(...bars.map((bar) => oldOrder.indexOf(bar))));
  });

  it("places the cut cursor hotspot at its visible lower-left pencil tip", () => {
    expect(cubeToolCursor("cut")).toMatch(/\) 4 21, crosshair$/);
    expect(cubeToolCursor("select")).toMatch(/\) 4 4, crosshair$/);
    expect(cubeToolCursor("orbit")).toBe("grab");
  });
});
