import { describe, expect, it } from "vitest";
import { createVoxelSet, projectVoxels } from "@/features/spatial-math/domain";
import { projectUnitCubePositions } from "@/features/spatial-math/domain/voxel-kernel";
import { applyCubeOperation, cubeDisplayPosition } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeDisplayPositions, cubePresentationState, interpolateCubePositions } from "@/features/tools/spatial-lab/cube-structures-motion";
import { cubeSessionScene, operateCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { freezeToolScene, parseToolScene } from "@/features/tools/scenes/contract";
import { createClassroomToolState, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { projectionInitial, projectionSnapshot } from "@/features/tools/projection/projection-contract";
import { projectionGeometry, projectionPoint } from "@/features/tools/projection/projection-geometry";
import { projectionTool } from "./fixtures/projection-tool";

describe("independent projection scene", () => {
  it("uses the existing projection kernel with the same signed axes and merged depth columns", () => {
    const state = projectionTool().payload.initial.structure;
    const cells = state.cubes.map((c) => c.position), voxels = createVoxelSet(cells);
    for (const view of ["front", "right", "top"] as const) {
      expect(projectUnitCubePositions(cells, view)).toEqual(projectVoxels(voxels, view));
      expect(projectionGeometry(state, view).cells.map(({ u, v, stackSize }) => ({ u, v, stackSize })))
        .toEqual(projectVoxels(voxels, view).cells.map(({ u, v, stackSize }) => ({ u, v, stackSize })));
    }
    expect(["front", "right", "top"].map((view) => projectionGeometry(state, view as "front").cells.length)).toEqual([4, 3, 5]);
    expect(projectionPoint("front", 2, 3, -1)).toEqual([2, 3, -1]);
    expect(projectionPoint("right", -2, 3, -1)).toEqual([-1, 3, 2]);
    expect(projectionPoint("top", 2, -3, -1)).toEqual([2, -1, 3]);
  });
  it("follows fractional drag frames and display offsets without creating a second animation or integer voxel document", () => {
    const state = projectionTool().payload.initial.structure;
    const target = applyCubeOperation(state, { kind: "move", ids: state.cubes.map((c) => c.id), axis: "x", distance: 2 });
    const frame = cubePresentationState(target, interpolateCubePositions(cubeDisplayPositions(state.cubes), cubeDisplayPositions(target.cubes), 0.25));
    expect(frame.cubes[0].position.x).toBe(target.cubes[0].position.x);
    const x = cubeDisplayPosition(frame.cubes[0]).x;
    expect(x).toBeGreaterThan(state.cubes[0].position.x); expect(x).toBeLessThan(target.cubes[0].position.x);
    expect(projectionGeometry(frame, "front").cells.some((cell) => cell.u === x)).toBe(true);
    expect(projectionGeometry(target, "front").cells).not.toEqual(projectionGeometry(frame, "front").cells);
    const hidden = { ...state, hiddenCubeIds: state.cubes.map((c) => c.id) };
    expect(projectionGeometry(hidden, "top")).toMatchObject({ cells: [], frame: [], bounds: null });
  });
  it("freezes the teaching start and options, rejecting private references and invalid geometry", () => {
    const tool = projectionTool(), frozen = freezeToolScene(tool);
    tool.payload.initial.views.pop();
    expect(frozen).not.toEqual(tool);
    const initial = tool.payload.initial;
    for (const change of [{ views: ["front", "front"] }, { views: ["left"] }, { guides: 1 }, { structure: {} }, { draftId: "private" },
      { structure: { ...initial.structure, cubes: [...initial.structure.cubes, initial.structure.cubes[0]] } }]) {
      expect(() => parseToolScene({ ...tool, payload: { ...tool.payload, initial: { ...initial, ...change } } })).toThrow();
    }
    expect(() => parseToolScene({ ...tool, toolId: "spatial-lab" })).toThrow();
  });
  it("restores independent versioned classroom snapshots and captures a new start without operation history", () => {
    const tool = projectionTool(), initial = projectionSnapshot(tool.payload.initial);
    const session = operateCubeSession(initial.cube.session, { kind: "axes", visible: false });
    const state = { ...initial, guides: true, views: ["right" as const], cube: { ...initial.cube, session, cameraRevision: 2 } };
    const event = createClassroomToolState("page", "doc", "projection-1", { toolId: "projection", contentVersion: "projection-lesson-v1", state }, "b".repeat(64));
    expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(parseClassroomToolState({ ...event, state: { ...state, views: ["right", "right"] } })).toBeNull();
    expect(parseClassroomToolState({ ...event, contentVersion: "cube-structures-lesson-v2" })).toBeNull();
    const saved = projectionInitial(state, cubeSessionScene(session));
    expect(saved).toMatchObject({ guides: true, views: ["right"], structure: { axesVisible: false } });
    expect(projectionSnapshot(saved).cube.session.work.operations).toEqual([]);
    expect(initial.cube.session.work.initial.axesVisible).toBe(true);
  });
});
