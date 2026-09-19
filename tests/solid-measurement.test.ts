import { describe, expect, it } from "vitest";
import { buildRectangularPrismMeasurement } from "@/features/spatial-math/domain/rectangular-prism-measurement";
import { createSolidEntity, SOLID_KINDS } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { getSolidMetrics, getSolidTopology, solidLocalToWorld } from "@/features/tools/solid-geometry/solid-geometry";
import { createMeasurementSettings, MEASUREMENT_LAYER_MS, measurementSettingsSchema } from "@/features/tools/solid-measurement/measurement-contract";
import { buildMeasurementUnitCells, formatMeasurementEquation, formatMeasurementValue, measurementDimensionLines, measurementDisplayEntity, measurementFaceArea, measurementLayerFrame, measurementTargetLayers, measurementUnitFillAvailability, measurementUnitGrid } from "@/features/tools/solid-measurement/measurement-model";

describe("solid measurement settings", () => {
  it("has a strict, bounded snapshot with abstract units and no hidden scene mutations", () => {
    const settings = createMeasurementSettings();
    expect(measurementSettingsSchema.parse(settings)).toEqual(settings);
    expect(settings.enabled).toBe(false);
    for (const change of [{ fillLayers: -1 }, { fillLayers: 7 }, { fillLayers: 0.5 }, { fillLayers: NaN }, { unit: "cm" }, { unrelated: true }]) {
      expect(measurementSettingsSchema.safeParse({ ...settings, ...change }).success).toBe(false);
    }
    const copy = createMeasurementSettings(); copy.fillLayers = 4;
    expect(createMeasurementSettings().fillLayers).toBe(0);
  });
});

describe("solid measurement uses shared analytic geometry", () => {
  it.each(SOLID_KINDS)("face areas sum to the analytic surface area of %s", (kind) => {
    const entity = createSolidEntity(kind, kind);
    const areas = getSolidTopology(entity).faces.map((face) => measurementFaceArea(entity, face.id)!);
    expect(areas.every((area) => area > 0)).toBe(true);
    expect(areas.reduce((sum, area) => sum + area, 0)).toBeCloseTo(getSolidMetrics(entity).surfaceArea, 10);
    expect(measurementFaceArea(entity, "imaginary-face")).toBeNull();
    const moved = { ...entity, position: { x: 12, y: -3, z: 5 }, rotation: { x: 1.4, y: 0.75, z: 2 } };
    expect(getSolidTopology(moved).faces.map((face) => measurementFaceArea(moved, face.id))).toEqual(areas);
  });
  it("uses π for a circular base rather than the polygonal rendering sample", () => {
    const cylinder = createSolidEntity("cylinder", "round");
    expect(measurementFaceArea(cylinder, "bottom")).toBe(Math.PI);
    expect(measurementFaceArea(cylinder, "surface")).toBe(4 * Math.PI);
    expect(formatMeasurementValue(Math.PI, "en", 2)).toBe("≈ 3.142 u²");
    expect(formatMeasurementValue(24, "zh", 3)).toBe("24 u³");
    expect(formatMeasurementEquation("V", 24, "en", 3)).toBe("V = 24 u³");
    expect(formatMeasurementEquation("S", Math.PI, "en", 2)).toBe("S ≈ 3.142 u²");
  });
  it.each(SOLID_KINDS)("dimension lines measure actual local lengths for %s", (kind) => {
    const entity = createSolidEntity(kind, "solid"), lines = measurementDimensionLines(entity);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y, line.end.z - line.start.z)).toBeCloseTo(line.value);
      const start = solidLocalToWorld(line.start, entity), end = solidLocalToWorld(line.end, entity);
      expect(Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)).toBeCloseTo(line.value);
    }
    if (kind === "triangular-prism") expect(lines.map((line) => line.id)).toEqual(["baseWidth", "triangleHeight", "prismLength"]);
  });
});

describe("honest unit-cube and surface-grid demonstrations", () => {
  it("reuses the original prism occupied cells, remapped around the solid centre", () => {
    const entity = { ...createSolidEntity("cuboid", "box"), dimensions: { width: 3, height: 4, depth: 2, radius: 1 } };
    const original = buildRectangularPrismMeasurement({ dimensions: { length: 3, height: 4, width: 2 }, unit: "unit" });
    const cells = buildMeasurementUnitCells(entity);
    expect(cells).toHaveLength(original.occupiedCells.length);
    expect(cells.map((cell) => ({ x: cell.center.x + 1, y: cell.center.y + 1.5, z: cell.center.z + 0.5 }))).toEqual(original.occupiedCells);
    expect(measurementUnitFillAvailability(entity)).toMatchObject({ available: true, total: 24, perLayer: 6, layers: 4 });
    expect(cells.filter((cell) => cell.layer === 2)).toHaveLength(6);
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(24);
  });
  it("accepts the exact 216-cell limit and refuses unsupported solids without rounding", () => {
    const cube = createSolidEntity("cube", "cube");
    const limit = { ...cube, dimensions: { ...cube.dimensions, width: 6, height: 6, depth: 6 } };
    expect(buildMeasurementUnitCells(limit)).toHaveLength(216);
    expect(measurementUnitFillAvailability(null)).toEqual({ available: false, reason: "select-solid" });
    expect(measurementUnitFillAvailability(createSolidEntity("cylinder", "round"))).toEqual({ available: false, reason: "cuboid-only" });
    const fractional = { ...cube, dimensions: { ...cube.dimensions, width: 2.5, height: 2.5, depth: 2.5 } };
    expect(measurementUnitFillAvailability(fractional)).toEqual({ available: false, reason: "whole-units" });
    expect(buildMeasurementUnitCells(fractional)).toEqual([]);
    const large = { ...cube, dimensions: { ...cube.dimensions, width: 7, height: 7, depth: 7 } };
    expect(measurementUnitFillAvailability(large)).toEqual({ available: false, reason: "unit-limit" });
    expect(buildMeasurementUnitCells(large)).toEqual([]);
    expect(getSolidMetrics(large).volume).toBe(343);
  });
  it("temporarily fades the displayed shell and preserves authored material, position and metrics", () => {
    const cube = createSolidEntity("cube", "cube"), before = structuredClone(cube), settings = { ...createMeasurementSettings(), enabled: true, unitFill: true, fillLayers: 6 };
    const display = measurementDisplayEntity(cube, settings);
    expect(display.opacity).toBe(0.1); expect(cube).toEqual(before); expect(getSolidMetrics(display)).toEqual(getSolidMetrics(cube));
    expect(measurementDisplayEntity(cube, { ...settings, enabled: false })).toBe(cube);
    const hidden = { ...cube, opacity: 0 }; expect(measurementDisplayEntity(hidden, settings).opacity).toBe(0);
    expect(measurementTargetLayers(cube, settings)).toBe(2);
    expect(measurementTargetLayers(cube, { ...settings, unitFill: false })).toBe(0);
  });
  it("draws real one-unit intervals and preserves a fractional remainder", () => {
    const box = { ...createSolidEntity("cuboid", "box"), dimensions: { width: 2.5, height: 2, depth: 1, radius: 1 } };
    const grid = measurementUnitGrid(box);
    expect(grid).toHaveLength(12);
    const xLines = grid.filter(([a, b]) => a.x === b.x && a.z === b.z && a.y !== b.y);
    expect([...new Set(xLines.map(([a]) => a.x))].sort((a, b) => a - b)).toEqual([-0.25, 0.75]);
    expect(box.dimensions.width).toBe(2.5);
    expect(measurementUnitGrid(createSolidEntity("cone", "cone"))).toEqual([]);
  });
});

describe("successive layer presentation", () => {
  it("crosses whole layers in order, keeps intermediate frames and reaches the exact endpoint", () => {
    const ms = MEASUREMENT_LAYER_MS;
    expect(measurementLayerFrame(0, 3, 0, ms)).toBe(0);
    expect(measurementLayerFrame(0, 3, ms / 2, ms)).toBe(0.5);
    expect(measurementLayerFrame(0, 3, ms, ms)).toBe(1);
    expect(measurementLayerFrame(0, 3, 1.5 * ms, ms)).toBe(1.5);
    expect(measurementLayerFrame(0, 3, 10 * ms, ms)).toBe(3);
    expect(measurementLayerFrame(3, 0, ms / 2, ms)).toBe(2.5);
    expect(measurementLayerFrame(3, 0, 3 * ms, ms)).toBe(0);
    expect(measurementLayerFrame(1.5, 0, 0, ms)).toBe(1.5);
  });
});
