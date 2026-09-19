import { describe, expect, it } from "vitest";
import { createSolidEntity, createSolidGeometryInitial, solidGeometryInitial, solidGeometryInitialSchema, solidGeometrySnapshot, solidGeometrySnapshotSchema } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { rotateSolidPoint, solidLocalToWorld } from "@/features/tools/solid-geometry/solid-geometry";
import { createSolidSectionSettings, solidSectionSettingsSchema, supportsSolidSection } from "@/features/tools/solid-sections/solid-sections-contract";
import { intersectSolidSection, sectionFlatPoints, sectionUnit, solidSectionDistance, solidSectionNormal, solidSectionPlane, type SolidSectionPlane } from "@/features/tools/solid-sections/solid-sections";
import { interpolateSolidSection, solidSectionFrame, solidSectionVisible } from "@/features/tools/solid-sections/solid-sections-motion";

const cube = () => createSolidEntity("cube", "cube", { x: 0, y: 0, z: 0 });
const horizontal = (y = 0): SolidSectionPlane => ({ normal: { x: 0, y: 1, z: 0 }, origin: { x: 0, y, z: 0 } });
describe("exact convex-solid sections", () => {
  it("forms the true square and coplanar boundary without treating them as voxel layers", () => {
    const middle = intersectSolidSection(cube(), horizontal(0.237));
    expect(middle.kind).toBe("polygon"); expect(middle.points).toHaveLength(4); expect(middle.area).toBeCloseTo(4); expect(middle.crossesInterior).toBe(true);
    for (const point of middle.points) expect(point.y).toBeCloseTo(0.237);
    const face = intersectSolidSection(cube(), horizontal(1));
    expect(face.points).toHaveLength(4); expect(face.area).toBeCloseTo(4); expect(face.crossesInterior).toBe(false);
    expect(intersectSolidSection(cube(), horizontal(1.01)).kind).toBe("empty");
  });
  it("forms triangular and regular hexagonal oblique sections with correct area", () => {
    const normal = { x: 1, y: 1, z: 1 };
    const triangle = intersectSolidSection(cube(), { normal, origin: { x: 2 / 3, y: 2 / 3, z: 2 / 3 } });
    expect(triangle.points).toHaveLength(3); expect(triangle.area).toBeCloseTo(Math.sqrt(3) / 2);
    const hexagon = intersectSolidSection(cube(), { normal, origin: { x: 0, y: 0, z: 0 } });
    expect(hexagon.points).toHaveLength(6); expect(hexagon.area).toBeCloseTo(3 * Math.sqrt(3));
    expect(hexagon.crossesInterior).toBe(true);
    const normalFromControls = solidSectionNormal({ axis: "y", tiltA: 45, tiltB: -Math.asin(1 / Math.sqrt(3)) * 180 / Math.PI });
    expect(normalFromControls.x).toBeCloseTo(normalFromControls.y); expect(normalFromControls.y).toBeCloseTo(normalFromControls.z);
  });
  it("keeps tangent vertices, tangent edges and near-tangent thin polygons distinct", () => {
    const point = intersectSolidSection(cube(), { normal: { x: 1, y: 1, z: 1 }, origin: { x: 1, y: 1, z: 1 } });
    expect(point).toMatchObject({ kind: "point", area: 0, crossesInterior: false }); expect(point.points).toHaveLength(1);
    const edge = intersectSolidSection(cube(), { normal: { x: 1, y: 1, z: 0 }, origin: { x: 1, y: 1, z: 0 } });
    expect(edge).toMatchObject({ kind: "segment", area: 0, crossesInterior: false }); expect(edge.points).toHaveLength(2);
    const thin = intersectSolidSection(cube(), { normal: { x: 1, y: 1, z: 1 }, origin: { x: 0.9999, y: 0.9999, z: 0.9999 } });
    expect(thin.kind).toBe("polygon"); expect(thin.points).toHaveLength(3); expect(thin.area).toBeGreaterThan(0);
  });
  it("uses prism and pyramid edges rather than their bounding boxes", () => {
    const prism = createSolidEntity("triangular-prism", "p", { x: 0, y: 0, z: 0 });
    const triangle = intersectSolidSection(prism, { normal: { x: 0, y: 0, z: 1 }, origin: prism.position });
    expect(triangle.points).toHaveLength(3); expect(triangle.area).toBeCloseTo(2);
    const rectangle = intersectSolidSection(prism, horizontal()); expect(rectangle.points).toHaveLength(4); expect(rectangle.area).toBeCloseTo(3);
    const pyramid = createSolidEntity("square-pyramid", "y", { x: 0, y: 0, z: 0 });
    expect(intersectSolidSection(pyramid, horizontal()).area).toBeCloseTo(1);
    expect(intersectSolidSection(pyramid, { normal: { x: 1, y: 0, z: 0 }, origin: pyramid.position }).area).toBeCloseTo(2);
  });
  it("maintains world-plane incidence and area when the solid is translated and rotated", () => {
    const entity = { ...cube(), position: { x: 9, y: -3, z: 7 }, rotation: { x: 0.6, y: 1.2, z: -0.4 } };
    const plane = { normal: rotateSolidPoint({ x: 0, y: 1, z: 0 }, entity.rotation), origin: solidLocalToWorld({ x: 0, y: 0.123, z: 0 }, entity) };
    const result = intersectSolidSection(entity, plane); expect(result.points).toHaveLength(4); expect(result.area).toBeCloseTo(4);
    for (const point of result.points) expect(solidSectionDistance(point, plane)).toBeCloseTo(0);
    const flat = sectionFlatPoints(result, plane.normal); expect(flat).toHaveLength(4);
    const reversed = intersectSolidSection(entity, { ...plane, normal: { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z } });
    expect(reversed.area).toBeCloseTo(result.area); expect(reversed.points).toHaveLength(4);
  });
  it.each(["cube", "cuboid", "triangular-prism", "square-pyramid"] as const)("normalized slide passes entirely beyond a rotated %s", (kind) => {
    const entity = createSolidEntity(kind, kind); entity.rotation = { x: 0.2, y: 0.6, z: -0.9 };
    for (const offset of [-1.2, 1.2]) expect(intersectSolidSection(entity, solidSectionPlane(entity, { x: 1, y: 2, z: -1 }, offset)).kind).toBe("empty");
  });
  it("does not claim sampled curved sections to be exact", () => {
    for (const kind of ["sphere", "cone", "cylinder"] as const) {
      expect(supportsSolidSection(kind)).toBe(false); expect(intersectSolidSection(createSolidEntity(kind, kind), horizontal()).kind).toBe("empty");
    }
    expect(() => sectionUnit({ x: 0, y: 0, z: 0 })).toThrow();
  });
});
describe("strict section settings and continuous presentation", () => {
  it("roundtrips in the common preparation and classroom snapshots with a compatible default", () => {
    const initial = createSolidGeometryInitial();
    initial.section = { ...initial.section, enabled: true, axis: "x", offset: 0.271, tiltA: 27, tiltB: -12, removedSide: "positive" };
    const state = solidGeometrySnapshot(initial), restored = solidGeometrySnapshotSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(solidGeometryInitial(restored)).toEqual(initial);
    const beforeExtension = Object.fromEntries(Object.entries(initial).filter(([key]) => key !== "section"));
    expect(solidGeometryInitialSchema.parse(beforeExtension).section).toEqual(createSolidSectionSettings());
    state.section.offset = -0.7; expect(initial.section.offset).toBe(0.271);
  });
  it("rejects arbitrary settings, non-finite numbers, unknown axes and out-of-range values", () => {
    const valid = createSolidSectionSettings();
    for (const patch of [{ offset: 2 }, { offset: NaN }, { tiltA: Infinity }, { tiltB: 91 }, { axis: "a" }, { removedSide: "both" }, { arbitrary: true }]) expect(solidSectionSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
  it("interpolates plane direction, position and the disappearing half with exact endpoints", () => {
    const from = solidSectionFrame({ ...createSolidSectionSettings(), enabled: true }), to = solidSectionFrame({ ...createSolidSectionSettings(), enabled: true, axis: "x", offset: 0.7, removedSide: "positive" });
    const mid = interpolateSolidSection(from, to, 0.3);
    expect(mid.normal.x).toBeGreaterThan(0); expect(mid.normal.x).toBeLessThan(1); expect(Math.hypot(...Object.values(mid.normal))).toBeCloseTo(1);
    expect(mid.offset).toBeGreaterThan(0); expect(mid.offset).toBeLessThan(0.7); expect(mid.positiveOpacity).toBeGreaterThan(0); expect(mid.positiveOpacity).toBeLessThan(1); expect(mid.negativeOpacity).toBe(1);
    expect(interpolateSolidSection(from, to, 1)).toBe(to); expect(solidSectionVisible(to)).toBe(true); expect(solidSectionVisible(solidSectionFrame(createSolidSectionSettings()))).toBe(false);
  });
});
