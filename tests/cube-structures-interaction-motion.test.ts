import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FaceDirection } from "@/features/spatial-math/domain";
import { buildVoxelEdgeInstances } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import { CUBE_COLORS, applyCubeOperation, createCubeHistory, cubeCutOperation, cubeDisplayPosition, cubePaintGroups, cubeStructureMetrics } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeCutFromFace, cubeCutLayers } from "@/features/tools/spatial-lab/cube-structures-cut-interaction";
import { cubeDisplayPositions, cubeMotionDistance, cubeMotionDuration, cubePresentationState, interpolateCubePositions } from "@/features/tools/spatial-lab/cube-structures-motion";
import { cubeLabelAnchor } from "@/features/tools/spatial-lab/cube-structures-annotations";
import { createCubeSession, cubeSessionScene, operateCubeSession, startCubeRecording } from "@/features/tools/spatial-lab/cube-structures-session";

const solid = Array.from({ length: 27 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) % 3, z: Math.floor(i / 9) }));
const initial = createCubeHistory(solid).initial;
const ids = initial.cubes.map((cube) => cube.id);

describe("direct face cuts and presentation-only cube motion", () => {
  it.each(["x+", "x-", "y+", "y-", "z+", "z-"] as FaceDirection[])("uses %s to select the matching XYZ section without an axis selector", (direction) => {
    const axis = direction[0] as "x" | "y" | "z";
    const positive = direction[1] === "+";
    const cube = initial.cubes.find((cell) => cell.position[axis] === (positive ? 2 : 0))!;
    const selection = cubeCutFromFace(initial, ids, { cell: cube.position, direction });
    expect(selection).toMatchObject({ axis, after: positive ? 1 : 0, side: positive ? 1 : -1, cubeId: cube.id });
    expect(selection!.anchor[axis]).toBe(positive ? 1.5 : 0.5);
    const operation = cubeCutOperation(initial, selection!.ids, selection!.axis, selection!.after, selection!.side, 2, "piece", "piece")!;
    expect(operation.ids.length).toBe(9);
  });

  it("rejects out-of-scope hits and one-layer faces instead of creating an empty cut", () => {
    const top = initial.cubes.filter((cube) => cube.position.y === 2).map((cube) => cube.id);
    expect(cubeCutFromFace(initial, top, { cell: { x: 0, y: 0, z: 0 }, direction: "z+" })).toBeNull();
    expect(cubeCutFromFace(initial, top, { cell: { x: 0, y: 2, z: 0 }, direction: "y+" })).toBeNull();
    expect(cubeCutLayers(initial, top, "y")).toEqual([]);
  });

  it("places a new preview and its action anchor in the displaced piece's frame", () => {
    const first = applyCubeOperation(initial, cubeCutOperation(initial, ids, "x", 0, 1, 2, "part", "part")!);
    const cube = first.cubes.find((cell) => cell.position.x === 2 && cell.position.y === 2)!;
    const selection = cubeCutFromFace(first, first.groups[0].cubeIds, { cell: cubeDisplayPosition(cube), direction: "y+" });
    expect(selection).toMatchObject({ axis: "y", after: 1, anchor: { x: 4, y: 1.5 } });
  });

  it("keeps hover and locked previews out of the recording until Cut is confirmed", () => {
    const session = startCubeRecording(createCubeSession(solid));
    const state = cubeSessionScene(session);
    const snapshot = JSON.stringify(session);
    const preview = cubeCutFromFace(state, ids, { cell: { x: 2, y: 0, z: 0 }, direction: "x+" })!;
    const locked = { ...preview };
    expect(JSON.stringify(session)).toBe(snapshot);
    const committed = operateCubeSession(session, cubeCutOperation(state, locked.ids, locked.axis, locked.after, locked.side, 2, "part", "part")!);
    expect(committed.lesson?.operations).toHaveLength(1);
    expect(committed.lesson?.operations[0].kind).toBe("cut");
  });

  it("moves smoothly through real intermediate positions with exact endpoints", () => {
    const moved = applyCubeOperation(initial, { kind: "display-move", ids, axis: "x", distance: 4 });
    const from = cubeDisplayPositions(initial.cubes);
    const to = cubeDisplayPositions(moved.cubes);
    expect(cubeMotionDistance(from, to)).toBe(4);
    expect(interpolateCubePositions(from, to, 0)).toEqual(from);
    expect(interpolateCubePositions(from, to, 1)).toBe(to);
    const middle = interpolateCubePositions(from, to, 0.5);
    expect(middle.get(ids[0])!.x).toBe(from.get(ids[0])!.x + 2);
    const startDelta = interpolateCubePositions(from, to, 0.1).get(ids[0])!.x - from.get(ids[0])!.x;
    const middleDelta = interpolateCubePositions(from, to, 0.6).get(ids[0])!.x - middle.get(ids[0])!.x;
    expect(startDelta).toBeLessThan(middleDelta);
    expect(cubeMotionDuration(0.5)).toBeGreaterThanOrEqual(400);
    expect(cubeMotionDuration(48)).toBeLessThan(1000);
  });

  it("continues interrupted movement from the displayed position and can animate undo", () => {
    const from = cubeDisplayPositions(initial.cubes);
    const moved = applyCubeOperation(initial, { kind: "move", ids, axis: "y", distance: 4 });
    const to = cubeDisplayPositions(moved.cubes);
    const current = interpolateCubePositions(from, to, 0.35);
    expect(interpolateCubePositions(current, from, 0)).toEqual(current);
    expect(interpolateCubePositions(current, from, 1)).toBe(from);
    expect(interpolateCubePositions(to, from, 0.5).get(ids[0])!.y).toBe(from.get(ids[0])!.y + 2);
  });

  it("moves colors, painted faces and annotations together while recorded math stays exact", () => {
    let state = applyCubeOperation(initial, { kind: "paint", faces: [{ id: ids[0], direction: "z+" }], color: CUBE_COLORS[1] });
    state = applyCubeOperation(state, { kind: "mark", ids: [ids[0]], shape: "star", placement: "center", direction: "z+", color: CUBE_COLORS[2] });
    const moved = applyCubeOperation(state, { kind: "display-move", ids, axis: "z", distance: 2 });
    const before = JSON.stringify(moved);
    const halfway = cubePresentationState(moved, interpolateCubePositions(cubeDisplayPositions(state.cubes), cubeDisplayPositions(moved.cubes), 0.5));
    expect(cubePaintGroups(halfway)[0].faces[0].cell.z).toBe(state.cubes[0].position.z + 1);
    expect(cubeLabelAnchor(halfway.cubes[0], halfway.cubes[0].mark!).z).toBe(state.cubes[0].position.z + 1);
    expect(cubeStructureMetrics(halfway)).toEqual(cubeStructureMetrics(state));
    expect(JSON.stringify(moved)).toBe(before);
  });

  it("does not move unrelated cubes, and new or removed IDs are not mistaken for old cubes", () => {
    const from = cubeDisplayPositions(initial.cubes);
    let next = applyCubeOperation(initial, { kind: "display-move", ids: [ids[0]], axis: "x", distance: -2 });
    next = applyCubeOperation(next, { kind: "remove", ids: [ids[1]] });
    next = applyCubeOperation(next, { kind: "build", id: "new", position: { x: 4, y: 0, z: 0 }, color: CUBE_COLORS[0] });
    const positions = interpolateCubePositions(from, cubeDisplayPositions(next.cubes), 0.4);
    expect(positions.get(ids[2])).toEqual(from.get(ids[2]));
    expect(positions.has(ids[1])).toBe(false);
    expect(positions.get("new")).toEqual({ x: 4, y: 0, z: 0 });
  });

  it("retains distinct edges during the first tiny movement instead of rounding them into one bar", () => {
    const together = buildVoxelEdgeInstances([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
    const separating = buildVoxelEdgeInstances([{ x: 0, y: 0, z: 0 }, { x: 1.005, y: 0, z: 0 }]);
    expect(together.y).toHaveLength(6);
    expect(separating.y).toHaveLength(8);
    expect(separating.y.some((edge) => edge.key.includes("0.505"))).toBe(true);
  });

  it("anchors confirmations to the section, panels to their tools, and groups at bottom right", () => {
    const scene = readFileSync("src/features/tools/spatial-lab/CubeStructuresScene.tsx", "utf8");
    const workbench = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8");
    const css = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.module.css", "utf8");
    expect(scene).toContain("data-cube-cut-confirmation");
    expect(scene).toContain("onClick={cutConfirmation.onConfirm}");
    expect(scene).toContain("onClick={cutConfirmation.onCancel}");
    expect(workbench).toContain("const cutSelection = lockedCut ?? hoveredCut");
    expect(workbench).not.toContain("setCutAfter");
    expect(css).toMatch(/\.groups \{[^}]*bottom: 8px; right: 8px/);
    expect(css).toContain('data-cube-panel-anchor="meta"');
    expect(css).toContain("right: 56px");
  });

  it("keeps slider input independent, previews once per frame, and commits once on release", () => {
    const slider = readFileSync("src/features/tools/spatial-lab/CubeOpacitySlider.tsx", "utf8");
    const viewport = readFileSync("src/features/tools/spatial-lab/CubeStructuresViewport.tsx", "utf8");
    const motion = readFileSync("src/features/tools/spatial-lab/useCubeDisplayMotion.ts", "utf8");
    expect(slider).toContain("step={1}");
    expect(slider).toContain("h-11 cursor-ew-resize");
    expect(slider).toContain("if (!frame.current)");
    expect(slider).toContain("onValueCommit={([next]) => finish(next)}");
    expect(viewport).toContain("useCubeDisplayMotion");
    expect(viewport).toContain("cubePaintGroups(presentation)");
    expect(viewport).toContain("opacityPreview.opacity");
    expect(motion).toContain("prefers-reduced-motion: reduce");
    expect(motion).toContain("current.current.positions");
  });
});
