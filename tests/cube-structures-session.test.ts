import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUBE_COLORS, CUBE_GROUP_COLORS, CUBE_SELECTION_COLOR, CUBE_STRUCTURES_LIMITS, applyCubeOperation, buildCubeStructureRenderModel, createCubeHistory, cubeIsVisible, cubeLayerNumber, cubeLayerOperation, cubeScopeIds, replayCubeHistory, type CubeStructureState } from "@/features/tools/spatial-lab/cube-structures-contract";
import { createCubeDemo, createCubeSession, cubeResumeNeedsRestore, cubeSessionScene, editCubeRecording, finishCubeRecording, moveCubeRecordedStep, operateCubeSession, pauseCubeRecording, previewCubeSession, replaceCubeRecordedStep, resumeCubeRecording, startCubeRecording, undoCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";

const positions = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }];
const colorFirst = { kind: "color", ids: ["cube-1"], color: CUBE_COLORS[1] } as const;
const colorSecond = { kind: "color", ids: ["cube-2"], color: CUBE_COLORS[2] } as const;

describe("independent lesson recording", () => {
  it("starts off, keeps ordinary undo, and captures the current scene on start", () => {
    const initial = createCubeSession(positions);
    expect(initial).toMatchObject({ recording: "off", lesson: null, preview: null });
    const free = operateCubeSession(initial, colorFirst);
    expect(free.lesson).toBeNull();
    expect(cubeSessionScene(undoCubeSession(free, -1))).toEqual(cubeSessionScene(initial));
    const recording = startCubeRecording(free);
    expect(recording.lesson?.initial).toEqual(cubeSessionScene(free));
    expect(recording.lesson?.operations).toEqual([]);
    expect(operateCubeSession(recording, colorSecond).lesson?.operations).toEqual([colorSecond]);
  });

  it("pauses without recording experiments, then explicitly restores the recorded endpoint", () => {
    const recorded = operateCubeSession(startCubeRecording(createCubeSession(positions)), colorFirst);
    const paused = pauseCubeRecording(recorded);
    const experiment = operateCubeSession(paused, { kind: "remove", ids: ["cube-2"] });
    expect(experiment.lesson).toBe(recorded.lesson);
    expect(cubeSessionScene(experiment).cubes).toHaveLength(1);
    expect(cubeResumeNeedsRestore(experiment)).toBe(true);
    const resumed = resumeCubeRecording(experiment);
    expect(cubeSessionScene(resumed)).toEqual(cubeSessionScene(recorded));
    expect(cubeResumeNeedsRestore(resumed)).toBe(false);
    expect(cubeSessionScene(undoCubeSession(resumed, -1))).toEqual(recorded.lesson?.initial);
    const completed = operateCubeSession(resumed, colorSecond);
    expect(replayCubeHistory(completed.lesson!)).toEqual(cubeSessionScene(completed));
  });

  it("finishes recording while allowing free edits without changing the lesson", () => {
    const stopped = finishCubeRecording(operateCubeSession(startCubeRecording(createCubeSession(positions)), colorFirst));
    const free = operateCubeSession(stopped, colorSecond);
    expect(free.recording).toBe("off");
    expect(free.lesson).toBe(stopped.lesson);
    expect(free.lesson?.operations).toEqual([colorFirst]);
  });

  it("undo/redo stays in step with an active recording and branches deliberately", () => {
    const one = operateCubeSession(startCubeRecording(createCubeSession(positions)), colorFirst);
    const two = operateCubeSession(one, colorSecond);
    const undo = undoCubeSession(two, -1);
    expect(undo.lesson?.cursor).toBe(1);
    expect(cubeSessionScene(undoCubeSession(undo, 1))).toEqual(cubeSessionScene(two));
    const branch = operateCubeSession(undo, { kind: "axes", visible: false });
    expect(branch.lesson?.operations.map((operation) => operation.kind)).toEqual(["color", "axes"]);
    expect(replayCubeHistory(branch.lesson!)).toEqual(cubeSessionScene(branch));
  });

  it("previews without modifying working state and isolates the demonstration", () => {
    const prepared = finishCubeRecording(operateCubeSession(startCubeRecording(createCubeSession(positions)), colorFirst));
    const preview = previewCubeSession(prepared, 0);
    expect(cubeSessionScene(preview)).toEqual(prepared.lesson?.initial);
    expect(operateCubeSession(preview, colorSecond)).toBe(preview);
    expect(cubeSessionScene(previewCubeSession(preview, null))).toEqual(cubeSessionScene(prepared));
    const original = JSON.stringify(prepared);
    const demo = operateCubeSession(previewCubeSession(createCubeDemo(prepared), null), colorSecond);
    expect(cubeSessionScene(demo).cubes[1].color).toBe(CUBE_COLORS[2]);
    expect(JSON.stringify(prepared)).toBe(original);
  });

  it("moves independent steps, removes a step, and keeps a valid replay", () => {
    const recorded = finishCubeRecording(operateCubeSession(operateCubeSession(startCubeRecording(createCubeSession(positions)), colorFirst), colorSecond));
    const moved = moveCubeRecordedStep(recorded, 0, 1);
    expect(moved.issue).toBeNull();
    expect(moved.session.lesson?.operations).toEqual([colorSecond, colorFirst]);
    expect(replayCubeHistory(moved.session.lesson!)).toEqual(replayCubeHistory(recorded.lesson!));
    const deleted = editCubeRecording(moved.session, [colorSecond]);
    expect(deleted.issue).toBeNull();
    expect(deleted.session.lesson?.operations).toEqual([colorSecond]);
  });

  it("rejects dependency-breaking moves and deletion atomically", () => {
    let recorded = startCubeRecording(createCubeSession([]));
    recorded = operateCubeSession(recorded, { kind: "build", position: positions[0], color: CUBE_COLORS[0] });
    recorded = finishCubeRecording(operateCubeSession(recorded, colorFirst));
    const moved = moveCubeRecordedStep(recorded, 1, 0);
    expect(moved.issue).toEqual({ index: 0, code: "missing-cube" });
    expect(moved.session).toBe(recorded);
    expect(editCubeRecording(recorded, [colorFirst]).session).toBe(recorded);
  });

  it("re-records a build while preserving identities used by later paint", () => {
    let recorded = startCubeRecording(createCubeSession([]));
    recorded = operateCubeSession(recorded, { kind: "build", position: positions[0], color: CUBE_COLORS[0] });
    recorded = finishCubeRecording(operateCubeSession(recorded, colorFirst));
    const replacement = replaceCubeRecordedStep(recorded, 0, { kind: "build", id: "new-ui-id", position: positions[1], color: CUBE_COLORS[0] });
    expect(replacement.issue).toBeNull();
    expect(replayCubeHistory(replacement.session.lesson!).cubes[0]).toMatchObject({ id: "cube-1", position: positions[1], color: CUBE_COLORS[1] });
    expect(replacement.session.lesson?.initial.origin).toBeNull();
  });

  it("rejects replacement collisions without partially editing the recording", () => {
    let recorded = startCubeRecording(createCubeSession(positions));
    recorded = operateCubeSession(recorded, { kind: "move", ids: ["cube-1"], axis: "x", distance: 1 });
    recorded = finishCubeRecording(operateCubeSession(recorded, colorFirst));
    const failed = replaceCubeRecordedStep(recorded, 0, { kind: "move", ids: ["cube-1"], axis: "y", distance: 1 });
    expect(failed.issue).toBeTruthy();
    expect(failed.session).toBe(recorded);
  });

  it("bounds recording but keeps the free-edit undo window rolling", () => {
    let free = createCubeSession(positions);
    let recorded = startCubeRecording(free);
    for (let index = 0; index < CUBE_STRUCTURES_LIMITS.steps + 3; index++) {
      const operation = { kind: "axes", visible: index % 2 === 1 } as const;
      free = operateCubeSession(free, operation);
      recorded = operateCubeSession(recorded, operation);
    }
    expect(free.work.operations).toHaveLength(CUBE_STRUCTURES_LIMITS.steps);
    expect(cubeSessionScene(free).axesVisible).toBe(false);
    expect(recorded.lesson?.operations).toHaveLength(CUBE_STRUCTURES_LIMITS.steps);
    expect(cubeSessionScene(recorded)).toEqual(replayCubeHistory(recorded.lesson!));
  });
});

describe("groups, recoverable layers and fixed axes", () => {
  function grouped(): CubeStructureState {
    return applyCubeOperation(createCubeHistory(positions).initial, { kind: "group", id: "group-a", name: "第一组", ids: ["cube-1"] });
  }

  it("limits batch actions and layer visibility to group members", () => {
    const initial = grouped();
    const ids = cubeScopeIds(initial, "group-a");
    expect(ids).toEqual(["cube-1"]);
    const colored = applyCubeOperation(initial, { ...colorFirst, ids });
    expect(colored.cubes[1]).toBe(initial.cubes[1]);
    const hidden = applyCubeOperation(colored, cubeLayerOperation(colored, "y", 0, false, ids));
    expect(hidden.hiddenCubeIds).toEqual(["cube-1"]);
    expect(cubeScopeIds(hidden, "group-a")).toEqual(ids);
    expect(applyCubeOperation(hidden, cubeLayerOperation(hidden, "y", 0, true, ids)).hiddenCubeIds).toEqual([]);
  });

  it("highlights existing edges and faces without changing authored colors or paint", () => {
    const state = applyCubeOperation(grouped(), { kind: "paint", faces: [{ id: "cube-1", direction: "z+" }], color: CUBE_COLORS[3] });
    const original = JSON.stringify(state);
    const selected = buildCubeStructureRenderModel(state, ["cube-1"], "Cubes");
    expect(selected.cells[0]).toMatchObject({ materialToken: CUBE_COLORS[0], emphasis: { color: CUBE_SELECTION_COLOR, faceOpacity: 0.4, priority: 2 } });
    expect(selected.cells[1].emphasis).toBeUndefined();
    const activeGroup = buildCubeStructureRenderModel(state, [], "Cubes", "group-a");
    expect(activeGroup.cells[0].emphasis).toMatchObject({ color: state.groups[0].color, faceOpacity: 0.25 });
    expect(activeGroup.cells[1].emphasis).toBeUndefined();
    expect(buildCubeStructureRenderModel(state, [], "Cubes").cells.every((cell) => !cell.emphasis)).toBe(true);
    expect(JSON.stringify(state)).toBe(original);
    expect(state.cubes[0].faces).toEqual({ "z+": CUBE_COLORS[3] });
  });

  it("keeps each group color stable during step reordering", () => {
    let session = startCubeRecording(createCubeSession(positions));
    session = operateCubeSession(session, { kind: "group", id: "one", name: "One", ids: ["cube-1"] });
    session = finishCubeRecording(operateCubeSession(session, { kind: "group", id: "two", name: "Two", ids: ["cube-2"] }));
    const moved = moveCubeRecordedStep(session, 0, 1);
    expect(moved.issue).toBeNull();
    const byId = (state: CubeStructureState) => Object.fromEntries(state.groups.map((group) => [group.id, group.color]));
    expect(byId(replayCubeHistory(moved.session.lesson!))).toEqual(byId(cubeSessionScene(session)));
    expect(cubeSessionScene(session).groups.map((group) => group.color)).toEqual(CUBE_GROUP_COLORS.slice(0, 2));
  });

  it("restores every XYZ layer even when all its members are hidden", () => {
    const initial = createCubeHistory(positions).initial;
    for (const axis of ["x", "y", "z"] as const) {
      const ids = cubeScopeIds(initial, null);
      const hidden = applyCubeOperation(initial, cubeLayerOperation(initial, axis, 0, false, ids));
      const restored = applyCubeOperation(hidden, cubeLayerOperation(hidden, axis, 0, true, ids));
      expect(restored.cubes.every((cube) => cubeIsVisible(restored, cube))).toBe(true);
    }
    const allHidden = applyCubeOperation(initial, { kind: "layer", axis: "y", index: 0, visible: false, ids: ["cube-1", "cube-2"] });
    expect(applyCubeOperation(allHidden, { kind: "show-all", ids: ["cube-1"] }).hiddenCubeIds).toEqual(["cube-2"]);
  });

  it("adds new members to the active group, moves them together and cleans deleted members", () => {
    const initial = grouped();
    const built = applyCubeOperation(initial, { kind: "build", groupId: "group-a", position: { x: 1, y: 0, z: 0 }, color: CUBE_COLORS[0] });
    const ids = cubeScopeIds(built, "group-a");
    expect(ids).toEqual(["cube-1", "cube-3"]);
    const moved = applyCubeOperation(built, { kind: "move", ids, axis: "x", distance: 1 });
    expect(moved.cubes[1]).toBe(initial.cubes[1]);
    expect(moved.groups).toBe(built.groups);
    const removed = applyCubeOperation(moved, { kind: "remove", ids: ["cube-1"] });
    expect(cubeScopeIds(removed, "group-a")).toEqual(["cube-3"]);
    expect(applyCubeOperation(removed, { kind: "ungroup", id: "group-a" }).cubes).toBe(removed.cubes);
  });

  it("rejects group collisions and keeps hidden membership stable during movement", () => {
    const initial = grouped();
    expect(applyCubeOperation(initial, { kind: "move", ids: ["cube-1"], axis: "y", distance: 1 })).toBe(initial);
    const hidden = applyCubeOperation(initial, cubeLayerOperation(initial, "y", 0, false, ["cube-1"]));
    const moved = applyCubeOperation(hidden, { kind: "move", ids: ["cube-1"], axis: "x", distance: 1 });
    expect(moved.hiddenCubeIds).toEqual(["cube-1"]);
    expect(applyCubeOperation(moved, cubeLayerOperation(moved, "x", 1, true, ["cube-1"])).hiddenCubeIds).toEqual([]);
  });

  it("numbers initial layers from one and never moves the captured corner", () => {
    let state = createCubeHistory([{ x: 3, y: 4, z: -2 }, { x: 4, y: 5, z: -1 }]).initial;
    const origin = state.origin;
    expect(origin).toEqual({ x: 2.5, y: 3.5, z: -2.5 });
    for (const axis of ["x", "y", "z"] as const) expect(cubeLayerNumber(state, axis, positions[0][axis] + (axis === "x" ? 3 : axis === "y" ? 4 : -2))).toBe(1);
    state = applyCubeOperation(state, { kind: "move", ids: ["cube-1", "cube-2"], axis: "x", distance: 1 });
    state = applyCubeOperation(state, { kind: "remove", ids: ["cube-1", "cube-2"] });
    state = applyCubeOperation(state, { kind: "build", position: positions[0], color: CUBE_COLORS[0] });
    state = applyCubeOperation(state, { kind: "axes", visible: false });
    expect(state.origin).toBe(origin);
    expect(state.axesVisible).toBe(false);
    const empty = createCubeHistory([]).initial;
    expect(applyCubeOperation(empty, { kind: "build", position: positions[1], color: CUBE_COLORS[0] }).origin).toEqual({ x: -0.5, y: 0.5, z: -0.5 });
  });

  it("keeps icon docks and persistent layer/group controls inside the 4:3 frame", () => {
    const source = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8");
    const css = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.module.css", "utf8");
    const controls = readFileSync("src/features/tools/spatial-interaction/SpatialWorkbenchControls.tsx", "utf8");
    expect(source).toContain('data-cube-workspace-frame="4:3"');
    expect(source).toContain("data-cube-view-toolbar");
    expect(source).toContain("data-cube-group-scope");
    expect(source).toContain("if (!scopeIds.includes(cube.id))");
    expect(source).toContain("data-cube-layer-panel");
    expect(source).toContain("navigationMode={tool === \"pan\" ? \"pan\" : tool === \"move\" || tool === \"cut\" ? \"object\" : \"orbit\"}");
    expect(source).not.toContain("setEdgeStyle");
    const scene = readFileSync("src/features/tools/spatial-lab/CubeStructuresScene.tsx", "utf8");
    const renderer = readFileSync("src/features/spatial-math/renderer-r3f/VoxelCanvas.tsx", "utf8");
    expect(scene).not.toContain("VoxelScreenEdges");
    expect(scene).not.toContain("<Edges");
    expect(renderer).toContain("mesh.setColorAt(index, color.set(edge.color ?? VOXEL_EDGE_COLOR))");
    expect(css).toContain("100cqh * 4 / 3");
    expect(css).toContain("@media (orientation: portrait)");
    expect(css).toContain("flex-direction: column");
    expect(controls).toContain("aria-label={label}");
    expect(controls).toContain("<aside");
  });
});
