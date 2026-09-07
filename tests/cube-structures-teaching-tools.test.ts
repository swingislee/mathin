import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ShaderLib } from "three";
import { voxelKey, type Axis } from "@/features/spatial-math/domain";
import { CUBE_COLORS, CUBE_MARK_SHAPES, adjacentCube, appendCubeOperation, applyCubeOperation, buildCubeStructureRenderModel, captureCubeOperation, createCubeHistory, cubeAtDisplayPosition, cubeCutOperation, cubeDisplayPosition, cubeFrame, cubePaintGroups, cubeStructureMetrics, exteriorPaintOperation, replayCubeHistory, validateCubeSequence, type CubeLabelStyle, type CubeOperation, type CubeStructureState } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeAnnotationSvg, cubeLabelAnchor } from "@/features/tools/spatial-lab/cube-structures-annotations";
import { cubeCutPreviewPlanes } from "@/features/tools/spatial-lab/cube-structures-cut-preview";
import { cubeOperationLabel } from "@/features/tools/spatial-lab/cube-structures-messages";
import { cubeToolCursor } from "@/features/tools/spatial-lab/cube-structures-cursor";
import { createCubeDemo, createCubeSession, cubeSessionScene, operateCubeSession, replaceCubeRecordedStep, startCubeRecording, undoCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { voxelHiddenEdgeShaders } from "@/features/spatial-math/renderer-r3f/voxel-hidden-edge-shader";

const block = Array.from({ length: 27 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) % 3, z: Math.floor(i / 9) }));
const style: CubeLabelStyle = { placement: "face", direction: "z+", color: CUBE_COLORS[1] };
const all = (state: CubeStructureState) => state.cubes.map((cube) => cube.id);
const cut = (state: CubeStructureState, axis: Axis = "x", ids: readonly string[] = all(state), group = "cut-1") => cubeCutOperation(state, ids, axis, 0, 1, 1.5, group, group)!;

describe("cube structure cuts and teaching annotations", () => {
  it.each(["x", "y", "z"] as const)("cuts a %s layer boundary without changing logical geometry or painted faces", (axis) => {
    const initial = createCubeHistory(block).initial;
    const painted = applyCubeOperation(initial, exteriorPaintOperation(initial, all(initial), CUBE_COLORS[2]));
    const operation = cut(painted, axis);
    const next = applyCubeOperation(painted, operation);
    expect(next).not.toBe(painted);
    expect(next.cubes.map((cube) => cube.position)).toEqual(painted.cubes.map((cube) => cube.position));
    expect(cubeStructureMetrics(next)).toEqual(cubeStructureMetrics(painted));
    expect(exteriorPaintOperation(next, all(next), CUBE_COLORS[1])).toEqual(exteriorPaintOperation(painted, all(painted), CUBE_COLORS[1]));
    expect(next.origin).toBe(initial.origin);
    expect(next.groups[0].cubeIds).toEqual(operation.ids);
    expect(next.cubes.filter((cube) => cube.displayOffset?.[axis] === 1.5)).toHaveLength(18);
  });

  it("cuts a moved piece again on another axis and restores every offset on reassembly", () => {
    const initial = createCubeHistory(block).initial;
    const first = applyCubeOperation(initial, cut(initial));
    const nextCut = cut(first, "y", first.groups[0].cubeIds, "cut-2");
    const second = applyCubeOperation(first, nextCut);
    expect(second.cubes.find((cube) => nextCut.ids.includes(cube.id))?.displayOffset).toEqual({ x: 1.5, y: 1.5, z: 0 });
    expect(second.cubes.filter((cube) => !first.groups[0].cubeIds.includes(cube.id))).toEqual(initial.cubes.filter((cube) => !first.groups[0].cubeIds.includes(cube.id)));
    const joined = applyCubeOperation(second, { kind: "display-reset", ids: all(second) });
    expect(joined.cubes.map(cubeDisplayPosition)).toEqual(initial.cubes.map((cube) => cube.position));
    expect(cubeStructureMetrics(joined)).toEqual(cubeStructureMetrics(initial));
  });

  it("keeps logical moves distinct from display-only separation", () => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]).initial;
    const separated = applyCubeOperation(initial, cut(initial));
    const moved = applyCubeOperation(initial, { kind: "move", ids: ["cube-2"], axis: "x", distance: 2 });
    expect(cubeStructureMetrics(separated).totalUnitFaces).toBe(10);
    expect(cubeStructureMetrics(moved).totalUnitFaces).toBe(12);
  });

  it("resolves displaced face hits to stable identity and builds in the same display frame", () => {
    const separated = applyCubeOperation(createCubeHistory(block).initial, cut(createCubeHistory(block).initial));
    const anchor = separated.cubes.find((cube) => cube.position.x === 2 && cube.position.y === 2)!;
    const display = cubeDisplayPosition(anchor);
    expect(cubeAtDisplayPosition(separated, display)?.id).toBe(anchor.id);
    const operation: CubeOperation = { kind: "build", id: "new", position: adjacentCube({ cell: anchor.position, direction: "y+" }), displayOffset: anchor.displayOffset, color: CUBE_COLORS[0] };
    const built = applyCubeOperation(separated, operation);
    expect(cubeDisplayPosition(built.cubes.at(-1)!)).toEqual(adjacentCube({ cell: display, direction: "y+" }));
  });

  it("rejects overlapping, non-half-step and out-of-range display movement", () => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]).initial;
    for (const distance of [1.5, 2, 2.5, 25, 0.1, NaN]) {
      expect(applyCubeOperation(initial, { kind: "display-move", ids: ["cube-1"], axis: "x", distance })).toBe(initial);
    }
    expect(applyCubeOperation(initial, { kind: "display-move", ids: ["cube-1"], axis: "x", distance: 1 })).not.toBe(initial);
    expect(cubeCutOperation(initial, all(initial), "y", 0, 1, 2, "bad", "bad")).toBeNull();
  });

  it("keeps partial reassembly atomic when another displaced cube occupies its destination", () => {
    const initial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]).initial;
    const a = applyCubeOperation(initial, { kind: "display-move", ids: ["cube-1"], axis: "y", distance: 2 });
    const b = applyCubeOperation(a, { kind: "display-move", ids: ["cube-2"], axis: "x", distance: -2 });
    const reset: CubeOperation = { kind: "display-reset", ids: ["cube-1"] };
    expect(applyCubeOperation(b, reset)).toBe(b);
    expect(validateCubeSequence(b, [reset])?.code).toBe("collision");
    expect(applyCubeOperation(b, { kind: "display-reset", ids: all(b) }).cubes.map(cubeDisplayPosition)).toEqual(initial.cubes.map((cube) => cube.position));
  });

  it("reframes fractional display bounds and places paint and preview planes at displayed coordinates", () => {
    const initial = createCubeHistory(block).initial;
    const next = applyCubeOperation(initial, cut(initial));
    const painted = applyCubeOperation(next, { kind: "paint", faces: [{ id: next.groups[0].cubeIds[0], direction: "x+" }], color: CUBE_COLORS[1] });
    const model = buildCubeStructureRenderModel(painted, [], "test");
    expect(cubeFrame(painted.cubes).radius).toBeGreaterThan(initial.frame.radius);
    expect(model.cells.some((cell) => cell.x % 1 === 0.5)).toBe(true);
    const paint = cubePaintGroups(painted)[0].faces[0];
    expect(cubeAtDisplayPosition(painted, paint.cell)?.id).toBe(next.groups[0].cubeIds[0]);
    const planes = cubeCutPreviewPlanes(next, "y", 0, next.groups[0].cubeIds);
    expect(planes[0].center).toEqual({ x: 3, y: 0.5, z: 1 });
  });

  it("records one deterministic cut command with stable group identity and validates reorder dependencies", () => {
    let session = startCubeRecording(createCubeSession(block));
    session = operateCubeSession(session, cut(cubeSessionScene(session)));
    expect(session.lesson?.operations).toHaveLength(1);
    expect(session.lesson?.operations[0]).toMatchObject({ kind: "cut", groupId: "cut-1", color: expect.any(String) });
    const state = cubeSessionScene(session);
    expect(cubeSessionScene(undoCubeSession(session, -1))).toEqual(session.lesson!.initial);
    expect(cubeSessionScene(undoCubeSession(undoCubeSession(session, -1), 1))).toEqual(state);
    const replacement = cubeCutOperation(session.lesson!.initial, all(state), "x", 1, 1, 2, "new-id", "updated")!;
    const result = replaceCubeRecordedStep(session, 0, replacement);
    expect(result.issue).toBeNull();
    expect(result.session.lesson?.operations[0]).toMatchObject({ groupId: "cut-1" });
    expect(validateCubeSequence(session.lesson!.initial, [{ kind: "build", id: "new", groupId: "cut-1", position: { x: 4, y: 0, z: 0 }, color: CUBE_COLORS[0] }, session.lesson!.operations[0]])?.code).toBe("missing-group");
  });

  it.each(CUBE_MARK_SHAPES)("stores and renders the %s SVG symbol in all three positions", (shape) => {
    for (const placement of ["side", "face", "center"] as const) {
      const initial = createCubeHistory(block).initial;
      const next = applyCubeOperation(initial, { kind: "mark", ids: ["cube-1"], ...style, placement, shape });
      expect(next.cubes[0].mark).toMatchObject({ shape, placement });
      expect(next.cubes[0].opacity ?? 1).toBe(placement === "center" ? 0.3 : 1);
      expect(cubeAnnotationSvg(next.cubes[0].mark!)).toContain("<path");
      expect(cubeStructureMetrics(next)).toEqual(cubeStructureMetrics(initial));
    }
  });

  it("numbers by click order, ignores repeat clicks, and restores the next value on undo", () => {
    let session = startCubeRecording(createCubeSession(block));
    session = operateCubeSession(session, { kind: "number", id: "cube-7", ...style });
    expect(session.lesson?.operations[0]).toMatchObject({ id: "cube-7", value: 1 });
    expect(operateCubeSession(session, { kind: "number", id: "cube-7", ...style })).toBe(session);
    session = operateCubeSession(session, { kind: "number", id: "cube-2", ...style, placement: "center" });
    expect(cubeSessionScene(session).cubes.find((cube) => cube.id === "cube-2")).toMatchObject({ opacity: 0.3, numberLabel: { value: 2 } });
    expect(cubeSessionScene(undoCubeSession(session, -1)).nextNumber).toBe(2);
    expect(cubeSessionScene(session).nextNumber).toBe(3);
    expect(validateCubeSequence(session.lesson!.initial, [session.lesson!.operations[0], { kind: "number", id: "cube-2", value: 1, ...style }])?.code).toBe("invalid-operation");
  });

  it("keeps symbols, number labels and opacity attached across movement and hiding", () => {
    let state = createCubeHistory(block).initial;
    state = applyCubeOperation(state, { kind: "mark", ids: ["cube-1"], shape: "star", ...style });
    state = applyCubeOperation(state, { kind: "number", id: "cube-1", ...style });
    state = applyCubeOperation(state, { kind: "opacity", ids: ["cube-1"], opacity: 0.15 });
    const before = state.cubes[0];
    state = applyCubeOperation(state, { kind: "display-move", ids: ["cube-1"], axis: "x", distance: -2 });
    state = applyCubeOperation(state, { kind: "layer", axis: "y", index: 0, visible: false, ids: ["cube-1"] });
    expect(state.cubes[0]).toMatchObject({ id: before.id, mark: before.mark, numberLabel: before.numberLabel, opacity: 0.15 });
    expect(cubeLabelAnchor(state.cubes[0], style).x).toBe(cubeLabelAnchor(before, style).x - 2);
    expect(buildCubeStructureRenderModel(state, [], "test").cells.some((cell) => cell.key === before.id)).toBe(false);
  });

  it("clears symbols and numbers independently and restarts counting explicitly", () => {
    let state = createCubeHistory(block).initial;
    for (const op of [{ kind: "mark", ids: ["cube-1"], shape: "star", ...style }, { kind: "number", id: "cube-1", ...style }] as const) state = applyCubeOperation(state, op);
    const clearMark = applyCubeOperation(state, { kind: "clear-labels", ids: ["cube-1"], target: "mark" });
    expect(clearMark.cubes[0].mark).toBeUndefined();
    expect(clearMark.cubes[0].numberLabel?.value).toBe(1);
    const reset = applyCubeOperation(state, { kind: "restart-numbering" });
    expect(reset.nextNumber).toBe(1);
    expect(reset.cubes[0].numberLabel).toBeUndefined();
    expect(reset.cubes[0].mark).toEqual(state.cubes[0].mark);
  });

  it("supports 0–100% per-cube opacity without changing geometry or annotation data", () => {
    const initial = createCubeHistory(block).initial;
    for (const opacity of [0, 0.15, 0.5, 1]) {
      const next = applyCubeOperation(initial, { kind: "opacity", ids: ["cube-1"], opacity });
      const model = buildCubeStructureRenderModel(next, [], "test");
      expect(model.cells[0].opacity ?? 1).toBe(opacity);
      expect(model.cells[1].opacity ?? 1).toBe(1);
      expect(cubeStructureMetrics(next)).toEqual(cubeStructureMetrics(initial));
    }
    for (const opacity of [-0.1, 1.1, NaN]) expect(applyCubeOperation(initial, { kind: "opacity", ids: ["cube-1"], opacity })).toBe(initial);
  });

  it("replays annotations, display moves and transparency exactly, with an isolated demo", () => {
    let history = createCubeHistory(block);
    const operations: CubeOperation[] = [cut(history.initial), { kind: "mark", ids: ["cube-1"], shape: "square", ...style, placement: "side" },
      { kind: "number", id: "cube-2", ...style, placement: "center" }, { kind: "opacity", ids: ["cube-3"], opacity: 0 }, { kind: "hidden-edges", visible: false }];
    operations.forEach((operation) => { history = appendCubeOperation(history, operation); });
    expect(validateCubeSequence(history.initial, history.operations)).toBeNull();
    expect(replayCubeHistory(history)).toEqual(history.operations.reduce(applyCubeOperation, history.initial));
    const session = { ...createCubeSession(block), work: history, lesson: history };
    const demo = createCubeDemo(session);
    expect(cubeSessionScene(demo)).toEqual(history.initial);
    expect(cubeSessionScene({ ...demo, preview: history.operations.length })).toEqual(replayCubeHistory(history));
    for (const operation of history.operations) expect(cubeOperationLabel(operation, "zh").length).toBeGreaterThan(0);
    expect(captureCubeOperation(history.initial, { kind: "number", id: "cube-1", ...style })).toMatchObject({ value: 1 });
  });

  it("dashes only occluded fragments while retaining the existing coarse edge geometry", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const shader = voxelHiddenEdgeShaders(ShaderLib.basic.vertexShader, ShaderLib.basic.fragmentShader, axis);
      expect(shader.vertexShader).toContain(`(position.${axis} + 0.5)`);
      expect(shader.fragmentShader).toContain("gl_FragCoord.z > voxelFrontDepth + uVoxelDepthBias");
      expect(shader.fragmentShader).toContain("mod(vVoxelEdgeDistance, 0.2) > 0.11) discard");
      expect(shader.fragmentShader).toContain("#include <color_fragment>");
    }
    const source = readFileSync("src/features/spatial-math/renderer-r3f/VoxelCanvas.tsx", "utf8");
    expect(source).toContain('key={hiddenEdgeUniforms ? "dashed" : "solid"}');
    expect(source).toContain("<VoxelTranslucentCube");
    expect(source).toContain("opacity={cell.opacity} transparent depthWrite={false}");
    expect(source).not.toContain("VoxelScreenEdges");
  });

  it("provides dedicated SVG cursors and panels without adding another workbench", () => {
    const source = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8");
    expect(source.match(/<CubeStructuresViewport /g)).toHaveLength(1);
    for (const tool of ["cut", "mark", "number", "transparent"] as const) expect(cubeToolCursor(tool)).toContain("data:image/svg+xml");
    expect(source).toContain("data-cube-cut-panel");
    expect(source).toContain("data-cube-annotation-panel");
    expect(source).toContain("data-cube-transparency-panel");
    const initial = createCubeHistory(block).initial;
    expect(new Set(initial.cubes.map((cube) => voxelKey(cube.position))).size).toBe(27);
  });
});
