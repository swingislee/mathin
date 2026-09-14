import { describe, expect, it } from "vitest";
import { createCubeNetGalleryCatalog } from "@/features/spatial-math/domain";
import { normalizedCubeNetShape, planCubeNetPlanarChange, sampleCubeNetPlanarStep, transformCubeNetCell } from "@/features/tools/spatial-lab/cube-net-planar-motion";

describe("cube-net planar quarter-turn transformations", () => {
  it("connects every pair of the 11 nets with explicit legal quarter-turn steps", () => {
    const entries = createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal");
    const legal = new Set(entries.flatMap((entry) => Array.from({ length: 8 }, (_, turn) => normalizedCubeNetShape(entry.net.cells.map((cell) => transformCubeNetCell(cell, turn))))));
    let maxMoving = 0, maxSteps = 0;
    for (const from of entries) for (const target of entries) {
      const tiles = from.net.cells.map((cell, index) => ({ ...cell, id: `paper.${index}`, quarterTurns: 0 }));
      const plan = planCubeNetPlanarChange(tiles, target.net.cells);
      maxMoving = Math.max(maxMoving, plan.movingIds.length); maxSteps = Math.max(maxSteps, plan.steps.length);
      const goals = new Set(Array.from({ length: 8 }, (_, turn) => normalizedCubeNetShape(target.net.cells.map((cell) => transformCubeNetCell(cell, turn)))));
      expect(goals.has(normalizedCubeNetShape(plan.target)), `${from.id} → ${target.id}`).toBe(true);
      for (const step of plan.steps) {
        expect([-1, 1]).toContain(step.direction);
        expect(legal.has(normalizedCubeNetShape(step.to))).toBe(true);
        const end = sampleCubeNetPlanarStep(step, 1);
        step.to.forEach((tile, index) => { expect(end[index].x).toBeCloseTo(tile.x); expect(end[index].y).toBeCloseTo(tile.y); });
        for (const fixed of tiles.filter((tile) => !plan.movingIds.includes(tile.id))) {
          expect(step.to.find((tile) => tile.id === fixed.id)).toEqual(fixed);
        }
      }
    }
    expect(maxMoving).toBeLessThanOrEqual(3);
    expect(maxSteps).toBeLessThanOrEqual(12);
  }, 20_000);
});
