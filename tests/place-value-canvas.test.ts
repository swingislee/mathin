import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlaceValueCanvas, type PlaceValueCanvasProps } from "@/features/tools/place-value/PlaceValueCanvas";
import type { VoxelModelCanvasProps } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import { createDefaultPlaceValueInitial, createPlaceValueBoard, placeValueSnapshot } from "@/features/tools/place-value/contract";
import { planPlaceValue } from "@/features/tools/place-value/model";

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
