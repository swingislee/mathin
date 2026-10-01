import { createElement, type ReactElement, type ReactNode } from "react";
import { act, createRoot, extend, _roots } from "@react-three/fiber";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { PlaceValueBoxScene } from "@/features/tools/place-value/PlaceValueBoxScene";
import { PlaceValueRodMesh } from "@/features/tools/place-value/PlaceValueRodMesh";
import { VoxelGeometry } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import { createDefaultPlaceValueInitial, createPlaceValueBoard, placeValueSnapshot } from "@/features/tools/place-value/radix-contract";
import { placeValueColumn, placeValueLayout, placeValueOffset } from "@/features/tools/place-value/radix-model";
import { placeValueMessages } from "@/features/tools/place-value/messages";
import { PLACE_VALUE_SELECTION_LIGHT, PLACE_VALUE_SELECTION_LIGHTENING } from "@/features/tools/place-value/color-policy";
import { CUBE_AXIS_COLORS, CUBE_COLORS, CUBE_SELECTION_COLOR, buildCubeStructureRenderModel, createCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import { VOXEL_EDGE_COLOR } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";

vi.mock("three", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("three");
});
vi.mock("@react-three/drei", () => ({ Line: (props: object) => createElement("group", { name: "case-line", userData: props }) }));
vi.mock("@/features/tools/spatial-interaction/SpatialSurfaceLabel", () => ({
  SpatialSurfaceLabel: ({ text, position }: { text: string; position: [number, number, number] }) => createElement("group", { name: "case-label", position, userData: { text } }),
}));
vi.mock("@/features/tools/spatial-interaction/SpatialObjectToolbar", () => ({
  SpatialObjectToolbar: ({ children, ...props }: { children?: ReactNode }) => createElement("group", { name: "object-toolbar", userData: props }, children),
}));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });
async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => undefined);
  extend({ Group: THREE.Group, Mesh: THREE.Mesh, PlaneGeometry: THREE.PlaneGeometry, BoxGeometry: THREE.BoxGeometry,
    InstancedMesh: THREE.InstancedMesh, MeshBasicMaterial: THREE.MeshBasicMaterial, ShaderMaterial: THREE.ShaderMaterial });
  const surface = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) }) as unknown as HTMLCanvasElement;
  const gl = { domElement: surface, setSize() {}, setPixelRatio() {}, render() {}, xr: Object.assign(new EventTarget(), { isPresenting: false, setAnimationLoop() {} }) } as unknown as THREE.WebGLRenderer;
  const root = createRoot(surface);
  await root.configure({ gl, camera: new THREE.OrthographicCamera(-15, 15, 12, -12, .01, 1000), size: { width: 800, height: 600, left: 0, top: 0 }, frameloop: "never", dpr: 1 });
  cleanups.push(async () => { await act(async () => root.unmount()); });
  return async (element: ReactElement) => {
    await act(async () => root.render(element));
    return _roots.get(surface)!.store.getState().scene;
  };
}
const initial = (base: number, count: number) => placeValueSnapshot({ ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(count, "ones", base, 6), right: createPlaceValueBoard(0, "normal", base, 6), presentation: { strategy: "boxes", contents: "inside" } });
const sceneElement = (snapshot: ReturnType<typeof initial>, locale: "zh" | "en" = "zh") => createElement(PlaceValueBoxScene, { snapshot, locale, progress: 1, contentsProgress: 1, selected: true, interactive: true, onSelect: vi.fn() });
const named = (parent: THREE.Object3D, name: string) => {
  const result: THREE.Object3D[] = []; parent.traverse((object) => { if (object.name === name) result.push(object); }); return result;
};

describe("place-value case capacity and selection rendering", () => {
  it.each([2, 10, 16])("keeps the case mesh at base minus one and labels the protruding units in base %i", async (base) => {
    const render = await setup();
    for (const locale of ["zh", "en"] as const) for (const count of [base - 1, base, base + 1]) {
      const scene = await render(sceneElement(initial(base, count), locale));
      const cases = named(scene, "place-value-front-case"), first = cases[0], capacity = base - 1;
      expect(cases).toHaveLength(6);
      for (const container of cases) {
        const back = container.children.find((object) => object instanceof THREE.Mesh) as THREE.Mesh<THREE.PlaneGeometry>;
        expect(back.geometry.parameters.height).toBe(capacity);
        expect(back.position.y).toBe(capacity / 2);
        const frame = container.children.filter((object) => object.name === "case-line");
        expect(frame).toHaveLength(1);
        expect(frame[0].userData).toMatchObject({ color: VOXEL_EDGE_COLOR, opacity: .22, lineWidth: 1, segments: true });
        expect(frame[0].userData.points).toHaveLength(16); // 八条柜边与原底座分开，省去重复的四条底边。
        expect(new Set(frame[0].userData.points.map((point: number[]) => point[1]))).toEqual(new Set([0, capacity]));
        expect(container.children.some((object) => object.name === "case-label")).toBe(false);
      }
      const overflow = named(first, "place-value-case-overflow");
      expect(overflow).toHaveLength(count >= base ? 1 : 0);
      if (count >= base) {
        const bracket = named(overflow[0], "case-line").find((line) => line.userData.points.length === 4)!.userData;
        expect(bracket.color).toBe(CUBE_AXIS_COLORS.x);
        expect(bracket.lineWidth).toBe(2.5);
        expect(bracket.points.map((point: number[]) => point[1])).toEqual([capacity, capacity, count, count]);
        expect(named(overflow[0], "case-label")[0].userData.text).toBe(placeValueMessages(locale).boxOverflow(count - capacity));
      }
    }
  });

  it("anchors context actions to the selected counting box across inside, outside and comparison views", async () => {
    const render = await setup();
    const state = placeValueSnapshot({ ...createDefaultPlaceValueInitial(), mode: "compare", active: "right", left: createPlaceValueBoard(33), right: createPlaceValueBoard(33), presentation: { strategy: "boxes", contents: "inside" } });
    state.selection = { side: "right", unit: state.right.places[1][1][0].start };
    const x = placeValueColumn(1, state.right.places.length) + placeValueOffset("compare", "right", state.right.places.length);
    const center = { x, y: 1.5, z: 0 };
    for (const contents of ["inside", "outside", "both"] as const) {
      const scene = await render(createElement(PlaceValueBoxScene, { snapshot: { ...state, presentation: { strategy: "boxes", contents } }, locale: "zh", progress: 1, contentsProgress: 1,
        selected: true, interactive: true, onSelect: vi.fn(), selectionActions: createElement("group", { name: "box-actions" }) }));
      const toolbar = named(scene, "object-toolbar");
      expect(toolbar).toHaveLength(1);
      expect(toolbar[0].userData).toMatchObject({ center, preferredSide: "right", moveHandles: { center, axes: [] } });
      expect(toolbar[0].userData.vertices).toHaveLength(24);
      expect(Math.min(...toolbar[0].userData.vertices.map((point: { x: number }) => point.x))).toBe(x - .5);
      expect(named(toolbar[0], "box-actions")).toHaveLength(1);
    }
    const cleared = await render(createElement(PlaceValueBoxScene, { snapshot: state, locale: "en", progress: 1, contentsProgress: 1, selected: false, interactive: true, onSelect: vi.fn(), selectionActions: createElement("group") }));
    expect(named(cleared, "object-toolbar")).toHaveLength(0);
  });

  it("keeps selection and pending-red attributes separate while both box materials retain dark outlines", async () => {
    const render = await setup(), state = initial(10, 10);
    state.selection = { side: "left", unit: state.left.places[0][9][0].start };
    const scene = await render(sceneElement(state));
    for (const name of ["place-value-box-contents", "place-value-box-shells"]) {
      const mesh = scene.getObjectByName(name) as THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      expect(mesh.geometry.getAttribute("appearance").getY(9)).toBe(1);
      expect(mesh.geometry.getAttribute("appearance").getZ(9)).toBe(1);
      expect("#" + mesh.material.uniforms.edge.value.getHexString()).toBe(VOXEL_EDGE_COLOR);
      expect(mesh.material.fragmentShader).toContain("vec3 color = mix(surface, edge,");
      expect("#" + mesh.material.uniforms.selectionLight.value.getHexString()).toBe(PLACE_VALUE_SELECTION_LIGHT);
      expect(mesh.material.fragmentShader).toContain(`selectionLight, ${PLACE_VALUE_SELECTION_LIGHTENING.toFixed(2)} * a.z`);
      expect(mesh.material.fragmentShader).not.toContain("selectionBand");
      expect(mesh.material.fragmentShader).not.toContain("mix(edge, selected");
    }
    expect(named(scene, "spatial-selection-outline")).toHaveLength(0);
    const box = scene.getObjectByName("place-value-box-shells") as THREE.InstancedMesh;
    const selectedMatrix = new THREE.Matrix4(); box.getMatrixAt(9, selectedMatrix);
    const cleared = await render(createElement(PlaceValueBoxScene, { snapshot: state, locale: "zh", progress: 1, contentsProgress: 1, selected: false, interactive: true, onSelect: vi.fn() }));
    expect(named(cleared, "spatial-selection-outline")).toHaveLength(0);
    const clearedBox = cleared.getObjectByName("place-value-box-shells") as THREE.InstancedMesh;
    expect(clearedBox.geometry.getAttribute("appearance").getZ(9)).toBe(0);
    expect(clearedBox.geometry.getAttribute("appearance").getY(9)).toBe(1);
    const clearedMatrix = new THREE.Matrix4(); clearedBox.getMatrixAt(9, clearedMatrix);
    expect(clearedMatrix.toArray()).toEqual(selectedMatrix.toArray());
  });

  it("uses the same dark-outline policy for compact long rods", async () => {
    const render = await setup(), rod = placeValueLayout(createPlaceValueBoard(1000, "normal", 10, 6))[0];
    for (const selected of [false, true, false]) {
      const scene = await render(createElement(PlaceValueRodMesh, { rod, red: [], offset: 0, selected, interactive: true, onSelect: vi.fn() }));
      const group = scene.getObjectByName("place-value-compact-rod")!;
      const mesh = group.children[0] as THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
      expect(mesh.material.uniforms.emphasis.value).toBe(Number(selected));
      expect("#" + mesh.material.uniforms.edge.value.getHexString()).toBe(VOXEL_EDGE_COLOR);
      expect("#" + mesh.material.uniforms.selectionLight.value.getHexString()).toBe(PLACE_VALUE_SELECTION_LIGHT);
      expect(mesh.material.fragmentShader).toContain(`selectionLight, ${PLACE_VALUE_SELECTION_LIGHTENING.toFixed(2)} * emphasis`);
      expect(mesh.material.fragmentShader).toContain(", edge, max(grid, outline))");
      expect(mesh.material.fragmentShader).not.toContain("mix(edge, selected");
      expect(named(group, "spatial-selection-outline")).toHaveLength(0);
      expect(mesh.geometry.parameters).toMatchObject({ width: 1, height: 1, depth: rod.length });
    }
  });

  it("keeps shared cube selection on the original geometry without an extra line frame", async () => {
    const render = await setup(), state = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]).initial;
    for (const selected of [false, true, false]) {
      const model = buildCubeStructureRenderModel(state, selected ? [state.cubes[0].id] : [], "Selection");
      const scene = await render(createElement(VoxelGeometry, { model, palette: { leaf: CUBE_COLORS[0], moon: CUBE_SELECTION_COLOR }, readOnly: false, preserveSelectedColors: true }));
      expect(named(scene, "spatial-selection-outline")).toHaveLength(0);
      expect(named(scene, "case-line")).toHaveLength(0);
    }
  });
});
