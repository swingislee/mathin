import { describe, expect, it } from "vitest";
import { editField, type Runway, type TimeAnchor } from "@/features/tools/motion-lab/shared";
import { initialMotionScene } from "@/features/tools/scenes/numeric-teaching-content";

const runway = (patch: Partial<Runway> = {}): Runway => ({
  ...initialMotionScene().runways[0], distance: 60, time: 10, speed: 6, ...patch,
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
