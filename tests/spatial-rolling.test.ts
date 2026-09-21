import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { SPATIAL_ROLL_DIRECTIONS, planSpatialRoll, spatialRollPoint, unitCubeCorners } from "@/features/tools/spatial-interaction/rolling";
import { interpolateRigidPoses } from "@/features/tools/spatial-interaction/rigid-motion";
import { cubeRollOperation } from "@/features/tools/spatial-lab/cube-structures-roll";
import { applyCubeOperation, createCubeHistory, appendCubeOperation } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeHistorySchema, legacyCubeHistorySchema } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createSomaInitial, somaRoll } from "@/features/tools/soma-cube/model";
import { somaCells, SOMA_IDS } from "@/features/tools/soma-cube/pieces";
import { somaRigidPoses } from "@/features/tools/soma-cube/motion";
import { createDie, sampleControlledRoll } from "@/features/tools/spatial-lab/dice-teaching-model";
import { createSolidEntity } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { solidRollTarget } from "@/features/tools/solid-geometry/solid-geometry-roll";
import { interpolateSolidEntities } from "@/features/tools/solid-geometry/solid-geometry-motion";
import { getSolidBounds } from "@/features/tools/solid-geometry/solid-geometry";

describe("shared contact-edge rolling", () => {
  it.each(SPATIAL_ROLL_DIRECTIONS)("rolls a cube along %s with an elevated middle frame, not a translation", (direction) => {
    const point = { x: 0, y: 0, z: 0 }, plan = planSpatialRoll(unitCubeCorners([point]), direction)!;
    const half = spatialRollPoint(point, plan, 0.5), end = spatialRollPoint(point, plan);
    expect(half.y).toBeCloseTo(Math.SQRT1_2 - 0.5); expect(end.y).toBe(0);
    expect(end[direction[0] as "x" | "z"]).toBe(direction[1] === "+" ? 1 : -1);
    const die = createDie("d", "right", { x: 0, y: 0.5, z: 0 });
    expect(sampleControlledRoll(die, direction, 0.5).position.y).toBeCloseTo(half.y + 0.5);
  });
  it("keeps exact grids and reversible current history; legacy history still rejects new rotations", () => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]);
    const ids = initial.initial.cubes.map((cube) => cube.id);
    const operation = cubeRollOperation(initial.initial, ids, "x+")!;
    expect(operation.pivot).toEqual({ x: 0.5, y: -0.5, z: 0 });
    const result = applyCubeOperation(initial.initial, operation);
    expect(result.cubes.map((cube) => cube.position)).toEqual([{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]);
    const history = appendCubeOperation(initial, operation);
    expect(cubeHistorySchema.safeParse(history).success).toBe(true);
    expect(legacyCubeHistorySchema.safeParse(history).success).toBe(false);
    expect(applyCubeOperation(result, { ...operation, turn: 1 })).toEqual(initial.initial);
  });
  it("blocks occupied landings and an overhead obstruction during the arc", () => {
    for (const other of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]) {
      const state = createCubeHistory([{ x: 0, y: 0, z: 0 }, other]).initial;
      expect(cubeRollOperation(state, [state.cubes[0].id], "x+")).toBeNull();
    }
  });
  it.each(SPATIAL_ROLL_DIRECTIONS)("uses the bounding-box edge when %s has no physical support", (direction) => {
    const along = direction[0] as "x" | "z", sign = direction[1] === "+" ? 1 : -1;
    const cells = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0, [along]: sign }];
    const vertices = unitCubeCorners(cells), plan = planSpatialRoll(vertices, direction)!;
    expect(plan.support?.virtual).toBe(true); expect(plan.pivot.y).toBe(-0.5); expect(plan.pivot[along]).toBe(sign * 1.5);
    expect(plan.support!.to[plan.axis] - plan.support!.from[plan.axis]).toBe(1);
    for (let step = 0; step <= 20; step++) for (const vertex of vertices) expect(spatialRollPoint(vertex, plan, step / 20).y).toBeGreaterThanOrEqual(-0.500001);
    const history = createCubeHistory(cells), ids = history.initial.cubes.map((cube) => cube.id), operation = cubeRollOperation(history.initial, ids, direction)!;
    expect(operation).not.toBeNull(); expect(operation).not.toHaveProperty("support");
    const after = applyCubeOperation(history.initial, operation);
    expect(after.cubes.map((cube) => cube.position)).toEqual(history.initial.cubes.map((cube) => spatialRollPoint(cube.position, plan)));
    expect(cubeHistorySchema.safeParse(appendCubeOperation(history, operation)).success).toBe(true);
    expect(applyCubeOperation(after, { ...operation, turn: -operation.turn as -1 | 1 })).toEqual(history.initial);
    const obstacle = spatialRollPoint(cells[0], plan), blocked = createCubeHistory([...cells, obstacle]).initial;
    const movingIds = blocked.cubes.filter((cube) => cells.some((p) => p.x === cube.position.x && p.y === cube.position.y && p.z === cube.position.z)).map((cube) => cube.id);
    expect(cubeRollOperation(blocked, movingIds, direction)).toBeNull();
  });
  it.each(SOMA_IDS)("keeps %s rigid and floor contact throughout each available roll", (id) => {
    for (let orientation = 0; orientation < 24; orientation++) for (const direction of SPATIAL_ROLL_DIRECTIONS) {
      const before = { ...createSomaInitial(), selectedId: id, pieces: [{ id, orientation, position: { x: 0, y: 0, z: 0 } }] };
      const next = somaRoll(before, direction); if (!next) continue;
      const plan = planSpatialRoll(unitCubeCorners(somaCells(before.pieces[0])), direction)!;
      const a = somaRigidPoses(before.pieces), b = somaRigidPoses(next.pieces);
      const [pose] = interpolateRigidPoses(a, b, 0.5);
      expect(new Quaternion(...a[0].quaternion).angleTo(new Quaternion(...pose.quaternion))).toBeCloseTo(Math.PI / 4);
      const canonical = somaCells({ id, orientation: 0, position: { x: 0, y: 0, z: 0 } });
      const positions = canonical.map((p) => new Vector3(p.x, p.y, p.z).applyQuaternion(new Quaternion(...pose.quaternion)).add(new Vector3(pose.position.x, pose.position.y, pose.position.z)));
      const expected = somaCells(before.pieces[0]).map((p) => spatialRollPoint(p, plan, 0.5));
      for (const p of positions) expect(expected.some((q) => p.distanceTo(new Vector3(q.x, q.y, q.z)) < 1e-6)).toBe(true);
    }
  });
  it("rolls a cuboid by its actual dimensions and keeps the intermediate solid above its support plane", () => {
    const box = createSolidEntity("cuboid", "box"), result = solidRollTarget(box, "x+", [box])!;
    expect(result.target.position.x).toBeCloseTo(2.5); expect(result.target.position.y).toBeCloseTo(1.5);
    for (let step = 0; step <= 20; step++) {
      const frame = interpolateSolidEntities([box], [result.target], step / 20)[0];
      expect(getSolidBounds(frame).min.y).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(solidRollTarget(createSolidEntity("sphere", "ball"), "x+", [])).toBeNull();
  });
});
