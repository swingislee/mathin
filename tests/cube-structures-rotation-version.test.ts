import { describe, expect, it } from "vitest";
import { CUBE_COLORS, CUBE_STRUCTURES_DRAFT_VERSION, CUBE_STRUCTURES_ROTATION_DRAFT_VERSION, applyCubeOperation, createCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeDraftSnapshot, cubeHistorySchema, cubeStructureStateSchema, currentCubeHistorySchema, legacyCubeHistorySchema, legacyCubeStructureStateSchema, parseCubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession, cubeSessionScene, cubeSnapshotHistory, operateCubeSession, replaceCubeRecordedStep, startCubeRecording, undoCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { cubeRotationOperation } from "@/features/tools/spatial-lab/cube-structures-rotation";

const cells = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
describe("explicit rotation history upgrade and frozen compatibility", () => {
  it("keeps ordinary old histories byte-for-byte unchanged", () => {
    const history = createCubeHistory(cells);
    expect(history.version).toBe(CUBE_STRUCTURES_DRAFT_VERSION);
    expect(JSON.stringify(legacyCubeHistorySchema.parse(history))).toBe(JSON.stringify(history));
    expect(JSON.stringify(cubeHistorySchema.parse(history))).toBe(JSON.stringify(history));
    expect(currentCubeHistorySchema.safeParse(history).success).toBe(false);
  });

  it("captures one atomic v4 command, saves, restores, undoes and redoes the same group", () => {
    const initial = startCubeRecording(createCubeSession(cells));
    const state = cubeSessionScene(initial);
    const operation = cubeRotationOperation(state, state.cubes.map((cube) => cube.id), "z", 1)!;
    const next = operateCubeSession(initial, operation);
    expect(next.work.version).toBe(CUBE_STRUCTURES_ROTATION_DRAFT_VERSION);
    expect(next.lesson?.version).toBe(CUBE_STRUCTURES_ROTATION_DRAFT_VERSION);
    expect(next.lesson?.operations).toEqual([operation]);
    const saved = cubeDraftSnapshot(next, 0);
    const reopened = parseCubeDraftSnapshot(JSON.stringify(saved));
    expect(reopened.session.recording).toBe("paused");
    expect(cubeSessionScene(reopened.session)).toEqual(cubeSessionScene(next));
    expect(cubeSessionScene(undoCubeSession(next, -1))).toEqual(state);
    expect(cubeSessionScene(undoCubeSession(undoCubeSession(next, -1), 1))).toEqual(cubeSessionScene(next));
    expect(legacyCubeHistorySchema.safeParse(next.work).success).toBe(false);
    expect(legacyCubeHistorySchema.safeParse({ ...next.work, version: CUBE_STRUCTURES_DRAFT_VERSION }).success).toBe(false);
    expect(currentCubeHistorySchema.safeParse(next.work).success).toBe(true);
    expect(initial.work.operations).toEqual([]);
  });

  it("keeps surface-label orientation only in v4 snapshots and rejects malformed tangents", () => {
    let state = createCubeHistory([{ x: 0, y: 0, z: 0 }]).initial;
    state = applyCubeOperation(state, { kind: "mark", ids: ["cube-1"], shape: "triangle", placement: "face", direction: "z+", color: CUBE_COLORS[1] });
    const result = applyCubeOperation(state, cubeRotationOperation(state, ["cube-1"], "z", 1)!);
    expect(cubeSnapshotHistory(result).version).toBe(CUBE_STRUCTURES_ROTATION_DRAFT_VERSION);
    expect(cubeStructureStateSchema.safeParse(result).success).toBe(true);
    expect(legacyCubeStructureStateSchema.safeParse(result).success).toBe(false);
    const cube = result.cubes[0];
    expect(cubeStructureStateSchema.safeParse({ ...result, cubes: [{ ...cube, mark: { ...cube.mark, laneDirection: "z-" } }] }).success).toBe(false);
    expect(cubeStructureStateSchema.safeParse({ ...result, cubes: [{ ...cube, mark: { ...cube.mark, quarterTurns: 4 } }] }).success).toBe(false);
  });

  it("upgrades a replaced recorded step explicitly while failed rotations retain both histories", () => {
    const initial = startCubeRecording(createCubeSession(cells));
    const moved = operateCubeSession(initial, { kind: "move", ids: ["cube-2"], axis: "x", distance: 1 });
    const rotation = cubeRotationOperation(cubeSessionScene(initial), ["cube-1", "cube-2"], "z", 1)!;
    const replaced = replaceCubeRecordedStep(moved, 0, rotation);
    expect(replaced.issue).toBeNull();
    expect(replaced.session.lesson?.version).toBe(CUBE_STRUCTURES_ROTATION_DRAFT_VERSION);
    expect(cubeHistorySchema.safeParse(replaced.session.lesson).success).toBe(true);
    expect(operateCubeSession(initial, { ...rotation, pivot: { x: -12, y: -12, z: 0 } })).toBe(initial);
  });
});
