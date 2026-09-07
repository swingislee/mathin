import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { applyCubeOperation, createCubeHistory, cubeCutOperation, cubeDisplayPosition, cubeStructureMetrics, type CubeStructureState } from "@/features/tools/spatial-lab/cube-structures-contract";
import { EMPTY_CUBE_CUT, chooseCubeCut, type CubeCutDraft, type CubeCutHit } from "@/features/tools/spatial-lab/cube-structures-cut-interaction";
import { buildCubeCutGeometry, pickCubeCut } from "@/features/tools/spatial-lab/cube-structures-cut-picking";
import { buildCubeCutPieces, cubeCutScopeIds } from "@/features/tools/spatial-lab/cube-structures-cut-scope";
import { createSpatialLabPresetDraft, SPATIAL_LAB_PRESET_ID } from "@/features/tools/spatial-lab/preset";
import { createCubeSession, cubeSessionScene, operateCubeSession, startCubeRecording, undoCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";

const positions = createSpatialLabPresetDraft(SPATIAL_LAB_PRESET_ID).model.cells;
const initial = createCubeHistory(positions).initial;
const all = (state: CubeStructureState) => state.cubes.map((cube) => cube.id);
const firstCut = cubeCutOperation(initial, all(initial), "x", 1, 1, 2, "cut-1", "Part 1")!;
const separated = applyCubeOperation(initial, firstCut);
const remainder = all(separated).filter((id) => !firstCut.ids.includes(id));
const pieces = buildCubeCutPieces(separated);

function faceHit(state: CubeStructureState, logical: { x: number; y: number; z: number }, direction: "x+" | "z+"): CubeCutHit {
  const cube = state.cubes.find((cube) => cube.position.x === logical.x && cube.position.y === logical.y && cube.position.z === logical.z)!;
  const cell = cubeDisplayPosition(cube); const axis = direction[0] as "x" | "z";
  return { kind: "face", cubeId: cube.id, face: { cell, direction }, point: { ...cell, [axis]: cell[axis] + 0.5 } };
}
function edgeHit(state: CubeStructureState, along: "x" | "y", start: { x: number; y: number; z: number }): CubeCutHit {
  const line = buildCubeCutGeometry(state).lines.find((line) => line.along === along && line.start.x === start.x && line.start.y === start.y && line.start.z === start.z);
  expect(line).toBeDefined(); return { kind: "edge", line: line! };
}
function choose(state: CubeStructureState, draft: CubeCutDraft, hit: CubeCutHit | null, selected: readonly string[] = []) {
  return chooseCubeCut(state, cubeCutScopeIds(state, buildCubeCutPieces(state), selected, draft, hit), draft, hit);
}
const bodyFace = faceHit(separated, { x: 0, y: 1, z: 1 }, "x+");

describe("continuous cuts follow the clicked displayed piece", () => {
  it("reproduces the screenshot's stale two-cube group scope and resolves the eight-cube body instead", () => {
    expect(firstCut.ids).toHaveLength(2); expect(remainder).toHaveLength(8);
    expect(chooseCubeCut(separated, separated.groups[0].cubeIds, EMPTY_CUBE_CUT, bodyFace).issue).toBe("scope");
    expect(cubeCutScopeIds(separated, pieces, [], EMPTY_CUBE_CUT, bodyFace)).toEqual(remainder);
    expect(choose(separated, EMPTY_CUBE_CUT, bodyFace).selection).toMatchObject({ axis: "x", after: 0, ids: remainder });
  });

  it("accepts the visible face via the actual automatic picker after the first cut", () => {
    const camera = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.01, 100);
    camera.position.set(11, 1, 1); camera.lookAt(1, 1, 1); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const projected = new Vector3(0.5, 1, 1).project(camera);
    const hit = pickCubeCut(buildCubeCutGeometry(separated), "auto", { x: (projected.x + 1) * 400, y: (1 - projected.y) * 300 }, camera, { width: 800, height: 600 });
    expect(hit).toMatchObject({ kind: "face", face: { cell: { x: 0, y: 1, z: 1 }, direction: "x+" } });
    if (hit?.kind === "face") { expect(hit.point.x).toBeCloseTo(0.5, 6); expect(hit.point.z).toBeCloseTo(1, 6); }
    expect(choose(separated, EMPTY_CUBE_CUT, hit)).toMatchObject({ issue: null, selection: { ids: remainder, after: 0 } });
  });

  it("keeps two lines on the first piece and permits another piece after resetting the draft", () => {
    const first = edgeHit(separated, "y", { x: 0.5, y: -0.5, z: 1.5 });
    const other = edgeHit(separated, "y", { x: 4.5, y: -0.5, z: 0.5 });
    const draft = choose(separated, EMPTY_CUBE_CUT, first);
    expect(cubeCutScopeIds(separated, pieces, [], draft, other)).toEqual(remainder);
    expect(choose(separated, draft, other)).toMatchObject({ firstLine: draft.firstLine, selection: null, issue: "scope" });
    expect(cubeCutScopeIds(separated, pieces, [], EMPTY_CUBE_CUT, other)).toEqual(firstCut.ids);
    expect(choose(separated, EMPTY_CUBE_CUT, other).firstLine).not.toBeNull();
  });

  it("can change from a pending line to a face on another piece and retain that face's scope", () => {
    const draft = choose(separated, EMPTY_CUBE_CUT, edgeHit(separated, "y", { x: 0.5, y: -0.5, z: 1.5 }));
    const face = faceHit(separated, { x: 2, y: 0, z: 1 }, "z+");
    const next = choose(separated, draft, face);
    expect(next).toMatchObject({ firstLine: null, issue: "boundary", face: face.kind === "face" ? face.face : null });
    expect(cubeCutScopeIds(separated, pieces, [], next, null)).toEqual(firstCut.ids);
  });

  it("records three cuts across the remaining body and an earlier piece without moving unrelated cubes", () => {
    let session = operateCubeSession(startCubeRecording(createCubeSession(positions)), firstCut);
    const selected = choose(cubeSessionScene(session), EMPTY_CUBE_CUT, bodyFace).selection!;
    const secondCut = cubeCutOperation(cubeSessionScene(session), selected.ids, selected.axis, selected.after, -1, 2, "cut-2", "Part 2")!;
    session = operateCubeSession(session, secondCut);
    const afterSecond = cubeSessionScene(session);
    expect(afterSecond.cubes.filter((cube) => firstCut.ids.includes(cube.id))).toEqual(separated.cubes.filter((cube) => firstCut.ids.includes(cube.id)));
    let draft = choose(afterSecond, EMPTY_CUBE_CUT, edgeHit(afterSecond, "y", { x: 4.5, y: -0.5, z: 0.5 }));
    draft = choose(afterSecond, draft, edgeHit(afterSecond, "x", { x: 3.5, y: 0.5, z: 0.5 }));
    expect(draft.selection).toMatchObject({ axis: "z", after: 0, ids: firstCut.ids });
    const cut = draft.selection!;
    session = operateCubeSession(session, cubeCutOperation(afterSecond, cut.ids, cut.axis, cut.after, cut.side, 2, "cut-3", "Part 3")!);
    const afterThird = cubeSessionScene(session);
    expect(afterThird.cubes.filter((cube) => !cut.ids.includes(cube.id))).toEqual(afterSecond.cubes.filter((cube) => !cut.ids.includes(cube.id)));
    expect(afterThird.cubes).toHaveLength(initial.cubes.length); expect(cubeStructureMetrics(afterThird)).toEqual(cubeStructureMetrics(initial));
    expect(session.lesson?.operations).toHaveLength(3); expect(afterThird.groups.map((group) => group.id)).toEqual(["cut-1", "cut-2", "cut-3"]);
    const undone = undoCubeSession(session, -1);
    expect(cubeSessionScene(undone)).toEqual(afterSecond);
    expect(cubeSessionScene(undoCubeSession(undone, 1))).toEqual(afterThird);
  });

  it("honors explicit multi-selection until cleared, independently of automatic part selection", () => {
    expect(cubeCutScopeIds(separated, pieces, firstCut.ids, EMPTY_CUBE_CUT, bodyFace)).toBe(firstCut.ids);
    expect(choose(separated, EMPTY_CUBE_CUT, bodyFace, firstCut.ids).issue).toBe("scope");
    expect(choose(separated, EMPTY_CUBE_CUT, bodyFace).issue).toBeNull();
  });

  it("retains hidden bridge cells and ignores transparency when determining a physical part", () => {
    const state = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]).initial;
    const hidden = { ...state, hiddenCubeIds: [state.cubes[1].id], cubes: state.cubes.map((cube) => ({ ...cube, opacity: 0 })) };
    expect(buildCubeCutPieces(hidden).get(state.cubes[0].id)).toEqual(all(state));
  });

  it("uses actual face contact, including partial faces, rather than logical neighbors or shared corners", () => {
    const state = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 3, y: 1, z: 0 }]).initial;
    const partial = { ...state, cubes: state.cubes.map((cube, index) => index === 1 ? { ...cube, displayOffset: { x: 0, y: 0.5, z: 0 } } : cube) };
    expect(buildCubeCutPieces(partial).get(state.cubes[0].id)).toEqual(all(state).slice(0, 2));
    const corner = { ...state, cubes: state.cubes.map((cube, index) => index === 1 ? { ...cube, displayOffset: { x: 0, y: 1, z: 0 } } : cube) };
    expect(buildCubeCutPieces(corner).get(state.cubes[0].id)).toEqual([state.cubes[0].id]);
    expect(new Set(pieces.values()).size).toBe(2);
  });

  it("rebuilds a single part after reassembly even though cut groups still exist", () => {
    const rejoined = applyCubeOperation(separated, { kind: "display-reset", ids: all(separated) });
    expect(rejoined.groups).toEqual(separated.groups);
    expect(cubeCutScopeIds(rejoined, buildCubeCutPieces(rejoined), [], EMPTY_CUBE_CUT, faceHit(rejoined, { x: 2, y: 0, z: 1 }, "z+"))).toEqual(all(initial));
  });

  it("keeps a locked cut scope stable and explains when a single cube cannot be cut further", () => {
    const draft = choose(separated, EMPTY_CUBE_CUT, bodyFace);
    const other = faceHit(separated, { x: 2, y: 0, z: 1 }, "z+");
    expect(cubeCutScopeIds(separated, pieces, [], draft, other)).toBe(draft.selection!.ids);
    const single = createCubeHistory([{ x: 0, y: 0, z: 0 }]).initial;
    expect(choose(single, EMPTY_CUBE_CUT, faceHit(single, { x: 0, y: 0, z: 0 }, "x+"))).toMatchObject({ issue: "singleLayer", selection: null });
  });

  it("wires identical piece resolution into hover and click without auto-locking the new group", () => {
    const source = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8");
    expect(source).toContain("cubeCutScopeIds(state, cutPieces, selectedIds, cutDraft, hoveredCutHit)");
    expect(source).toContain("cubeCutScopeIds(state, cutPieces, selectedIds, cutDraft, hit)");
    expect(source).toContain("cubeCutCandidate(state, cutTargetIds, cutDraft.firstLine, hoveredCutHit)");
    const performCut = source.slice(source.indexOf("function performCut()"), source.indexOf("function chooseMode()"));
    expect(performCut).toContain("if (commit(operation)) { setScopeId(null); setSelected([]); }");
    expect(performCut).not.toContain("setScopeId(groupId)");
    expect(source).toContain("{cutScopeDescription}");
  });
});
