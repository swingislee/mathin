import { afterEach, describe, expect, it, vi } from "vitest";
import { SOMA_IDS, SOMA_PIECES, SOMA_ROTATIONS, somaCells, somaLocalCells, somaPlacementValid, somaTurn } from "@/features/tools/soma-cube/pieces";
import { SOMA_VERSION, somaSnapshotSchema, somaToolSchema } from "@/features/tools/soma-cube/contract";
import { createSomaInitial, SOMA_CUBE_EXAMPLE, somaChoose, somaCubeState, somaDrag, somaDragPresentation, somaFit, somaMove, somaRenderModel, somaRotate, somaVisiblePieces } from "@/features/tools/soma-cube/model";
import { cubeDragPositions } from "@/features/tools/spatial-lab/cube-structures-drag";
import { freezeToolScene, parseToolScene, toolSceneCatalogId } from "@/features/tools/scenes/contract";
import { getToolSceneDefinition } from "@/features/tools/scenes/registry";
import { createClassroomToolState, coursewareToolOriginHash, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { createEmptyCoursewareCompositionPage, coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";

const shape = (cells: readonly { x: number; y: number; z: number }[]) => cells.map((cell) => `${cell.x},${cell.y},${cell.z}`).sort().join(";");
describe("the seven source Soma pieces", () => {
  it("preserves the names, sampled sRGB colors, volumes and distinct handed shapes", () => {
    expect(SOMA_PIECES.map((piece) => piece.name)).toEqual(["1宝", "2宝", "3宝", "4宝", "5宝", "6宝", "7宝"]);
    expect(SOMA_PIECES.map((piece) => piece.color)).toEqual(["#ffffff", "#ffff00", "#fe0000", "#ffa500", "#81007f", "#00ff01", "#0000fe"]);
    expect(SOMA_PIECES.map((piece) => piece.cells.length)).toEqual([3, 4, 4, 4, 4, 4, 4]);
    expect(SOMA_ROTATIONS).toHaveLength(24);
    const orientations = SOMA_IDS.map((id) => new Set(SOMA_ROTATIONS.map((_, index) => shape(somaLocalCells(id, index)))));
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) expect([...orientations[a]].some((item) => orientations[b].has(item))).toBe(false);
    const mirroredFive = SOMA_PIECES[4].cells.map((p) => ({ ...p, x: 1 - p.x }));
    expect(orientations[5].has(shape(mirroredFive))).toBe(true);
    const initial = createSomaInitial(), render = somaRenderModel(somaCubeState(initial.pieces), initial, "Soma");
    expect(new Set(render.cells.map((cell) => cell.materialToken))).toEqual(new Set(SOMA_PIECES.map((piece) => piece.color)));
    expect(render.cells.filter((cell) => cell.selected).every((cell) => cell.materialToken === "#ffffff" && cell.emphasis?.faceOpacity === 0)).toBe(true);
  });
  it("uses only proper rotations and returns exactly after four quarter turns", () => {
    for (const [a, b, c] of SOMA_ROTATIONS) expect(a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)).toBe(1);
    for (const id of SOMA_IDS) for (let orientation = 0; orientation < 24; orientation++) for (const axis of ["x", "y", "z"] as const) {
      let turned = orientation;
      for (let step = 0; step < 4; step++) turned = somaTurn(turned, axis, 1);
      expect(turned).toBe(orientation);
      expect(somaTurn(somaTurn(orientation, axis, -1), axis, 1)).toBe(orientation);
      expect(new Set(somaLocalCells(id, turned).map((p) => JSON.stringify(p))).size).toBe(id === "bao-1" ? 3 : 4);
    }
  });
  it("packs the example into every cell of a 3 by 3 by 3 cube once", () => {
    const cells = SOMA_CUBE_EXAMPLE.flatMap(somaCells);
    expect(somaPlacementValid(SOMA_CUBE_EXAMPLE)).toBe(true);
    expect(cells).toHaveLength(27);
    const expected = Array.from({ length: 27 }, (_, index) => ({ x: index % 3 - 1, y: Math.floor(index / 3) % 3, z: Math.floor(index / 9) - 1 }));
    expect(shape(cells)).toBe(shape(expected));
  });
});
describe("free choice and rigid manipulation", () => {
  it("accepts all 127 nonempty subsets, including nonconsecutive two- and three-piece assemblies", () => {
    for (let bits = 1; bits < 128; bits++) {
      const ids = SOMA_IDS.filter((_, index) => bits & (1 << index));
      const subset = somaChoose(createSomaInitial(), ids)!;
      expect(somaSnapshotSchema.safeParse(subset).success).toBe(true);
      expect(subset.pieces.map((piece) => piece.id)).toEqual(ids);
    }
    expect(somaChoose(createSomaInitial(), [])).toBeNull();
    expect(somaChoose(createSomaInitial(), ["bao-1", "bao-1"])).toBeNull();
    const one = somaChoose(createSomaInitial(), ["bao-5"])!;
    const added = somaChoose(one, ["bao-2", "bao-5", "bao-7"])!;
    expect(added.pieces.find((piece) => piece.id === "bao-5")).toBe(one.pieces[0]);
    expect(somaPlacementValid(added.pieces)).toBe(true);
  });
  it("moves a whole Bao even when a shared drag gesture starts on one of its cells", () => {
    const initial = createSomaInitial();
    const moved = somaDrag(initial, { kind: "move", ids: ["bao-6:2"], axis: "y", distance: 2 })!;
    expect(moved.selectedId).toBe("bao-6");
    expect(moved.pieces[5].position.y).toBe(2);
    expect(somaCells(moved.pieces[5])).toEqual(somaCells(initial.pieces[5]).map((p) => ({ ...p, y: p.y + 2 })));
    expect(moved.pieces[0]).toBe(initial.pieces[0]);
    const state = somaCubeState(initial.pieces);
    const preview = somaDragPresentation(state, { axis: "y", distance: 2, valid: true, positions: cubeDragPositions(state, ["bao-6:2"], "y", 2) });
    expect(preview.cubes.filter((cube) => cube.id.startsWith("bao-6:")).map((cube) => cube.position)).toEqual(somaCells(moved.pieces[5]));
    expect(somaDrag(initial, { kind: "move", ids: ["bao-1:0", "bao-2:0"], axis: "x", distance: 1 })).toBeNull();
  });
  it("renders overlapping drag previews without validating transient coordinates as a settled voxel set", () => {
    const initial = createSomaInitial(), before = structuredClone(initial);
    const state = somaCubeState(initial.pieces);
    const settled = somaRenderModel(state, initial, "Soma");
    const presentation = somaDragPresentation(state, {
      axis: "x", distance: -3, valid: false,
      positions: cubeDragPositions(state, ["bao-6:2"], "x", -3),
    });
    const rendered = somaRenderModel(state, initial, "Soma", presentation);
    expect(rendered.cells).toHaveLength(27);
    expect(new Set(rendered.cells.map((cell) => cell.key)).size).toBe(27);
    expect(new Set(rendered.cells.map((cell) => `${cell.x},${cell.y},${cell.z}`)).size).toBeLessThan(27);
    expect(rendered.cells.map(({ x, y, z }) => ({ x, y, z }))).toEqual(presentation.cubes.map((cube) => cube.position));
    expect(rendered.projection).toEqual(settled.projection);
    expect(rendered.cells.map((cell) => cell.materialToken)).toEqual(settled.cells.map((cell) => cell.materialToken));
    expect(somaDrag(initial, { kind: "move", ids: ["bao-6:2"], axis: "x", distance: -3 })).toBeNull();
    expect(initial).toEqual(before);
    expect(somaRenderModel(state, initial, "Soma", somaDragPresentation(state, null))).toEqual(settled);
    const moved = somaDrag(initial, { kind: "move", ids: ["bao-6:2"], axis: "y", distance: 2 })!;
    expect(somaRenderModel(somaCubeState(moved.pieces), moved, "Soma").cells).toHaveLength(27);
  });
  it("rejects overlaps and out-of-board moves while preserving the source", () => {
    const initial = createSomaInitial(), before = structuredClone(initial);
    expect(somaMove(initial, "bao-1", "x", 3)).toBeNull();
    expect(somaMove(initial, "bao-1", "y", -1)).toBeNull();
    expect(somaMove(initial, "bao-1", "x", 0.5)).toBeNull();
    expect(somaMove(initial, "bao-1", "x", 50)).toBeNull();
    expect(initial).toEqual(before);
    let alone = somaMove(somaChoose(initial, ["bao-1"])!, "bao-1", "y", 3)!;
    const lifted = alone.pieces;
    for (let i = 0; i < 4; i++) alone = somaRotate(alone, "z", 1)!;
    expect(alone.pieces).toEqual(lifted);
  });
  it("isolates observation without changing any stored assembly positions", () => {
    const initial = { ...createSomaInitial(), pieces: structuredClone([...SOMA_CUBE_EXAMPLE]) };
    const observed = somaFit({ ...initial, mode: "observe", selectedId: "bao-5" });
    expect(observed.pieces).toBe(initial.pieces);
    expect(somaVisiblePieces(observed)).toEqual([{ ...initial.pieces[4], position: { x: 0, y: 0, z: 0 } }]);
    expect(somaVisiblePieces({ ...observed, mode: "assemble" })).toBe(initial.pieces);
  });
});
describe("common scene and classroom contracts", () => {
  afterEach(() => vi.unstubAllGlobals());
  const scene = () => somaToolSchema.parse({ toolId: "soma-cube", contentVersion: SOMA_VERSION, payload: { title: "Seven Bao", initial: createSomaInitial() } });
  it("freezes a self-contained scene and restores the versioned classroom state on HTTP", () => {
    vi.stubGlobal("crypto", {});
    const source = scene(), frozen = freezeToolScene(source);
    expect(parseToolScene(JSON.parse(JSON.stringify(frozen)))).toEqual(source);
    expect(frozen).not.toBe(source);
    expect(toolSceneCatalogId(source)).toBe("soma-cube");
    expect(getToolSceneDefinition("soma-cube")?.contentVersion).toBe(SOMA_VERSION);
    const page = addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), frozen);
    expect(coursewareCompositionPageSchema.parse(page)).toEqual(page);
    const state = somaMove(source.payload.initial, "bao-7", "y", 1)!;
    const event = createClassroomToolState("page", "doc", "soma", { toolId: "soma-cube", contentVersion: SOMA_VERSION, state }, coursewareToolOriginHash(source.payload));
    expect(parseClassroomToolState(event)?.state).toEqual(state);
    expect(parseClassroomToolState({ ...event, toolId: "dice" })).toBeNull();
    source.payload.initial.pieces[0].position.x = 9;
    expect(frozen.payload).not.toEqual(source.payload);
  });
  it("rejects duplicate pieces, unknown versions, invalid orientation, selection and collisions", () => {
    const initial = createSomaInitial();
    const invalid = [
      { ...initial, pieces: [] }, { ...initial, pieces: [...initial.pieces, initial.pieces[0]] },
      { ...initial, selectedId: "bao-8" }, { ...initial, pieces: [{ ...initial.pieces[0], orientation: 24 }] },
      { ...initial, pieces: [{ ...initial.pieces[0], position: { x: 0, y: -1, z: 0 } }] },
      { ...initial, pieces: [{ ...initial.pieces[0], position: { x: 0.1, y: 0, z: 0 } }] },
      { ...initial, pieces: initial.pieces.map((piece) => ({ ...piece, position: { x: 0, y: 0, z: 0 } })) },
      { ...initial, sourceDraftId: "private" },
    ];
    for (const value of invalid) expect(somaSnapshotSchema.safeParse(value).success).toBe(false);
    expect(() => parseToolScene({ ...scene(), contentVersion: "soma-cube-lesson-v2" })).toThrow();
  });
});
