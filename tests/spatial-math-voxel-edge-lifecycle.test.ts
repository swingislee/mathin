import { createElement } from "react";
import { act, createRoot, extend, _roots } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { VoxelEdgeInstances } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import { buildVoxelEdgeInstances } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import { CUBE_COLORS, applyCubeOperation, buildCubeStructureRenderModel, createCubeHistory, cubeCutOperation, cubeGroupOutlineColor } from "@/features/tools/spatial-lab/cube-structures-contract";
import type { VoxelRenderModel } from "@/features/spatial-math/renderer-r3f/voxel-render-model";

vi.mock("three", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("three");
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });
async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => undefined);
  extend({ Group: THREE.Group, InstancedMesh: THREE.InstancedMesh, BoxGeometry: THREE.BoxGeometry, MeshBasicMaterial: THREE.MeshBasicMaterial });
  const surface = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
  const gl = { domElement: surface, setSize() {}, setPixelRatio() {}, render() {}, xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as THREE.WebGLRenderer;
  const root = createRoot(surface);
  await root.configure({ gl, camera: new THREE.OrthographicCamera(-5, 5, 3.75, -3.75, 0.01, 100), size: { width: 800, height: 600, left: 0, top: 0 }, frameloop: "never", dpr: 1 });
  cleanups.push(async () => { await act(async () => root.unmount()); });
  return async (model: VoxelRenderModel) => {
    await act(async () => root.render(createElement(VoxelEdgeInstances, { model, hiddenEdgeUniforms: null })));
    const meshes: THREE.InstancedMesh[] = [];
    _roots.get(surface)!.store.getState().scene.traverse((object) => { if (object instanceof THREE.InstancedMesh) meshes.push(object); });
    return meshes;
  };
}

describe("real R3F edge instances during separation", () => {
  it("keeps initialized matrices and colors after shared edges split and rejoin", async () => {
    const render = await setup();
    const base = buildCubeStructureRenderModel(createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]).initial, [], "Edges");
    for (const gap of [0, 0.005, 0.1, 1, 2, 0]) {
      const model = { ...base, cells: base.cells.map((cell, index) => ({ ...cell, x: cell.x + (index === 1 ? gap : 0) })) };
      const meshes = await render(model); const expected = buildVoxelEdgeInstances(model.cells);
      expect(meshes).toHaveLength(3);
      meshes.forEach((mesh, axis) => {
        const edges = expected[(["x", "y", "z"] as const)[axis]];
        expect(mesh.count).toBe(edges.length); expect(mesh.instanceColor?.count).toBe(edges.length);
        edges.forEach((edge, index) => {
          const actual = new THREE.Matrix4(); mesh.getMatrixAt(index, actual);
          expect(actual.elements[12]).toBeCloseTo(edge.center.x); expect(actual.elements[13]).toBeCloseTo(edge.center.y); expect(actual.elements[14]).toBeCloseTo(edge.center.z);
          expect(actual.elements[0]).toBeCloseTo(edge.scale.x); expect(actual.elements[5]).toBeCloseTo(edge.scale.y); expect(actual.elements[10]).toBeCloseTo(edge.scale.z);
        });
      });
    }
    const final = await render(base);
    for (const mesh of final) expect(mesh.instanceColor?.count).toBe(mesh.count);
  });

  it("refreshes instance colors when only the outline color changes", async () => {
    const render = await setup();
    const base = buildCubeStructureRenderModel(createCubeHistory([{ x: 0, y: 0, z: 0 }]).initial, [], "Edges");
    for (const edgeColor of ["#334433", "#443333"]) {
      const meshes = await render({ ...base, cells: base.cells.map((cell) => ({ ...cell, emphasis: { color: "#8fbf88", edgeColor, faceOpacity: 0.25, priority: 1 } })) });
      expect(meshes).toHaveLength(3);
      for (const mesh of meshes) {
        const value = new THREE.Color(); mesh.getColorAt(0, value);
        expect("#" + value.getHexString()).toBe(edgeColor);
      }
    }
  });

  it.each(CUBE_COLORS)("keeps outlines distinct when the cut piece and its group both use %s", async (color) => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]).initial;
    const ids = initial.cubes.map((cube) => cube.id);
    const painted = applyCubeOperation(initial, { kind: "color", ids, color });
    const cut = applyCubeOperation(painted, { ...cubeCutOperation(painted, ids, "x", 0, 1, 2, "piece", "Piece")!, color });
    const model = buildCubeStructureRenderModel(cut, [], "Edges", "piece");
    const edgeColor = cubeGroupOutlineColor(color);
    expect(edgeColor).not.toBe(color);
    expect(model.cells.find((cell) => cell.emphasis)?.emphasis).toMatchObject({ color, edgeColor });
    const render = await setup(); const meshes = await render(model);
    const actualColors = meshes.flatMap((mesh) => Array.from({ length: mesh.count }, (_, index) => {
      const value = new THREE.Color(); mesh.getColorAt(index, value); return "#" + value.getHexString();
    }));
    expect(actualColors).toContain(edgeColor); expect(actualColors).not.toContain(color);
  });
});
