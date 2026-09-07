import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCAL_SPATIAL_WORKBENCH_SYNC_PROVIDERS } from "@/features/classroom/sync/interaction-audit";
import { CUBE_COLORS, CUBE_STRUCTURES_DRAFT_VERSION, CUBE_STRUCTURES_LIMITS, adjacentCube, appendCubeOperation, applyCubeOperation, buildCubeStructureRenderModel, createCubeHistory, cubeFrame, cubeIsVisible, cubePaintGroups, cubeStructureMetrics, exteriorPaintOperation, replayCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeOperationLabel, cubeStructuresMessages } from "@/features/tools/spatial-lab/cube-structures-messages";

const pair = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }];
const solid = Array.from({ length: 27 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3) % 3, z: Math.floor(index / 9) }));

describe("Cube Structures operation workbench", () => {
  it("records real operations without mandatory predict/view/verify forms", () => {
    let history = createCubeHistory([]);
    history = appendCubeOperation(history, { kind: "build", position: pair[0], color: CUBE_COLORS[0] });
    history = appendCubeOperation(history, { kind: "color", ids: ["cube-1"], color: CUBE_COLORS[1] });
    history = appendCubeOperation(history, { kind: "paint", faces: [{ id: "cube-1", direction: "y+" }], color: CUBE_COLORS[3] });
    history = appendCubeOperation(history, { kind: "layer", axis: "y", index: 0, visible: false });
    expect(history.version).toBe(CUBE_STRUCTURES_DRAFT_VERSION);
    expect(history.operations.map((operation) => operation.kind)).toEqual(["build", "color", "paint", "layer"]);
    expect(replayCubeHistory(history, 0).cubes).toEqual([]);
    expect(replayCubeHistory(history, 2).cubes[0]).toMatchObject({ color: CUBE_COLORS[1], faces: {} });
    expect(replayCubeHistory(history).cubes[0]).toMatchObject({ faces: { "y+": CUBE_COLORS[3] } });
    expect(replayCubeHistory(history)).toEqual(history.operations.reduce(applyCubeOperation, history.initial));
  });

  it("keeps IDs stable and does not reuse a removed cube's identity", () => {
    let history = createCubeHistory(pair);
    history = appendCubeOperation(history, { kind: "remove", ids: ["cube-1"] });
    history = appendCubeOperation(history, { kind: "build", position: pair[0], color: CUBE_COLORS[0] });
    expect(replayCubeHistory(history).cubes.map((cube) => cube.id)).toEqual(["cube-2", "cube-3"]);
  });

  it("keeps no-ops out of the timeline and bounds building and operation capacity", () => {
    const history = createCubeHistory(pair);
    expect(appendCubeOperation(history, { kind: "build", position: pair[0], color: CUBE_COLORS[0] })).toBe(history);
    expect(appendCubeOperation(history, { kind: "build", position: { x: 13, y: 0, z: 0 }, color: CUBE_COLORS[0] })).toBe(history);
    expect(appendCubeOperation(history, { kind: "color", ids: ["cube-1"], color: CUBE_COLORS[0] })).toBe(history);
    expect(appendCubeOperation(history, { kind: "remove", ids: ["missing"] })).toBe(history);
    const full = { ...history, cursor: CUBE_STRUCTURES_LIMITS.steps };
    expect(appendCubeOperation(full, { kind: "remove", ids: ["cube-1"] })).toBe(full);
  });

  it("builds from all six face directions and keeps empty structures valid", () => {
    expect(adjacentCube({ cell: pair[0], direction: "x-" })).toEqual({ x: -1, y: 0, z: 0 });
    expect(adjacentCube({ cell: pair[0], direction: "y+" })).toEqual(pair[1]);
    expect(adjacentCube({ cell: pair[0], direction: "z+" })).toEqual({ x: 0, y: 0, z: 1 });
    expect(cubeStructureMetrics(createCubeHistory([]).initial)).toMatchObject({ volume: 0, totalUnitFaces: 0 });
  });

  it("separates cube base color from face paint, including batch operations", () => {
    const initial = createCubeHistory(pair).initial;
    const painted = applyCubeOperation(initial, { kind: "paint", faces: [{ id: "cube-1", direction: "z+" }], color: CUBE_COLORS[3] });
    const colored = applyCubeOperation(painted, { kind: "color", ids: ["cube-1", "cube-2"], color: CUBE_COLORS[1] });
    expect(colored.cubes.every((cube) => cube.color === CUBE_COLORS[1])).toBe(true);
    expect(colored.cubes[0].faces).toEqual({ "z+": CUBE_COLORS[3] });
    expect(cubeStructureMetrics(colored).paintedHistogram).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(cubePaintGroups(colored)).toEqual([{ color: CUBE_COLORS[3], faces: [{ cell: pair[0], direction: "z+" }] }]);
    const cleared = applyCubeOperation(colored, { kind: "clear-paint", ids: ["cube-1"] });
    expect(cleared.cubes[0]).toMatchObject({ color: CUBE_COLORS[1], faces: {} });
  });

  it("hides any XYZ layer without changing geometry, paint classification or framing", () => {
    const initial = createCubeHistory(solid).initial;
    let hidden = applyCubeOperation(initial, { kind: "layer", axis: "y", index: 2, visible: false });
    hidden = applyCubeOperation(hidden, { kind: "layer", axis: "x", index: 0, visible: false });
    hidden = applyCubeOperation(hidden, { kind: "layer", axis: "z", index: 0, visible: false });
    expect(hidden.cubes.filter((cube) => cubeIsVisible(hidden, cube))).toHaveLength(8);
    expect(cubeStructureMetrics(hidden)).toEqual(cubeStructureMetrics(initial));
    expect(hidden.frame).toBe(initial.frame);
    expect(applyCubeOperation(hidden, { kind: "show-all" }).hiddenCubeIds).toEqual([]);
  });

  it("paints the logical exterior, not newly revealed internal faces after hiding", () => {
    const initial = createCubeHistory(solid).initial;
    const hidden = applyCubeOperation(initial, { kind: "layer", axis: "y", index: 2, visible: false });
    const operation = exteriorPaintOperation(hidden, hidden.cubes.map((cube) => cube.id), CUBE_COLORS[1]);
    expect(operation.kind === "paint" && operation.faces.length).toBe(54);
    const result = applyCubeOperation(hidden, operation);
    expect(cubeStructureMetrics(result).paintedHistogram).toEqual([1, 6, 12, 8, 0, 0, 0]);
  });

  it("restricts batch targets without treating unselected neighbors as absent", () => {
    const initial = createCubeHistory(pair).initial;
    const operation = exteriorPaintOperation(initial, ["cube-1"], CUBE_COLORS[1]);
    expect(operation.kind === "paint" && operation.faces).toHaveLength(5);
    expect(operation.kind === "paint" && operation.faces.some((face) => face.direction === "y+")).toBe(false);
  });

  it("recalculates true cavities on removal and keeps hidden geometry in metrics", () => {
    const initial = createCubeHistory(solid).initial;
    const center = initial.cubes.find((cube) => cube.position.x === 1 && cube.position.y === 1 && cube.position.z === 1)!;
    const carved = applyCubeOperation(initial, { kind: "remove", ids: [center.id] });
    expect(cubeStructureMetrics(carved)).toMatchObject({ volume: 26, totalUnitFaces: 60, exteriorUnitFaces: 54, interiorUnitFaces: 6 });
    expect(cubeStructureMetrics(initial)).toMatchObject({ volume: 27, totalUnitFaces: 54 });
  });

  it("replays a demo copy without mutating preparation", () => {
    const prepared = appendCubeOperation(createCubeHistory(pair), { kind: "color", ids: ["cube-1"], color: CUBE_COLORS[2] });
    const before = JSON.stringify(prepared);
    const demo = appendCubeOperation({ ...prepared }, { kind: "remove", ids: ["cube-1"] });
    expect(replayCubeHistory(demo).cubes).toHaveLength(1);
    expect(JSON.stringify(prepared)).toBe(before);
    expect(replayCubeHistory(prepared).cubes).toHaveLength(2);
  });

  it("restores exact state on undo/redo and branches only at the requested cursor", () => {
    let history = createCubeHistory(pair);
    history = appendCubeOperation(history, { kind: "remove", ids: ["cube-2"] });
    history = appendCubeOperation(history, { kind: "color", ids: ["cube-1"], color: CUBE_COLORS[1] });
    expect(replayCubeHistory(history, 0)).toBe(history.initial);
    expect(replayCubeHistory(history, 1).cubes[0].color).toBe(CUBE_COLORS[0]);
    const branch = appendCubeOperation({ ...history, cursor: 1 }, { kind: "color", ids: ["cube-1"], color: CUBE_COLORS[3] });
    expect(branch.operations).toHaveLength(2);
    expect(replayCubeHistory(branch).cubes[0].color).toBe(CUBE_COLORS[3]);
    expect(replayCubeHistory(history).cubes[0].color).toBe(CUBE_COLORS[1]);
  });

  it("uses stable parallel camera framing while all view buttons remain actual steps", () => {
    const initial = createCubeHistory(pair).initial;
    for (const view of ["angle", "front", "left", "right", "top"] as const) {
      const state = applyCubeOperation(initial, { kind: "view", view, frame: cubeFrame(initial.cubes) });
      const model = buildCubeStructureRenderModel(state, ["cube-1"], "Cube Structures");
      expect(model.camera.projection).toBe("orthographic");
      expect(model.cells[0].selected).toBe(true);
      expect(model.camera.up).toEqual(view === "top" ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 });
      expect(model.totalCountRevealed).toBe(false);
    }
  });

  it("looks from negative X in left view, with the matching projection and a replayable step", () => {
    const history = createCubeHistory([{ x: -1, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }]);
    const operation = { kind: "view", view: "left", frame: cubeFrame(history.initial.cubes) } as const;
    const recorded = appendCubeOperation(history, operation);
    const model = buildCubeStructureRenderModel(replayCubeHistory(recorded), [], "Cubes");
    expect(model.camera.position.x).toBeLessThan(model.camera.target.x);
    expect(model.camera.position.y).toBe(model.camera.target.y);
    expect(model.camera.position.z).toBe(model.camera.target.z);
    expect(model.projectionView).toBe("left");
    expect(model.projection).toMatchObject({ horizontalAxis: "z", verticalAxis: "y", depthAxis: "-x" });
    expect(model.projection.cells[0].frontmostCell.x).toBe(-1);
    expect(recorded.operations).toEqual([operation]);
    expect(replayCubeHistory(recorded, 0).view).toBe("angle");
    expect(replayCubeHistory(recorded, 1).view).toBe("left");
    expect(cubeOperationLabel(operation, "zh")).toBe("视角 · 左视");
    expect(cubeOperationLabel(operation, "en")).toBe("View · Left");
    expect(readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8")).toContain('["angle", "front", "left", "right", "top"]');
  });

  it("keeps bilingual tools and operation labels complete", () => {
    expect(Object.keys(cubeStructuresMessages("zh")).sort()).toEqual(Object.keys(cubeStructuresMessages("en")).sort());
    expect(cubeOperationLabel({ kind: "layer", axis: "y", index: 2, visible: false }, "zh")).toBe("隐藏 Y 3 层");
    expect(cubeOperationLabel({ kind: "view", view: "top", frame: cubeFrame([]) }, "en")).toBe("View · Top");
  });

  it("shares one tool canvas between preparation and demo and keeps classroom sync fail-closed", () => {
    expect(LOCAL_SPATIAL_WORKBENCH_SYNC_PROVIDERS[CUBE_STRUCTURES_DRAFT_VERSION]).toMatchObject({ mode: "read-only", protocol: "spatial-command-v1", maxPayloadBytes: 0 });
    const source = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8");
    expect(source.match(/<CubeStructuresViewport /g)).toHaveLength(1);
    expect(source).toContain("ssr: false");
    expect(source).not.toContain('from "three"');
    expect(source).toContain("active={tool === id}");
    expect(source).toContain("<AlertDialog");
    expect(source).not.toContain("VoxelLessonEditorStage");
    expect(source).not.toContain("session_events");
    const canvas = readFileSync("src/features/spatial-math/renderer-r3f/VoxelCanvas.tsx", "utf8");
    expect(canvas).toContain("event.delta > 5");
    expect(canvas).toContain("<SpatialCameraRig");
  });
});
