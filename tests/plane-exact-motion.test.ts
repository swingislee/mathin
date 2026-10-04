import { describe, expect, it } from "vitest";
import { planeGeometryScenes } from "@/features/tools/plane-geometry/scenes";
import { dragClockState, isExactTangramState } from "@/features/tools/plane-geometry/exact-state";
import { clockHands, tangramPiece } from "@/features/tools/plane-geometry/model";
import { isValidPlaneGeometryState } from "@/features/tools/plane-geometry/validation";
import { polygonArea } from "@/features/tools/planar-interaction/geometry";
import { planarSnapshot, planarSnapshotForTool, planarStateSchema, type PlanarState } from "@/features/tools/planar-kit/contract";
import { interpolatePlanarState } from "@/features/tools/planar-kit/presentation";

const scene = (id: string) => planeGeometryScenes.find((entry) => entry.id === id)!;
const clock = scene("60"), tangram = scene("02");
const clockAt = (minutes: number): PlanarState => ({ ...clock.create(), params: { ...clock.create().params, minutes } });
const position = (minutes: number, hand: "minute" | "hour", turn = 0, gripOffset = 0) => {
  const angle = (minutes * (hand === "minute" ? 6 : 0.5) - 90 + turn + gripOffset) * Math.PI / 180;
  const radius = hand === "minute" ? 180 : 125;
  return { x: 480 + radius * Math.cos(angle), y: 350 + radius * Math.sin(angle) };
};
const move = (start: PlanarState, hand: "minute" | "hour", turn: number, previous = start, gripOffset = 0) => {
  const grab = position(start.params.minutes, hand, 0, gripOffset), point = position(start.params.minutes, hand, turn, gripOffset);
  return clock.drag!(start, hand, point, { x: point.x - grab.x, y: point.y - grab.y }, { previous });
};
const pieceAreas = (state: PlanarState) => Array.from({ length: 7 }, (_, index) => polygonArea(tangramPiece(index, state.points[`piece${index}`], 85, state.params[`angle${index}`], state.params[`reflection${index}`])));

describe("continuous clock-hand gestures", () => {
  for (const hand of ["minute", "hour"] as const) for (const direction of [-1, 1]) {
    it(`unwraps ${hand} through half-turns and multiple turns in direction ${direction}`, () => {
      const start = clockAt(hand === "hour" ? direction > 0 ? 120 : 1200 : 720), before = structuredClone(start);
      const limit = hand === "hour" ? 540 : 1440, speed = hand === "hour" ? 0.5 : 6;
      let previous = start;
      for (let turn = 15; turn <= limit; turn += 15) {
        previous = move(start, hand, turn * direction, previous);
        expect(previous.params.minutes).toBeCloseTo(start.params.minutes + turn * direction / speed, 8);
        expect(isValidPlaneGeometryState(previous)).toBe(true);
        expect({ ...previous.params, minutes: start.params.minutes }).toEqual(start.params);
        expect(previous.points).toEqual(start.points); expect(previous.flags).toEqual(start.flags);
        const angles = clockHands(previous.params.minutes), expected = clockHands(start.params.minutes + turn * direction / speed);
        expect(angles.smallerAngle).toBeCloseTo(expected.smallerAngle, 7);
      }
      expect(start).toEqual(before);
    });
  }

  it("keeps direction changes in one gesture continuous and reaches its original time exactly", () => {
    const start = clockAt(720); let previous = start;
    const turns = [...Array.from({ length: 48 }, (_, index) => (index + 1) * 15), ...Array.from({ length: 72 }, (_, index) => 720 - (index + 1) * 15), ...Array.from({ length: 24 }, (_, index) => -360 + (index + 1) * 15)];
    for (const turn of turns) {
      previous = move(start, "minute", turn, previous);
      expect(previous.params.minutes).toBeCloseTo(720 + turn / 6, 8);
    }
    expect(previous).toBe(start);
  });

  it("retains the grip offset instead of jumping the needle to the pointer center", () => {
    const start = clockAt(125.25);
    expect(move(start, "minute", 12, start, 4).params.minutes).toBeCloseTo(127.25, 9);
    expect(move(start, "hour", -12, start, -4).params.minutes).toBeCloseTo(101.25, 9);
  });

  it("keeps the one-day bounds and preserves the last direction at the clock center", () => {
    for (const hand of ["minute", "hour"] as const) for (const direction of [-1, 1]) {
      const start = clockAt(direction > 0 ? 1439 : 1); let previous = start;
      for (let turn = 10; turn <= 100; turn += 10) previous = move(start, hand, turn * direction, previous);
      expect(previous.params.minutes).toBe(direction > 0 ? 1440 : 0);
      expect(isValidPlaneGeometryState(previous)).toBe(true);
    }
    const start = clockAt(120), previous = move(start, "minute", 60), grab = position(120, "minute");
    expect(dragClockState(start, "minute", { x: 480, y: 350 }, { x: 480 - grab.x, y: 350 - grab.y }, previous)).toBe(previous);
    expect(dragClockState(start, "unknown", grab, { x: 0, y: 0 })).toBe(start);
    expect(dragClockState(start, "minute", { x: NaN, y: 350 }, { x: 0, y: 0 })).toBe(start);
  });

  it("keeps exact input and both hand speeds on the original v1 persistence contract", () => {
    const start = clockAt(720.125), moved = move(start, "hour", 37.5);
    expect(moved.params.minutes).toBeCloseTo(795.125, 9);
    const snapshot = planarSnapshot(moved), roundTrip = JSON.parse(JSON.stringify(snapshot));
    expect(planarSnapshotForTool("plane-clock", "plane-clock-lesson-v1").parse(roundTrip)).toEqual(snapshot);
    expect(Object.keys(moved.params)).toEqual(Object.keys(start.params));
  });

  it("holds each day boundary while the pointer continues around it and releases when that same gesture returns", () => {
    for (const hand of ["minute", "hour"] as const) for (const direction of [-1, 1]) {
      const start = clockAt(direction > 0 ? 1440 : 0); let previous = start;
      for (let turn = 15; turn <= 720; turn += 15) {
        previous = move(start, hand, turn * direction, previous);
        expect(previous.params.minutes).toBe(start.params.minutes);
      }
      for (let turn = 705; turn >= 0; turn -= 15) {
        previous = move(start, hand, turn * direction, previous);
        expect(previous.params.minutes).toBe(start.params.minutes);
      }
      expect(previous).toBe(start);
      const released = move(start, hand, -15 * direction, previous);
      expect(released.params.minutes).toBeCloseTo(start.params.minutes - 15 * direction / (hand === "minute" ? 6 : 0.5), 8);
      expect(Object.keys(released.params)).toEqual(Object.keys(start.params));
    }
  });
});

describe("tangram presentation frames and exact material states", () => {
  it("requires a rigid reflection endpoint for every one of the seven pieces", () => {
    const start = tangram.create(); expect(tangram.isExact!(start)).toBe(true);
    for (let index = 0; index < 7; index++) for (const reflection of [-1, -0.75, -0.5, 0, 0.5, 0.75, 1 - 1e-15, 1]) {
      const state = { ...start, params: { ...start.params, [`reflection${index}`]: reflection } };
      expect(isExactTangramState(state)).toBe(reflection === 1 || reflection === -1);
      expect(tangram.isExact!(state)).toBe(reflection === 1 || reflection === -1);
    }
    expect(scene("01").isExact).toBeUndefined();
  });

  it("retains all piece areas at each flip endpoint and treats only intermediate projections as inexact", () => {
    const original = tangram.create(), action = tangram.actions!.find((entry) => entry.id === "piece-mirror")!;
    for (let index = 0; index < 7; index++) for (const reflection of [-1, 1]) {
      const start = { ...original, params: { ...original.params, active: index, [`reflection${index}`]: reflection } }, end = action.run(start, { selected: `piece${index}` });
      expect(end.params[`reflection${index}`]).toBe(-reflection);
      for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const frame = interpolatePlanarState(start, end, progress);
        expect(tangram.isExact!(frame)).toBe(progress === 0 || progress === 1);
        expect(planarStateSchema.safeParse(frame).success).toBe(true);
      }
      pieceAreas(end).forEach((area, ordinal) => expect(area).toBeCloseTo(pieceAreas(start)[ordinal], 7));
      expect(end.points).toEqual(start.points); expect(end.params.count).toBe(7);
    }
  });

  it("keeps old flattened snapshots readable without silently normalizing their shape", () => {
    const start = tangram.create(), legacy = { ...start, params: { ...start.params, reflection0: 0, reflection6: 0.5 } }, original = JSON.stringify(legacy);
    const snapshot = planarSnapshot(legacy), serialized = JSON.parse(JSON.stringify(snapshot));
    for (const [tool, version] of [["plane-tangram", "plane-tangram-lesson-v1"], ["plane-pieces", "plane-pieces-lesson-v1"]] as const) {
      expect(planarSnapshotForTool(tool, version).parse(serialized)).toEqual(snapshot);
    }
    expect(isExactTangramState(legacy)).toBe(false); expect(JSON.stringify(legacy)).toBe(original);
  });
});
