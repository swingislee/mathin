import { describe, expect, it } from "vitest";
import { simulateDiceThrow, sampleDiceThrow } from "@/features/tools/spatial-lab/dice-physics";
import { createDie, faceValue, worldFace } from "@/features/tools/spatial-lab/dice-teaching-model";

function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
describe("real dice rigid-body simulation", () => {
  it.each([{ count: 1, seed: 12345, settled: true }, { count: 2, seed: 24690, settled: true }, { count: 8, seed: 18, settled: true }, { count: 8, seed: 98760, settled: false }])("simulates $count dice (seed $seed) with contact, unit rotations and physical outcomes", async ({ count, seed, settled }) => {
    const dice = Array.from({ length: count }, (_, i) => createDie(`die-${i}`, i % 2 ? "left" : "right", { x: i, y: 0.5, z: 0 }));
    const result = await simulateDiceThrow(dice, seeded(seed));
    expect(result.frames.length).toBeGreaterThan(60);
    expect(result.durationMs).toBeGreaterThan(1000);
    const final = result.frames.at(-1)!;
    expect(final.map((die) => die.hand)).toEqual(dice.map((die) => die.hand));
    for (const frame of result.frames) for (const die of frame) {
      expect(die.position.y).toBeGreaterThan(0.38);
      expect(Math.hypot(die.rotation.x, die.rotation.y, die.rotation.z, die.rotation.w)).toBeCloseTo(1, 3);
    }
    for (const die of final) {
      expect(Math.abs(die.position.x)).toBeLessThan(6); expect(Math.abs(die.position.z)).toBeLessThan(6);
      const top = worldFace(die, "y+"), bottom = worldFace(die, "y-");
      if (top && bottom) expect(faceValue(die.hand, top) + faceValue(die.hand, bottom)).toBe(7);
    }
    expect(result.settled).toBe(settled);
    // 倚在别的骰子上时保留真实斜姿态并报告未平稳落定，不伪造一个结果。
    if (!settled) expect(final.some((die) => worldFace(die, "y+", 0.99) === null)).toBe(true);
    expect(sampleDiceThrow(result, result.durationMs)).toEqual(final);
    expect(sampleDiceThrow(result, 8).some((die, i) => die.position.y !== result.frames[0][i].position.y)).toBe(true);
  });
  it("derives different face outcomes from different initial velocities and can cancel", async () => {
    const die = createDie("test", "right", { x: 0, y: 0.5, z: 0 });
    const outcomes = new Set<number>();
    for (const seed of [18, 345, 879, 4512]) {
      const result = await simulateDiceThrow([die], seeded(seed));
      const final = result.frames.at(-1)![0], top = worldFace(final, "y+");
      if (top) outcomes.add(faceValue(final.hand, top));
    }
    expect(outcomes.size).toBeGreaterThan(1);
    await expect(simulateDiceThrow([die], seeded(42), () => true)).rejects.toThrow("dice-throw-cancelled");
    const afterCancel = await simulateDiceThrow([die], seeded(42));
    expect(afterCancel.frames.length).toBeGreaterThan(60);
  });
});
