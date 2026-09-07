import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { OrthographicCamera, Raycaster, Vector2, Vector3 } from "three";
import type { Axis, VoxelCoordinate } from "@/features/spatial-math/domain";
import { CUBE_COLORS, applyCubeOperation, createCubeHistory, cubeCutOperation, cubeStructureMetrics, type CubeStructureState } from "@/features/tools/spatial-lab/cube-structures-contract";
import { EMPTY_CUBE_CUT, chooseCubeCut, cubeCutCandidate, cubeCutFromLines, type CubeCutDraft, type CubeCutHit } from "@/features/tools/spatial-lab/cube-structures-cut-interaction";
import { buildCubeCutGeometry, pickCubeCut, pickCubeCutFace, type CubeCutGeometry } from "@/features/tools/spatial-lab/cube-structures-cut-picking";
import { bindCubeCutPicking, type CubeCutInteraction } from "@/features/tools/spatial-lab/cube-structures-cut-controller";
import { cubeStructuresMessages } from "@/features/tools/spatial-lab/cube-structures-messages";
import { createCubeSession, cubeSessionScene, operateCubeSession, startCubeRecording, undoCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";

const solid = Array.from({ length: 27 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) % 3, z: Math.floor(i / 9) }));
const state = createCubeHistory(solid).initial;
const ids = state.cubes.map((cube) => cube.id);
const geometry = buildCubeCutGeometry(state);
const size = { width: 800, height: 600 };
function camera(direction = [1, 1, 2], zoom = 1) {
  const result = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.01, 100);
  result.position.set(1 + direction[0] * 10, 1 + direction[1] * 10, 1 + direction[2] * 10);
  if (direction[0] === 0 && direction[2] === 0) result.up.set(0, 0, -1);
  result.zoom = zoom; result.lookAt(1, 1, 1); result.updateProjectionMatrix(); result.updateMatrixWorld(); return result;
}
function project(point: VoxelCoordinate, view = camera()) {
  const p = new Vector3(point.x, point.y, point.z).project(view);
  return { x: (p.x + 1) * size.width / 2, y: (1 - p.y) * size.height / 2 };
}
function line(along: Axis, start: VoxelCoordinate, model: CubeCutGeometry = geometry) {
  const result = model.lines.find((candidate) => candidate.along === along && (['x', 'y', 'z'] as const).every((axis) => candidate.start[axis] === start[axis]));
  expect(result, `${along}:${JSON.stringify(start)}`).toBeDefined(); return result!;
}
const first = line("y", { x: 0.5, y: 0.5, z: 2.5 });
const top = line("z", { x: 0.5, y: 2.5, z: 0.5 });
const back = line("y", { x: 0.5, y: 0.5, z: -0.5 });
const edge = (value = first): CubeCutHit => ({ kind: "edge", line: value });

describe("visible cut geometry is independent of rendering order", () => {
  it.each(["original", "reversed", "recolored"])("selects the exposed face and exact oblique seam with %s instances", (variation) => {
    const changed = variation === "reversed" ? { ...state, cubes: [...state.cubes].reverse() } : variation === "recolored"
      ? applyCubeOperation(state, { kind: "color", ids: [state.cubes.find((cube) => cube.position.x === 0 && cube.position.y === 1 && cube.position.z === 2)!.id], color: CUBE_COLORS[1] }) : state;
    const index = buildCubeCutGeometry(changed);
    const pointer = project({ x: 0.5, y: 1, z: 2.5 });
    expect(pickCubeCut(index, "face", pointer, camera(), size)).toMatchObject({ kind: "face", face: { direction: "z+", cell: { z: 2 } } });
    expect(pickCubeCut(index, "edge", pointer, camera(), size)).toMatchObject(edge());
  });

  it.each([[1, 0.8, 1], [1, 0, 1], [-1, 0, 1], [1, 1, 2]])("keeps front seams selectable from oblique direction %j", (...direction) => {
    const view = camera(direction);
    expect(pickCubeCut(geometry, "edge", project({ x: 0.5, y: 1, z: 2.5 }, view), view, size)).toMatchObject(edge());
  });

  it("picks only frontmost opaque surfaces and excludes hidden cells", () => {
    const view = camera([0, 0, 1]); const pointer = project({ x: 1.1, y: 1.1, z: 2.5 }, view);
    const hit = pickCubeCut(geometry, "face", pointer, view, size);
    expect(hit).toMatchObject({ face: { cell: { x: 1, y: 1, z: 2 }, direction: "z+" } });
    const front = hit!.kind === "face" ? hit!.cubeId : "";
    const hidden = buildCubeCutGeometry({ ...state, hiddenCubeIds: [front] });
    expect(pickCubeCut(hidden, "face", pointer, view, size)).toMatchObject({ face: { cell: { z: 1 }, direction: "z+" } });
    expect(hidden.lines.every((line) => !line.cubeIds.includes(front))).toBe(true);
  });

  it.each([0, 0.3, 1])("defines an explicit fill picking policy for opacity %s, with edges retained", (opacity) => {
    const blocks = createCubeHistory([{ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }]).initial;
    const front = blocks.cubes.find((cube) => cube.position.z === 1)!;
    const index = buildCubeCutGeometry(applyCubeOperation(blocks, { kind: "opacity", ids: [front.id], opacity }));
    const view = camera([0, 0, 1]);
    expect(pickCubeCut(index, "face", project({ x: 1.1, y: 1.1, z: 1.5 }, view), view, size)).toMatchObject({ face: { cell: { z: opacity === 0 ? 0 : 1 }, direction: "z+" } });
    const hit = pickCubeCut(index, "edge", project({ x: 1.5, y: 1, z: 1.5 }, view), view, size);
    expect(hit).toMatchObject({ kind: "edge", line: { start: { x: 1.5, z: 1.5 } } });
  });

  it("does not select an internal or rear edge through a filled cube", () => {
    const view = camera([0, 0, 1]); const pointer = project({ x: 0.5, y: 1, z: -0.5 }, view);
    expect(pickCubeCut(geometry, "edge", pointer, view, size)).toMatchObject(edge());
    const internal = line("z", { x: 0.5, y: 0.5, z: 1.5 });
    expect(pickCubeCut({ ...geometry, lines: [internal] }, "edge", project({ x: 0.5, y: 0.5, z: 2.5 }), camera(), size)).toBeNull();
  });

  it.each([0.25, 1, 2])("keeps an 8 CSS-pixel edge radius at zoom %s", (zoom) => {
    const view = camera([0, 0, 1], zoom);
    const center = project({ x: 0.5, y: 1, z: 2.5 }, view);
    expect(pickCubeCut(geometry, "edge", { x: center.x + 6, y: center.y }, view, size)).toMatchObject(edge());
    expect(pickCubeCut(geometry, "edge", { x: center.x + 9, y: center.y }, view, size)).toBeNull();
  });

  it("preserves an intended line within pixel hysteresis near a crossing", () => {
    const view = camera([0, 0, 1]); const crossing = project({ x: 0.5, y: 0.5, z: 2.5 }, view);
    const hit = pickCubeCut(geometry, "edge", { x: crossing.x + 1.5, y: crossing.y - 1 }, view, size, edge());
    expect(hit).toMatchObject(edge());
    expect(pickCubeCut(geometry, "edge", { x: crossing.x + 5, y: crossing.y - 1 }, view, size, edge())).toMatchObject({ line: { along: "x" } });
  });

  it("uses actual positions after separation, not logical neighbors", () => {
    const moved = applyCubeOperation(state, { kind: "display-move", ids, axis: "x", distance: 3 });
    const index = buildCubeCutGeometry(moved); const view = camera();
    const pointer = project({ x: 3.5, y: 1, z: 2.5 }, view);
    expect(pickCubeCut(index, "edge", pointer, view, size)).toMatchObject({ line: { along: "y", start: { x: 3.5, z: 2.5 } } });
    const front = pickCubeCut(index, "face", pointer, view, size);
    expect(front).toMatchObject({ face: { direction: "z+", cell: { z: 2 } } });
    const partial = createCubeHistory([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]).initial;
    const shifted = applyCubeOperation(partial, { kind: "display-move", ids: [partial.cubes[1].id], axis: "y", distance: 0.5 });
    const raycaster = new Raycaster(); raycaster.setFromCamera(new Vector2(0, 0), camera([1, 0, 0]));
    raycaster.ray.origin.set(10, -0.3, 0);
    expect(pickCubeCutFace(buildCubeCutGeometry(shifted), raycaster.ray)).toMatchObject({ face: { direction: "x+", cell: { x: 0 } } });
  });
});

describe("two lines define one cut before a semantic confirmation", () => {
  it("retains just the first line and never creates a plane from one click", () => {
    const draft = chooseCubeCut(state, ids, EMPTY_CUBE_CUT, edge());
    expect(draft).toEqual({ ...EMPTY_CUBE_CUT, firstLine: first });
    expect(cubeCutCandidate(state, ids, null, edge())).toEqual({ selection: null, issue: null });
  });

  it.each([top, back])("accepts intersecting and distinct parallel coplanar lines", (second) => {
    expect(cubeCutFromLines(state, ids, first, second)).toMatchObject({ issue: null, selection: { axis: "x", after: 0, ids, lines: [first, second] } });
  });

  it.each([
    ["x", first, top],
    ["y", line("x", { x: 0.5, y: 0.5, z: 2.5 }), line("z", { x: 2.5, y: 0.5, z: 0.5 })],
    ["z", line("y", { x: 2.5, y: 0.5, z: 0.5 }), line("y", { x: -0.5, y: 0.5, z: 0.5 })],
  ] as const)("supports %s sections from front/top, front/right and left/right combinations", (axis, a, b) => {
    expect(cubeCutFromLines(state, ids, a, b).selection).toMatchObject({ axis, after: 0 });
  });

  it.each([
    [first, "collinear"], [line("y", { x: 0.5, y: 1.5, z: 2.5 }), "collinear"],
    [line("z", { x: 1.5, y: 2.5, z: 0.5 }), "skew"],
    [line("y", { x: 1.5, y: 0.5, z: -0.5 }), "oblique"],
    [line("y", { x: 1.5, y: 0.5, z: 2.5 }), "boundary"],
  ] as const)("keeps the first line for an invalid second line (%s)", (second, issue) => {
    const draft = chooseCubeCut(state, ids, EMPTY_CUBE_CUT, edge());
    expect(chooseCubeCut(state, ids, draft, edge(second))).toEqual({ ...draft, issue });
    expect(chooseCubeCut(state, ids, draft, null)).toEqual({ ...draft, issue: "miss" });
  });

  it("checks the visible hit against the effective selection/group scope without looking through it", () => {
    const draft = chooseCubeCut(state, [ids[0]], EMPTY_CUBE_CUT, edge());
    expect(draft).toEqual({ ...EMPTY_CUBE_CUT, issue: "scope" });
    const chosen = [first.cubeIds[0]];
    expect(chooseCubeCut(state, chosen, EMPTY_CUBE_CUT, edge()).firstLine).toBe(first);
    expect(cubeCutFromLines(state, chosen, first, back).selection).toBeNull();
  });

  it("distinguishes a selected whole face from a single-layer cut limitation", () => {
    const view = camera([0, 0, 1]);
    const faceHit = pickCubeCut(geometry, "face", project({ x: 1.49, y: 1.49, z: 2.5 }, view), view, size)!;
    expect(chooseCubeCut(state, ids, EMPTY_CUBE_CUT, faceHit).selection?.axis).toBe("z");
    const slab = state.cubes.filter((cube) => cube.position.z === 2).map((cube) => cube.id);
    const draft = chooseCubeCut(state, slab, EMPTY_CUBE_CUT, faceHit);
    expect(draft).toMatchObject({ selection: null, issue: "singleLayer", face: { direction: "z+" } });
    expect(cubeCutFromLines(state, slab, first, line("z", { x: 0.5, y: 2.5, z: 1.5 })).selection?.axis).toBe("x");
  });

  it("maps a displaced section back to logical layers and rejects mixed normal offsets", () => {
    const moved = applyCubeOperation(state, { kind: "display-move", ids, axis: "x", distance: 3 });
    const index = buildCubeCutGeometry(moved);
    const a = line("y", { x: 3.5, y: 0.5, z: 2.5 }, index); const b = line("z", { x: 3.5, y: 2.5, z: 0.5 }, index);
    expect(cubeCutFromLines(moved, ids, a, b).selection).toMatchObject({ axis: "x", after: 0 });
    const mixed = applyCubeOperation(moved, { kind: "display-move", ids: [ids[0]], axis: "x", distance: -3 });
    expect(cubeCutFromLines(mixed, ids, a, b)).toEqual({ selection: null, issue: "displaced" });
  });

  it("includes hidden targets in the confirmed cut and records only one reversible command", () => {
    let session = startCubeRecording(createCubeSession(solid)); const before = JSON.stringify(session);
    const hidden: CubeStructureState = { ...state, hiddenCubeIds: [ids[0]] };
    let draft = chooseCubeCut(hidden, ids, EMPTY_CUBE_CUT, edge());
    draft = chooseCubeCut(hidden, ids, draft, edge(top));
    expect(draft.selection?.ids).toEqual(ids); expect(JSON.stringify(session)).toBe(before);
    expect(chooseCubeCut(hidden, ids, draft, null)).toBe(draft);
    const selection = draft.selection!;
    session = operateCubeSession(session, cubeCutOperation(state, selection.ids, selection.axis, selection.after, selection.side, 2, "piece", "Piece")!);
    expect(session.lesson?.operations).toHaveLength(1);
    expect(cubeStructureMetrics(cubeSessionScene(session))).toEqual(cubeStructureMetrics(state));
    expect(cubeSessionScene(undoCubeSession(session, -1))).toEqual(state);
    expect(cubeSessionScene(undoCubeSession(undoCubeSession(session, -1), 1))).toEqual(cubeSessionScene(session));
  });
});

class Surface extends EventTarget {
  ownerDocument = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
  getBoundingClientRect() { return { ...size, left: 0, top: 0, right: 800, bottom: 600 }; }
}
function bind() {
  const canvas = new Surface(); let draft: CubeCutDraft = EMPTY_CUBE_CUT; let currentState = state;
  const onHover = vi.fn(); const picked: (CubeCutHit | null)[] = [];
  const current = (): CubeCutInteraction => ({ state: currentState, input: "edge", onHover, onPick: (hit) => { picked.push(hit); draft = chooseCubeCut(currentState, ids, draft, hit); } });
  const dispose = bindCubeCutPicking(canvas as unknown as HTMLCanvasElement, current, () => camera());
  const send = (type: string, point: VoxelCoordinate, extra: object = {}) => {
    const p = project(point);
    const event = Object.assign(new Event(type, { cancelable: true }), { clientX: p.x, clientY: p.y, pointerId: 1, button: 0, buttons: type === "pointermove" ? 0 : 1, isPrimary: true, pointerType: "mouse", ...extra });
    Object.defineProperty(event, "target", { value: canvas });
    (type === "pointerdown" || type === "pointerleave" || type === "wheel" ? canvas : canvas.ownerDocument).dispatchEvent(event);
  };
  return { canvas, send, picked, onHover, dispose, draft: () => draft, change: () => { currentState = { ...state }; } };
}

describe("the real cut pointer controller", () => {
  const point = { x: 0.5, y: 1, z: 2.5 };
  it("uses the same candidate for hover/click and waits for the second line", () => {
    const control = bind(); control.send("pointermove", point); control.send("pointerdown", point); control.send("pointerup", point);
    expect(control.onHover).toHaveBeenCalledWith(edge()); expect(control.picked).toEqual([edge()]);
    expect(control.draft().selection).toBeNull(); expect(control.draft().firstLine).toEqual(first);
    control.send("pointerleave", point); expect(control.draft().firstLine).toEqual(first);
    const second = { x: 0.5, y: 2.5, z: 1 };
    control.send("pointermove", second); control.send("pointerdown", second); control.send("pointerup", second);
    expect(control.draft().selection).toMatchObject({ axis: "x", after: 0 });
    control.dispose(); control.send("pointerdown", point); control.send("pointerup", point); expect(control.picked).toHaveLength(2);
  });

  it.each(["drag", "pointercancel", "blur", "wheel", "Escape", "second-touch", "state-change"])("%s does not produce a selection", (action) => {
    const control = bind(); control.send("pointerdown", point);
    if (action === "drag") control.send("pointermove", { ...point, y: 1.4 });
    else if (action === "blur") control.canvas.ownerDocument.defaultView.dispatchEvent(new Event("blur"));
    else if (action === "Escape") control.canvas.ownerDocument.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    else if (action === "state-change") control.change();
    else if (action === "second-touch") control.send("pointerdown", point, { pointerId: 2, isPrimary: false, pointerType: "touch" });
    else control.send(action, point);
    control.send("pointerup", point); expect(control.picked).toHaveLength(0); control.dispose();
  });

  it("wires a cut-only picker without changing shared classroom renderer semantics", () => {
    const source = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8");
    const viewport = readFileSync("src/features/tools/spatial-lab/CubeStructuresViewport.tsx", "utf8");
    expect(source).toContain('onFaceSelect={["orbit", "pan", "move", "cut"].includes(tool) ? undefined');
    expect(source).toContain('tool === "move" || tool === "cut" ? "object" : "orbit"');
    expect(source).toContain('if (operation.kind === "view")');
    expect(source).toContain('data-cube-cut-progress={cutDraft.firstLine ? "second-line" : "first-pick"}');
    expect(source).toContain("m.cutUseScope");
    expect(viewport).toContain("cutInteraction && !moving && <CubeCutPicker");
    expect(Object.keys(cubeStructuresMessages("zh").cutIssues)).toEqual(Object.keys(cubeStructuresMessages("en").cutIssues));
  });
});
