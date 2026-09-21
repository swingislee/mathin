import { describe, expect, it } from "vitest";
import { createSolidEntity, createSolidGeometryInitial, solidGeometryInitialSchema, solidGeometryToolSchema } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { arrangeSolidCut, createSolidCut, createSolidGeometryExplorationInitial, replaceExplorationEntity, solidCutPieceId, solidExplorationObjects, solidGeometryExplorationInitialSchema, solidGeometryExplorationToolSchema, solidMeshTopology, upgradeSolidGeometryInitial } from "@/features/tools/solid-geometry/exploration-contract";
import { assembledCutPiecePosition, solidCutPlaneFromSection, splitSolidByPlane } from "@/features/tools/solid-sections/solid-cut-model";
import { createSolidSectionSettings } from "@/features/tools/solid-sections/solid-sections-contract";
import { getSolidMetrics, solidLocalToWorld } from "@/features/tools/solid-geometry/solid-geometry";
import { interpolateSolidEntities } from "@/features/tools/solid-geometry/solid-geometry-motion";
import { accumulationCells, convertMeasurement, formatModelMeasurement, measurementConversionIdentity } from "@/features/tools/solid-measurement/measurement-units";
import { createMeasurementV2Settings, measurementV2SettingsSchema } from "@/features/tools/solid-measurement/measurement-v2-contract";
import { measurementSettingsSchema } from "@/features/tools/solid-measurement/measurement-contract";

describe("solid cuts as independent closed solids", () => {
  for (const kind of ["cube", "cuboid", "triangular-prism", "square-pyramid"] as const) it(`${kind} arbitrary cuts preserve volume and add exactly two cut surfaces`, () => {
    const source = createSolidEntity(kind, "source"), original = getSolidMetrics(source);
    for (let a = 0; a < 8; a++) {
      const n = { x: Math.sin(a + 1), y: Math.cos(a * 2), z: 0.3 }, length = Math.hypot(n.x, n.y, n.z);
      const plane = { normal: { x: n.x / length, y: n.y / length, z: n.z / length }, distance: (a % 3 - 1) * 0.15 };
      const halves = splitSolidByPlane(source, plane)!; expect(halves).not.toBeNull();
      expect(halves[0].volume + halves[1].volume).toBeCloseTo(original.volume, 8);
      expect(halves[0].surfaceArea + halves[1].surfaceArea).toBeCloseTo(original.surfaceArea + 2 * halves[0].cutArea, 8);
      expect(halves[0].cutArea).toBeCloseTo(halves[1].cutArea, 8);
      for (const part of halves) {
        const topology = solidMeshTopology(part.mesh);
        expect(topology.faces.some((face) => face.id === "cut")).toBe(true);
        expect(topology.edges.every((edge) => edge.faceIds.length === 2)).toBe(true);
        expect(topology.faces.every((face) => Number.isFinite(face.normal.x))).toBe(true);
      }
    }
  });
  it("keeps edge/vertex tangencies distinct from a cut through the interior", () => {
    const entity = createSolidEntity("cube", "cube");
    expect(splitSolidByPlane(entity, { normal: { x: 1, y: 0, z: 0 }, distance: 1 })).toBeNull();
    expect(splitSolidByPlane(entity, { normal: { x: 1, y: 0, z: 0 }, distance: 1.1 })).toBeNull();
    expect(splitSolidByPlane(createSolidEntity("sphere", "ball"), { normal: { x: 0, y: 1, z: 0 }, distance: 0 })).toBeNull();
  });
  it("maps world section handles into a stable local cut and exact reassembly", () => {
    const source = { ...createSolidEntity("cuboid", "source"), position: { x: 3, y: 4, z: -2 }, rotation: { x: 0.3, y: -0.4, z: 0.7 } };
    const plane = solidCutPlaneFromSection(source, { ...createSolidSectionSettings(), tiltA: 30, tiltB: 20, offset: 0.1 });
    const cut = createSolidCut(source, plane)!, parts = splitSolidByPlane(source, plane)!;
    const apart = arrangeSolidCut(cut, source, true), restored = arrangeSolidCut(apart, source, false);
    restored.pieces.forEach((piece, index) => { expect(piece.position).toEqual(assembledCutPiecePosition(source, parts[index])); expect(piece.rotation).toEqual(source.rotation); });
    const state = { ...createSolidGeometryExplorationInitial(), entities: [source], selectedId: solidCutPieceId(cut, 0), cuts: [cut] };
    const before = solidExplorationObjects(state), after = solidExplorationObjects({ ...state, cuts: [apart] });
    const middle = interpolateSolidEntities(before.entities, after.entities, 0.4);
    expect(middle[0].position).not.toEqual(before.entities[0].position); expect(middle[0].position).not.toEqual(after.entities[0].position);
    const moved = { ...after.entities[0], position: { x: 5.25, y: 4, z: -1.25 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } };
    const next = replaceExplorationEntity(state, moved);
    expect(next.entities).toEqual(state.entities); expect(next.cuts[0].pieces[1]).toEqual(cut.pieces[1]);
    expect(solidExplorationObjects(next).entities[0].position).toEqual(moved.position);
    const mesh = before.meshes.get(before.entities[0].id)!;
    const world = solidLocalToWorld(mesh.vertices[0], before.entities[0]); expect(Object.values(world).every(Number.isFinite)).toBe(true);
  });
});

describe("strict versioned cut and physical-unit preparation", () => {
  it("preserves v1 contracts and only upgrades explicitly", () => {
    const legacy = createSolidGeometryInitial(), modern = createSolidGeometryExplorationInitial();
    expect(solidGeometryInitialSchema.parse(legacy)).toEqual(legacy);
    expect(solidGeometryInitialSchema.safeParse(modern).success).toBe(false);
    expect(measurementSettingsSchema.safeParse(modern.measurement).success).toBe(false);
    expect(solidGeometryExplorationInitialSchema.safeParse(legacy).success).toBe(false);
    const upgraded = upgradeSolidGeometryInitial(legacy);
    expect(upgraded.measurement.unit).toBe("unit"); expect(upgraded.entities).toEqual(legacy.entities); expect(upgraded.cuts).toEqual([]);
    expect(solidGeometryExplorationToolSchema.safeParse({ toolId: "solid-geometry", contentVersion: "solid-geometry-lesson-v2", payload: { title: "Units and cuts", initial: modern } }).success).toBe(true);
    expect(solidGeometryToolSchema.safeParse({ toolId: "solid-geometry", contentVersion: "solid-geometry-lesson-v2", payload: { title: "Units and cuts", initial: modern } }).success).toBe(false);
  });
  it("rejects malformed cuts, hidden selections, false units and out-of-bounds poses", () => {
    const base = createSolidGeometryExplorationInitial(), cut = createSolidCut(base.entities[0], { normal: { x: 0, y: 1, z: 0 }, distance: 0 })!;
    const state = { ...base, cuts: [cut], selectedId: solidCutPieceId(cut, 0) };
    expect(solidGeometryExplorationInitialSchema.safeParse(state).success).toBe(true);
    for (const change of [{ cuts: [{ ...cut, entityId: "missing" }] }, { cuts: [cut, cut] }, { cuts: [{ ...cut, normal: { x: 0, y: 2, z: 0 } }] }, { cuts: [{ ...cut, distance: 18 }] }, { selectedId: cut.entityId }, { feature: { entityId: state.selectedId, kind: "face", id: "not-a-face" } }]) expect(solidGeometryExplorationInitialSchema.safeParse({ ...state, ...change }).success).toBe(false);
    expect(solidGeometryExplorationInitialSchema.safeParse({ ...state, cuts: [{ ...cut, pieces: [{ ...cut.pieces[0], position: { x: 40, y: 0, z: 0 } }, cut.pieces[1]] }] }).success).toBe(false);
    expect(measurementV2SettingsSchema.safeParse({ ...base.measurement, displayUnit: "unit" }).success).toBe(false);
    expect(measurementV2SettingsSchema.safeParse({ ...base.measurement, accumulationCount: 1729 }).success).toBe(false);
  });
});

describe("unit quantity, powers and geometric accumulation", () => {
  it("converts lengths, areas and volumes by the correct powers", () => {
    expect(convertMeasurement(1, "dm", "cm", 1)).toBe(10);
    expect(convertMeasurement(1, "dm", "cm", 2)).toBe(100);
    expect(convertMeasurement(1, "dm", "cm", 3)).toBe(1000);
    expect(convertMeasurement(1000, "cm", "dm", 3)).toBeCloseTo(1, 12);
    expect(convertMeasurement(1, "m", "mm", 3)).toBe(1e9);
    expect(() => convertMeasurement(1, "unit", "cm", 1)).toThrow();
    expect(measurementConversionIdentity("dm", 3).factor).toBe(1000);
    expect(formatModelMeasurement(1000, "en", 3, { ...createMeasurementV2Settings(), unit: "cm", displayUnit: "dm" })).toBe("1 dm³");
  });
  it("accumulates one-dimensional intervals, 100 unit squares and 1000 unit cubes without resizing on display conversion", () => {
    const entity = { ...createSolidEntity("cube", "cube"), dimensions: { width: 10, height: 10, depth: 10, radius: 1 } };
    expect(accumulationCells(entity, "length")).toHaveLength(10);
    expect(accumulationCells(entity, "area")).toHaveLength(100);
    const cubes = accumulationCells(entity, "volume"); expect(cubes).toHaveLength(1000);
    expect(cubes[0].size).toEqual({ x: 1, y: 1, z: 1 }); expect(cubes.at(-1)!.center).toEqual({ x: 4.5, y: 4.5, z: 4.5 });
    expect(accumulationCells({ ...entity, dimensions: { ...entity.dimensions, width: 3.5 } }, "volume")).toEqual([]);
  });
});
