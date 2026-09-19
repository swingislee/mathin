import { describe, expect, it } from "vitest";
import { createDefaultSolidCapacityInitial, solidCapacityInitialSchema, solidCapacitySnapshot, solidCapacitySnapshotSchema, solidCapacityToolSchema } from "@/features/tools/solid-capacity/solid-capacity-contract";
import { equalBaseAndHeight, liquidFractionAtHeight, liquidHeight, liquidRadii, matchCapacityDimensions, resizeCapacityVessel, transferLiquid, vesselCapacity, vesselLiquidVolume } from "@/features/tools/solid-capacity/solid-capacity";
import { capacityPresentation, interpolateCapacity } from "@/features/tools/solid-capacity/solid-capacity-motion";

describe("capacity mathematics", () => {
  it("uses analytic cylinder and cone capacities, not height ratios", () => {
    const vessel = { radius: 2, height: 6, fill: 1 / 8 };
    expect(vesselCapacity(vessel, "cylinder")).toBeCloseTo(24 * Math.PI);
    expect(vesselCapacity(vessel, "cone")).toBeCloseTo(8 * Math.PI);
    expect(liquidHeight(vessel, "cylinder")).toBeCloseTo(0.75);
    expect(liquidHeight(vessel, "cone", "tip-down")).toBeCloseTo(3);
    expect(liquidHeight({ ...vessel, fill: 7 / 8 }, "cone", "tip-up")).toBeCloseTo(3);
  });
  it("inverts both cone orientations at every tested filling level and renders the correct frustum", () => {
    for (const kind of ["cone", "cylinder"] as const) for (const orientation of ["tip-down", "tip-up"] as const) for (const fill of [0, 0.01, 0.125, 1 / 3, 0.5, 0.875, 1]) {
      const vessel = { radius: 1.7, height: 4.25, fill }, height = liquidHeight(vessel, kind, orientation), radii = liquidRadii(vessel, kind, orientation);
      expect(liquidFractionAtHeight(vessel, kind, height, orientation)).toBeCloseTo(fill, 12);
      const meshVolume = Math.PI * height * (radii.top ** 2 + radii.top * radii.bottom + radii.bottom ** 2) / 3;
      expect(meshVolume).toBeCloseTo(vesselLiquidVolume(vessel, kind), 10);
    }
  });
  it("fills a same-base same-height cylinder with exactly three actual cone transfers", () => {
    let snapshot = solidCapacitySnapshot(createDefaultSolidCapacityInitial());
    for (let turn = 1; turn <= 3; turn++) {
      snapshot = { ...snapshot, cone: { ...snapshot.cone, fill: 1 } };
      const before = vesselLiquidVolume(snapshot.cone, "cone") + vesselLiquidVolume(snapshot.cylinder, "cylinder");
      const result = transferLiquid(snapshot, "cone"); snapshot = result.snapshot;
      expect(snapshot.cylinder.fill).toBeCloseTo(turn / 3); expect(snapshot.cone.fill).toBe(0);
      expect(vesselLiquidVolume(snapshot.cone, "cone") + vesselLiquidVolume(snapshot.cylinder, "cylinder")).toBeCloseTo(before);
    }
    expect(snapshot.cylinder.fill).toBe(1);
  });
  it("leaves overflow in the source and supports a bounded amount or reverse transfer", () => {
    const initial = solidCapacitySnapshot(createDefaultSolidCapacityInitial());
    const half = transferLiquid(initial, "cone", vesselCapacity(initial.cone, "cone") / 2);
    expect(half.snapshot.cone.fill).toBeCloseTo(0.5); expect(half.snapshot.cylinder.fill).toBeCloseTo(1 / 6);
    const reverse = transferLiquid(half.snapshot, "cylinder");
    expect(reverse.snapshot.cone.fill).toBe(1); expect(reverse.snapshot.cylinder.fill).toBe(0);
    const small = { ...initial, linkedDimensions: false, cylinder: { radius: 0.5, height: 1, fill: 0 } };
    const limited = transferLiquid(small, "cone"); expect(limited.snapshot.cylinder.fill).toBe(1); expect(limited.snapshot.cone.fill).toBeCloseTo(0.75);
    expect(transferLiquid(limited.snapshot, "cone").snapshot).toBe(limited.snapshot);
    expect(transferLiquid(initial, "cone", NaN).amount).toBe(0); expect(transferLiquid(initial, "cone", -1).amount).toBe(0);
    expect(equalBaseAndHeight(small)).toBe(false);
  });
  it("clears liquids when configuring dimensions and matches dimensions deliberately", () => {
    const initial = solidCapacitySnapshot(createDefaultSolidCapacityInitial());
    const changed = resizeCapacityVessel(initial, "cone", "radius", 2);
    expect(changed.cone.radius).toBe(2); expect(changed.cylinder.radius).toBe(2); expect(changed.cone.fill).toBe(0); expect(initial.cone.fill).toBe(1);
    const separate = resizeCapacityVessel({ ...initial, linkedDimensions: false }, "cylinder", "height", 5);
    expect(separate.cone.height).toBe(3); expect(separate.cylinder.height).toBe(5);
    const matched = matchCapacityDimensions(separate); expect(matched.cylinder).toEqual(matched.cone); expect(matched.linkedDimensions).toBe(true);
  });
});
describe("capacity strict prepared and classroom contracts", () => {
  it("accepts known fields only and validates dimensions, fills, orientation, and linked values", () => {
    const initial = createDefaultSolidCapacityInitial(), snapshot = solidCapacitySnapshot(initial);
    expect(solidCapacityInitialSchema.parse(initial)).toEqual(initial); expect(solidCapacitySnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(solidCapacityToolSchema.safeParse({ toolId: "solid-capacity", contentVersion: "solid-capacity-lesson-v1", payload: { title: "Compare", initial } }).success).toBe(true);
    for (const bad of [{ ...initial, score: 1 }, { ...initial, coneOrientation: "side" }, { ...initial, cylinder: { ...initial.cylinder, radius: 2 } }, { ...initial, cone: { ...initial.cone, fill: 1.1 } }, { ...initial, cone: { ...initial.cone, radius: 0 } }, { ...initial, cone: { ...initial.cone, height: Infinity } }]) {
      expect(solidCapacityInitialSchema.safeParse(bad).success).toBe(false);
    }
    expect(solidCapacitySnapshotSchema.safeParse({ ...snapshot, cameraRevision: -1 }).success).toBe(false);
  });
});
describe("capacity continuous presentation", () => {
  it("keeps liquid conserved at every transfer frame while height changes nonlinearly", () => {
    const initial = solidCapacitySnapshot(createDefaultSolidCapacityInitial()), to = transferLiquid(initial, "cone").snapshot;
    const fromFrame = capacityPresentation(initial), toFrame = capacityPresentation(to);
    for (const progress of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      const frame = interpolateCapacity(fromFrame, toFrame, progress);
      expect(vesselLiquidVolume(frame.cone, "cone") + vesselLiquidVolume(frame.cylinder, "cylinder")).toBeCloseTo(Math.PI);
    }
    const middle = interpolateCapacity(fromFrame, toFrame, 0.5);
    expect(liquidHeight(middle.cone, "cone")).toBeCloseTo(3 * Math.cbrt(0.5));
    expect(liquidHeight(middle.cylinder, "cylinder")).toBeCloseTo(0.5);
  });
  it("empties before rotating a cone and then restores the target liquid", () => {
    const initial = solidCapacitySnapshot(createDefaultSolidCapacityInitial()), target = { ...initial, coneOrientation: "tip-up" as const };
    const a = capacityPresentation(initial), b = capacityPresentation(target);
    const draining = interpolateCapacity(a, b, 0.2), turning = interpolateCapacity(a, b, 0.5), refilling = interpolateCapacity(a, b, 0.9);
    expect(draining.coneAngle).toBe(Math.PI); expect(draining.cone.fill).toBeGreaterThan(0);
    expect(turning.cone.fill).toBe(0); expect(turning.coneAngle).toBeCloseTo(Math.PI / 2);
    expect(refilling.coneAngle).toBe(0); expect(refilling.cone.fill).toBeGreaterThan(0);
  });
});
