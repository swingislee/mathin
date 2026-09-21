import { describe, expect, it } from "vitest";
import { createDefaultDisplacementInitial, displacementInitial, displacementInitialSchema, displacementSnapshot, displacementSnapshotSchema } from "@/features/tools/solid-capacity/displacement-contract";
import { displacementBlocks, displacementBodyVolume, displacementBottomAtFraction, displacementMinimumBottom, placeDisplacementBody, solveDisplacement, submergedBodyVolume } from "@/features/tools/solid-capacity/displacement-math";
import { interpolateDisplacement } from "@/features/tools/solid-capacity/useDisplacementPresentation";
import { createDefaultSolidCapacityTeachingInitial, solidCapacityTeachingInitial, solidCapacityTeachingInitialSchema, solidCapacityTeachingSnapshot, solidCapacityTeachingToolSchema } from "@/features/tools/solid-capacity/solid-capacity-teaching-contract";
import { solidCapacityInitialSchema, solidCapacityToolSchema } from "@/features/tools/solid-capacity/solid-capacity-contract";

describe("water displacement mathematics", () => {
  it("uses the same non-overlapping solids for geometry and volume", () => {
    const body = createDefaultDisplacementInitial().body;
    expect(displacementBodyVolume(body)).toBe(8);
    expect(displacementBlocks({ ...body, kind: "stepped" })).toHaveLength(2);
    expect(displacementBodyVolume({ ...body, kind: "stepped" })).toBe(6);
    expect(submergedBodyVolume({ ...body, kind: "stepped", bottom: 0 }, 1)).toBe(4);
    expect(submergedBodyVolume({ ...body, kind: "stepped", bottom: 0 }, 1.5)).toBe(5);
  });
  it("solves partial and full immersion analytically without changing the original water amount", () => {
    const initial = createDefaultDisplacementInitial(), area = initial.tank.width * initial.tank.depth;
    for (const kind of ["cuboid", "stepped"] as const) for (const fraction of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      const state = { ...initial, body: { ...initial.body, kind } };
      const placed = placeDisplacementBody(state, displacementBottomAtFraction(state, fraction)).state;
      const water = solveDisplacement(placed), volume = displacementBodyVolume(state.body);
      expect(water.displacedVolume).toBeCloseTo(fraction * volume, 10);
      expect(water.waterHeight).toBeCloseTo(initial.tank.waterHeight + fraction * volume / area, 10);
      expect(area * water.waterHeight - water.displacedVolume).toBeCloseTo(water.waterVolume, 10);
      expect(water.waterVolume).toBe(48);
    }
  });
  it("raising returns to the original line, not a recalculated reference", () => {
    const initial = createDefaultDisplacementInitial();
    const submerged = placeDisplacementBody(initial, 0).state;
    const raised = placeDisplacementBody(submerged, initial.tank.height + 0.4).state;
    expect(solveDisplacement(submerged).fullySubmerged).toBe(true);
    expect(solveDisplacement(raised).waterHeight).toBeCloseTo(initial.tank.waterHeight, 10);
    expect(raised.tank).toEqual(initial.tank);
  });
  it("stops at the rim, preserving water instead of silently overflowing", () => {
    const start = createDefaultDisplacementInitial();
    const initial = { ...start, tank: { ...start.tank, waterHeight: 4.9 } };
    const moved = placeDisplacementBody(initial, 0), water = solveDisplacement(moved.state);
    expect(moved.limit).toBe("rim"); expect(moved.state.body.bottom).toBeGreaterThan(0);
    expect(water.waterHeight).toBeCloseTo(initial.tank.height, 9);
    expect(water.waterVolume).toBeCloseTo(117.6); expect(water.overflow).toBe(false);
    expect(water.fullySubmerged).toBe(false); expect(displacementMinimumBottom(initial)).toBeCloseTo(moved.state.body.bottom);
    expect(displacementInitialSchema.safeParse(moved.state).success).toBe(true);
  });
  it("honors the floor and travel limit and rejects non-finite movements", () => {
    const initial = createDefaultDisplacementInitial();
    expect(placeDisplacementBody(initial, -1).limit).toBe("floor");
    expect(placeDisplacementBody(initial, 99).limit).toBe("ceiling");
    expect(placeDisplacementBody(initial, NaN).state).toBe(initial);
    expect(placeDisplacementBody(initial, Infinity).state).toBe(initial);
    const shallow = { ...initial, tank: { ...initial.tank, waterHeight: 0.1 } };
    const attempted = placeDisplacementBody(shallow, displacementBottomAtFraction(shallow, 1));
    expect(attempted.limit).toBe("floor"); expect(solveDisplacement(attempted.state).fullySubmerged).toBe(false);
  });
  it("keeps every animation frame physical and continuous", () => {
    const from = displacementSnapshot(createDefaultDisplacementInitial()), to = placeDisplacementBody(from, 0).state;
    let previous = from.tank.waterHeight;
    for (let index = 0; index <= 100; index++) {
      const frame = interpolateDisplacement(from, to, index / 100), water = solveDisplacement(frame);
      expect(water.waterVolume).toBe(48); expect(water.waterHeight).toBeGreaterThanOrEqual(previous - 1e-10);
      expect(water.overflow).toBe(false); expect(frame.body.bottom).toBeGreaterThanOrEqual(0);
      expect(frame.tank.width * frame.tank.depth * water.waterHeight - water.displacedVolume).toBeCloseTo(48, 10);
      previous = water.waterHeight;
    }
    expect(interpolateDisplacement(from, to, 0.5).body.bottom).toBeGreaterThan(to.body.bottom);
    expect(interpolateDisplacement(from, to, 0.5).body.bottom).toBeLessThan(from.body.bottom);
  });
});

describe("versioned displacement lesson contract", () => {
  it("round-trips both prepared scenes without animation frames", () => {
    const initial = createDefaultSolidCapacityTeachingInitial();
    initial.mode = "displacement"; initial.displacement = placeDisplacementBody(initial.displacement, 1.1).state;
    const snapshot = solidCapacityTeachingSnapshot(initial);
    expect(solidCapacityTeachingInitial(snapshot)).toEqual(initial);
    expect(displacementInitial(snapshot.displacement)).toEqual(initial.displacement);
    expect(solidCapacityTeachingToolSchema.safeParse({ toolId: "solid-capacity", contentVersion: "solid-capacity-lesson-v2", payload: { title: "Displacement", initial } }).success).toBe(true);
  });
  it("keeps v1 frozen boundaries and disallows unknown modes, extra data or movement frames", () => {
    const initial = createDefaultSolidCapacityTeachingInitial();
    expect(solidCapacityInitialSchema.safeParse(initial).success).toBe(false);
    expect(solidCapacityToolSchema.safeParse({ toolId: "solid-capacity", contentVersion: "solid-capacity-lesson-v1", payload: { title: "Legacy", initial } }).success).toBe(false);
    expect(solidCapacityTeachingInitialSchema.safeParse({ ...initial, mode: "quiz" }).success).toBe(false);
    expect(solidCapacityTeachingInitialSchema.safeParse({ ...initial, frame: {} }).success).toBe(false);
    expect(displacementSnapshotSchema.safeParse({ ...displacementSnapshot(initial.displacement), cameraRevision: -1 }).success).toBe(false);
  });
  it("rejects impossible fits, hidden overflow, missing and non-finite fields", () => {
    const state = createDefaultDisplacementInitial();
    for (const bad of [
      { ...state, tank: { ...state.tank, waterHeight: 5.1 } },
      { ...state, body: { ...state.body, bottom: -0.1 } },
      { ...state, body: { ...state.body, bottom: 7 } },
      { ...state, body: { ...state.body, kind: "sphere" } },
      { ...state, body: { ...state.body, depth: 4 } },
      { ...state, body: { ...state.body, height: Infinity } },
      { ...state, body: { ...state.body, bottom: 0 }, tank: { ...state.tank, waterHeight: 4.9 } },
      { ...state, body: { ...state.body, frame: 1 } },
      { ...state, showAmounts: undefined },
    ]) expect(displacementInitialSchema.safeParse(bad).success).toBe(false);
  });
});
