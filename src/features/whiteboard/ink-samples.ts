import type { StrokeSample } from "./types";

export function isAlignedStrokeSamples(value: unknown, count: number): value is StrokeSample[] {
  if (!Array.isArray(value) || value.length !== count) return false;
  let previousTime = 0;
  for (const sample of value) {
    if (!Array.isArray(sample) || sample.length !== 2 || typeof sample[0] !== "number"
      || !Number.isFinite(sample[0]) || sample[0] < previousTime
      || (sample[1] !== null && (typeof sample[1] !== "number" || !Number.isFinite(sample[1]) || sample[1] < 0 || sample[1] > 1))) return false;
    previousTime = sample[0];
  }
  return true;
}
