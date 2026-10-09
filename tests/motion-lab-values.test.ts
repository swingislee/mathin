import { describe, expect, it } from "vitest";
import { editField, getRulerMarks, getTickInterval, type Runway, type TimeAnchor } from "@/features/tools/motion-lab/shared";
import { initialMotionScene } from "@/features/tools/scenes/numeric-teaching-content";

const runway = (patch: Partial<Runway> = {}): Runway => ({
  ...initialMotionScene().runways[0], distance: 60, time: 10, speed: 6, ...patch,
});

describe("Motion Lab ruler scale", () => {
  it.each([Number.MIN_VALUE, 1e-323, 1e-310, 1e-18, 1e-7, 0.0042, 0.3, 1, 100, 1e9, Number.MAX_VALUE])(
    "keeps finite length %s bounded with distinct readable marks",
    (length) => {
      expect(getTickInterval(length)).toBeGreaterThan(0);
      const marks = getRulerMarks(length);
      expect(marks.length).toBeGreaterThan(1);
      expect(marks.length).toBeLessThanOrEqual(16);
      expect(marks[0]).toMatchObject({ value: 0 });
      expect(new Set(marks.map((mark) => mark.label)).size).toBe(marks.length);
      marks.forEach((mark, index) => {
        expect(Number.isFinite(mark.value)).toBe(true);
        expect(mark.value).toBeLessThanOrEqual(length);
        if (index) expect(mark.value).toBeGreaterThan(marks[index - 1].value);
      });
    },
  );

  it("preserves ordinary scale density and decimal labels", () => {
    expect(getRulerMarks(100)).toEqual(Array.from({ length: 11 }, (_, index) => ({ value: index * 10, label: String(index * 10) })));
    expect(getRulerMarks(0.3).map((mark) => mark.label)).toEqual(["0.00", "0.05", "0.10", "0.15", "0.20", "0.25", "0.30"]);
    expect(getRulerMarks(1e-18).at(-1)?.label).toBe("1e-18");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid ruler length %s", (length) => {
    expect(getRulerMarks(length)).toEqual([]);
  });
});

describe("Motion Lab time changes preserve the known quantity", () => {
  it.each<{
    solve: Runway["solve"]; lastInput?: TimeAnchor; distance: number; speed: number; nextSolve: Runway["solve"];
  }>([
    { solve: "speed", lastInput: "speed", distance: 60, speed: 60, nextSolve: "speed" },
    { solve: "distance", lastInput: "distance", distance: 6, speed: 6, nextSolve: "distance" },
    { solve: "time", lastInput: "distance", distance: 60, speed: 60, nextSolve: "speed" },
    { solve: "time", lastInput: "speed", distance: 6, speed: 6, nextSolve: "distance" },
    { solve: "time", distance: 60, speed: 60, nextSolve: "speed" },
  ])("sets one second with $solve automatic and last input $lastInput", ({ solve, lastInput, distance, speed, nextSolve }) => {
    const initial = runway({ solve, facingRight: false, x: 25 });
    const result = editField(initial, "time", 1, lastInput);
    expect(result).toEqual({ ...initial, time: 1, distance, speed, solve: nextSolve });
    expect(initial).toMatchObject({ time: 10, distance: 60, speed: 6, solve });
    expect(editField(result, "time", 1, lastInput)).toEqual(result);
  });

  it("preserves explicit zero speed and supports fractional and maximum distances", () => {
    expect(editField(runway({ solve: "time", speed: 0, time: 0 }), "time", 1, "speed"))
      .toMatchObject({ distance: 0, time: 1, speed: 0, solve: "distance" });
    for (const distance of [0, 0.0042, 1e9]) {
      expect(editField(runway({ distance }), "time", 1))
        .toMatchObject({ distance, time: 1, speed: distance, solve: "speed" });
    }
  });

  it("uses the same known quantity for arbitrary times and keeps direct distance/speed editing", () => {
    expect(editField(runway({ solve: "time" }), "time", 2.5, "speed"))
      .toMatchObject({ time: 2.5, speed: 6, distance: 15, solve: "distance" });
    expect(editField(runway({ solve: "distance" }), "distance", 90))
      .toMatchObject({ distance: 90, time: 15, speed: 6, solve: "time" });
    expect(editField(runway(), "speed", 8))
      .toMatchObject({ distance: 80, time: 10, speed: 8, solve: "distance" });
  });
});
