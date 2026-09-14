import { describe, expect, it } from "vitest";
import { createCubeNetGalleryCatalog } from "@/features/spatial-math/domain";
import { cubeNetPlanarSuccessors, normalizedCubeNetShape, planCubeNetPlanarChange, sampleCubeNetPlanarStep, transformCubeNetCell } from "@/features/tools/spatial-lab/cube-net-planar-motion";

describe("cube-net planar quarter-turn transformations", () => {
  it("connects every pair with a shortest quarter-turn path through non-overlapping connected intermediate shapes", () => {
    const entries = createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal");
    let maxMoving = 0, maxSteps = 0;
    for (const from of entries) for (const target of entries) {
      const tiles = from.net.cells.map((cell, index) => ({ ...cell, id: `paper.${index}`, quarterTurns: 0 }));
      const plan = planCubeNetPlanarChange(tiles, target.net.cells);
      maxMoving = Math.max(maxMoving, plan.movingIds.length); maxSteps = Math.max(maxSteps, plan.steps.length);
      const goals = new Set(Array.from({ length: 8 }, (_, turn) => normalizedCubeNetShape(target.net.cells.map((cell) => transformCubeNetCell(cell, turn)))));
      expect(goals.has(normalizedCubeNetShape(plan.target)), `${from.id} → ${target.id}`).toBe(true);
      // 独立按层枚举：每一个更短的层都到不了目标，不只检查最终形态。
      let layer = [tiles];
      const visited = new Set([normalizedCubeNetShape(tiles)]);
      for (let depth = 0; depth < plan.steps.length; depth++) {
        expect(layer.some((cells) => goals.has(normalizedCubeNetShape(cells))), `${from.id} → ${target.id}: ${depth}`).toBe(false);
        layer = layer.flatMap((cells) => cubeNetPlanarSuccessors(cells).flatMap((step) => {
          const key = normalizedCubeNetShape(step.to); if (visited.has(key)) return [];
          visited.add(key); return [[...step.to]];
        }));
      }
      expect(layer.some((cells) => goals.has(normalizedCubeNetShape(cells)))).toBe(true);
      for (const step of plan.steps) {
        expect([-1, 1]).toContain(step.direction);
        expect(new Set(step.to.map((tile) => `${tile.x},${tile.y}`)).size).toBe(6);
        const end = sampleCubeNetPlanarStep(step, 1);
        step.to.forEach((tile, index) => { expect(end[index].x).toBeCloseTo(tile.x); expect(end[index].y).toBeCloseTo(tile.y); });
        for (const fixed of tiles.filter((tile) => !plan.movingIds.includes(tile.id))) {
          expect(step.to.find((tile) => tile.id === fixed.id)).toEqual(fixed);
        }
      }
    }
    expect(maxMoving).toBeLessThanOrEqual(5);
    expect(maxSteps).toBeLessThanOrEqual(4);
  }, 20_000);
});
