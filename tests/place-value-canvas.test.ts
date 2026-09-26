import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlaceValueCanvas, type PlaceValueCanvasProps } from "@/features/tools/place-value/PlaceValueCanvas";
import type { VoxelModelCanvasProps } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import { createDefaultPlaceValueInitial, createPlaceValueBoard, placeValueSnapshot } from "@/features/tools/place-value/contract";
import { planPlaceValue } from "@/features/tools/place-value/model";
import { placeValueControlPositions } from "@/features/tools/place-value/PlaceValueStage";
import { SPATIAL_GROUND_LABEL_ROTATION, spatialGroundVisible } from "@/features/tools/spatial-interaction/SpatialSurfaceLabel";
import { Euler, OrthographicCamera, Vector3 } from "three";

const rendered = vi.hoisted(() => ({ props: null as VoxelModelCanvasProps | null }));
vi.mock("@/features/spatial-math/renderer-r3f/VoxelCanvas", () => ({
  VoxelModelCanvas: (props: VoxelModelCanvasProps) => { rendered.props = props; return null; },
  VoxelGeometry: () => null,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const draw = (patch: Partial<PlaceValueCanvasProps> = {}) => {
  const props: PlaceValueCanvasProps = { snapshot: placeValueSnapshot(createDefaultPlaceValueInitial()), progress: 1, locale: "en", navigation: "orbit", axisSnap: true, interactive: true, selected: true, onSelect: vi.fn(), onPointerMissed: vi.fn(), ...patch };
  renderToStaticMarkup(createElement(PlaceValueCanvas, props)); return rendered.props!;
};
describe("place-value uses the existing voxel canvas", () => {
  it("hides the entire depth ruler at every horizontal or underside view, and shows it from above", () => {
    const direction = new Vector3();
    for (const position of [[0, 4, 240], [240, 4, 0], [-240, 4, 0], [0, 4, -240], [240, 4.1, 0], [100, -80, 100]]) {
      const camera = new OrthographicCamera();
      camera.position.set(...position as [number, number, number]); camera.lookAt(0, 4, 0); camera.updateMatrixWorld();
      expect(spatialGroundVisible(camera.getWorldDirection(direction))).toBe(false);
    }
    for (const position of [[0, 240, 0], [240, 80, 0], [100, 80, 100], [-100, 80, -100]]) {
      const camera = new OrthographicCamera();
      camera.up.set(0, 0, -1); camera.position.set(...position as [number, number, number]); camera.lookAt(0, 4, 0); camera.updateMatrixWorld();
      expect(spatialGroundVisible(camera.getWorldDirection(direction))).toBe(true);
    }
    const rotation = new Euler(...SPATIAL_GROUND_LABEL_ROTATION);
    expect(new Vector3(0, 0, 1).applyEuler(rotation).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9);
    expect(new Vector3(1, 0, 0).applyEuler(rotation).distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-9);
  });
  it("keeps a stable hundreds/tens/ones row at either side instead of reordering coincident labels", () => {
    for (const x of [-240, 240]) for (const z of [-2, 0, 2]) for (const mode of ["single", "compare"] as const) {
      const camera = new OrthographicCamera(-15, 15, 11.25, -11.25, .01, 1000);
      camera.position.set(x, 4, z); camera.lookAt(0, 4, 0); camera.updateMatrixWorld();
      const { positions } = placeValueControlPositions(camera, { width: 768, height: 576 }, mode);
      const keys = (mode === "single" ? ["left"] : ["left", "right"]).flatMap((side) => ["hundreds", "tens", "ones"].map((place) => side + ":" + place));
      for (let index = 1; index < keys.length; index++) {
        expect(positions[keys[index]][0]).toBeGreaterThan(positions[keys[index - 1]][0]);
        expect(positions[keys[index]][1]).toBe(positions[keys[index - 1]][1]);
      }
    }
  });
  it.each([90, 900])("renders original blue end blocks after the fifth group for %i", (value) => {
    const snapshot = placeValueSnapshot({ ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(value) });
    const { model } = draw({ snapshot });
    expect(model.cells.filter((c) => c.z === 0).map((c) => c.materialToken)).toEqual(["yellow", "yellow", "yellow", "yellow", "yellow", "blue", "blue", "blue", "blue"]);
    const last = (value === 90 ? snapshot.left.tens : snapshot.left.hundreds).at(-1)!.flat();
    expect(model.cells.find((c) => c.key === "left:" + last.at(-1))!.z).toBe(0);
    expect(model.cells.find((c) => c.key === "left:" + last[0])!.z).toBe(value === 90 ? -9 : -99);
  });
  it("ignores old geometry-center frames and keeps the number-front orbit pivot", () => {
    const snapshot = placeValueSnapshot({ ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(104), grid: true, frame: { center: { x: 0, y: 8, z: -49 }, radius: 50 } });
    const rendered = draw({ snapshot });
    expect(rendered.model.camera.target).toEqual({ x: 0, y: 4, z: 0 });
    expect(rendered.model.bounds.center).toEqual({ x: 0, y: 4, z: 0 });
    expect(rendered.cameraPanEnabled).toBe(false);
  });
  it("keeps place controls apart and inside the stage in front, side and fitted views", () => {
    for (const width of [400, 768, 1200]) for (const mode of ["single", "compare"] as const) for (const position of [[0, 4, 240], [240, 4, 0], [160, 120, 160]]) {
      const camera = new OrthographicCamera(-15, 15, 11.25, -11.25, .01, 1000);
      camera.position.set(position[0], position[1], position[2]); camera.lookAt(0, 4, 0); camera.updateMatrixWorld();
      const arranged = placeValueControlPositions(camera, { width, height: width * .75 }, mode);
      const xs = Object.values(arranged.positions).map(([x]) => x).sort((a, b) => a - b);
      expect(xs[0]).toBeGreaterThanOrEqual(arranged.width / 2 + 7.999);
      expect(xs.at(-1)!).toBeLessThanOrEqual(width - arranged.width / 2 - 56 + .001);
      for (let index = 1; index < xs.length; index++) expect(xs[index] - xs[index - 1]).toBeGreaterThanOrEqual(arranged.width + 7.999);
    }
  });
  it.each([0, 9, 10, 99, 100, 101, 110, 200, 999])("renders %i with a true unit scale and distinct shared cell keys", (value) => {
    const snapshot = placeValueSnapshot({ ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(value), mode: "compare", right: createPlaceValueBoard(value) });
    const { model, materialColors, preserveSelectedColors } = draw({ snapshot });
    expect(model.cells).toHaveLength(value * 2); expect(new Set(model.cells.map((c) => c.key)).size).toBe(value * 2);
    expect(model.camera.projection).toBe("orthographic"); expect(model.showAxes).toBe(false);
    const left = model.cells.filter((c) => c.key.startsWith("left:")), right = model.cells.filter((c) => c.key.startsWith("right:"));
    left.forEach((cell, index) => {
      expect(right[index].x - cell.x).toBe(18); expect(right[index].y).toBe(cell.y); expect(right[index].z).toBe(cell.z);
    });
    expect(materialColors?.yellow).not.toBe(materialColors?.blue); expect(preserveSelectedColors).toBe(true);
    if (value >= 100) expect(Math.min(...model.cells.map((c) => c.z))).toBe(-99);
  });
  it("retains shared camera navigation, picking and empty-space deselection through mid-animation", () => {
    const start = placeValueSnapshot({ ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(10, "ones") });
    const moving = planPlaceValue(start, "carry-one", 1000)!;
    const onSelect = vi.fn(), onPointerMissed = vi.fn();
    const before = draw({ snapshot: start, onSelect, onPointerMissed });
    before.onCellSelect!("left:11"); expect(onSelect).toHaveBeenCalledExactlyOnceWith("left", 11);
    const during = draw({ snapshot: moving, progress: .5, onPointerMissed });
    expect(during.model.cells).toHaveLength(0); expect(during.sceneOverlay).toBeTruthy();
    expect(during.cameraInteractive).toBe(true); expect(during.readOnly).toBe(true);
    expect(during.model.camera).toEqual(before.model.camera); expect(during.model.bounds).toEqual(before.model.bounds);
    expect(during.onPointerMissed).toBe(onPointerMissed); expect(during.axisSnapEnabled).toBe(true);
    const finished = draw({ snapshot: moving, progress: 1 });
    expect(finished.model.cells).toHaveLength(10); expect(finished.readOnly).toBe(false);
  });
});
