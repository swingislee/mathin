import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrthographicCamera, Ray, Vector3 } from "three";
import { CUBE_COLORS, CUBE_GROUP_COLORS, CUBE_SELECTION_COLOR, buildCubeStructureRenderModel, createCubeHistory, cubeDisplayPosition, cubeStructureMetrics } from "@/features/tools/spatial-lab/cube-structures-contract";
import { cubeDragDistance, cubeDragHit, cubeDragOperation, cubeDragPositions, cubeDragProjection } from "@/features/tools/spatial-lab/cube-structures-drag";
import { bindCubeAxisDrag, type CubeDragPreview, type CubeMoveInteraction } from "@/features/tools/spatial-lab/cube-structures-drag-controller";
import { cubeCutFromFace } from "@/features/tools/spatial-lab/cube-structures-cut-interaction";
import { createCubeSession, cubeSessionScene, operateCubeSession, startCubeRecording, undoCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";

const origin = { x: 0, y: 0, z: 0 };
const size = { width: 800, height: 600 };
function camera(position = [0, 0, 10], up = [0, 1, 0]) {
  const result = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.01, 100);
  result.position.set(position[0], position[1], position[2]); result.up.set(up[0], up[1], up[2]);
  result.lookAt(0, 0, 0); result.updateMatrixWorld(); return result;
}

class Surface extends EventTarget {
  style = { cursor: "" };
  ownerDocument = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
  captured = new Set<number>();
  getBoundingClientRect() { return { ...size, left: 0, top: 0 }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}
afterEach(() => vi.unstubAllGlobals());
function setup(kind: CubeMoveInteraction["kind"] = "move", positions = [origin], targetIds = ["cube-1"], snapToGrid = false) {
  let session = startCubeRecording(createCubeSession(positions));
  const surface = new Surface();
  const previews: (CubeDragPreview | null)[] = [];
  const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  let state = cubeSessionScene(session);
  const interaction: CubeMoveInteraction = { state, ids: targetIds, scopeIds: state.cubes.map((cube) => cube.id), axis: "x", kind, snapToGrid,
    onAxisChange: vi.fn(), onSelect: vi.fn(), onUnavailable: vi.fn(), onCommit: (operation) => { session = operateCubeSession(session, operation); state = cubeSessionScene(session); } };
  const dispose = bindCubeAxisDrag(surface as unknown as HTMLCanvasElement, () => ({ ...interaction, state, snapToGrid }), () => camera(), (preview) => previews.push(preview));
  const send = (type: string, x = 400, y = 300, pointerId = 1) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, pointerId, button: 0, isPrimary: true });
    (type === "pointerdown" || type === "lostpointercapture" ? surface : surface.ownerDocument).dispatchEvent(event);
    return event;
  };
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(100); };
  return { session: () => session, state: () => state, surface, previews, interaction, dispose, send, flush, setSnapToGrid: (value: boolean) => { snapToGrid = value; } };
}

describe("axis dragging uses camera projection and one semantic release", () => {
  it("permits continuous precise-axis previews with an exact endpoint, and cancels when disabled", () => {
    const drag = setup("move", [origin], ["cube-1"], true);
    Object.assign(drag.interaction, { continuousPreview: true });
    drag.send("pointerdown"); drag.send("pointermove", 496); drag.flush();
    expect(drag.previews.at(-1)?.positions.get("cube-1")?.x).toBeCloseTo(1.2);
    expect(drag.previews.at(-1)?.distance).toBe(1);
    Object.assign(drag.interaction, { enabled: false }); drag.send("pointerup", 496);
    expect(drag.session().lesson?.operations).toHaveLength(0); expect(drag.previews.at(-1)).toBeNull(); drag.dispose();
  });
  it("direct dragging chooses the visible axis from the gesture, without a prior axis click", () => {
    const drag = setup(); Object.assign(drag.interaction, { bodyAxis: "gesture", showHandles: false });
    drag.send("pointerdown"); drag.send("pointermove", 402, 204); drag.flush();
    expect(drag.interaction.onAxisChange).toHaveBeenLastCalledWith("y");
    expect(drag.previews.at(-1)?.positions.get("cube-1")?.y).toBeCloseTo(1.2);
    drag.send("pointerup", 402, 204);
    expect(drag.session().lesson?.operations).toEqual([{ kind: "move", axis: "y", ids: ["cube-1"], distance: 1 }]); drag.dispose();
  });

  it("dragging another rigid part does not publish a selection before its movement", () => {
    const drag = setup("move", [origin, { x: 2, y: 0, z: 0 }, { x: 2, y: 1, z: 0 }]);
    Object.assign(drag.interaction, { bodyAxis: "gesture", showHandles: false, idsForHit: () => ["cube-2", "cube-3"] });
    drag.send("pointerdown", 560, 300);
    expect(drag.interaction.onSelect).not.toHaveBeenCalled();
    drag.send("pointermove", 640, 300); drag.flush(); drag.send("pointerup", 640, 300);
    expect(drag.interaction.onSelect).not.toHaveBeenCalled();
    expect(drag.session().lesson?.operations).toEqual([{ kind: "move", axis: "x", ids: ["cube-2", "cube-3"], distance: 1 }]); drag.dispose();
  });

  it("projects XYZ in front, side and top views, including zoom", () => {
    const front = camera();
    expect(cubeDragProjection(origin, "x", front, size)).toEqual({ x: 80, y: 0 });
    expect(cubeDragProjection(origin, "z", front, size)).toBeNull();
    expect(cubeDragProjection(origin, "z", camera([10, 0, 0]), size)?.x).toBeCloseTo(-80);
    expect(cubeDragProjection(origin, "z", camera([0, 10, 0], [0, 0, -1]), size)?.y).toBeCloseTo(80);
    front.zoom = 2; front.updateProjectionMatrix();
    expect(cubeDragProjection(origin, "x", front, size)?.x).toBeCloseTo(160);
    expect(cubeDragDistance({ x: 160, y: 90 }, { x: 80, y: 0 })).toBe(2);
  });

  it("snaps symmetrically to whole or half units and leaves zero gestures unrecorded", () => {
    expect(cubeDragOperation("move", ["cube-1"], "x", -1.5)?.distance).toBe(-2);
    expect(cubeDragOperation("display-move", ["cube-1"], "z", -0.25)?.distance).toBe(-0.5);
    expect(cubeDragOperation("move", ["cube-1"], "x", 0.3)).toBeNull();
    expect(cubeDragOperation("move", ["cube-1"], "x", NaN)).toBeNull();
  });

  it("previews continuously, captures the pointer and records exactly once on release", () => {
    const drag = setup(); const before = JSON.stringify(drag.session());
    expect(drag.send("pointerdown").defaultPrevented).toBe(true);
    expect(drag.surface.hasPointerCapture(1)).toBe(true);
    drag.send("pointermove", 448); drag.send("pointermove", 496); drag.flush();
    expect(drag.previews).toHaveLength(1);
    expect(drag.previews[0]?.positions.get("cube-1")?.x).toBeCloseTo(1.2);
    expect(JSON.stringify(drag.session())).toBe(before);
    drag.send("pointerup", 496);
    expect(drag.session().lesson?.operations).toEqual([{ kind: "move", axis: "x", ids: ["cube-1"], distance: 1 }]);
    expect(drag.state().cubes[0].position.x).toBe(1);
    expect(drag.previews.at(-1)).toBeNull(); expect(drag.surface.captured.size).toBe(0);
    drag.send("pointerup", 496); expect(drag.session().lesson?.operations).toHaveLength(1);
    drag.dispose();
  });

  it.each([-1, 1])("previews and commits the same cell with snapping enabled in direction %s", (sign) => {
    const drag = setup("move", [origin], ["cube-1"], true);
    drag.send("pointerdown"); drag.send("pointermove", 400 + sign * 96); drag.flush();
    expect(drag.previews.at(-1)?.positions.get("cube-1")?.x).toBe(sign);
    expect(drag.previews.at(-1)?.distance).toBe(sign);
    expect(drag.session().lesson?.operations).toHaveLength(0);
    drag.send("pointerup", 400 + sign * 96);
    expect(drag.state().cubes[0].position.x).toBe(sign);
    expect(drag.session().lesson?.operations).toEqual([{ kind: "move", ids: ["cube-1"], axis: "x", distance: sign }]);
    expect(cubeSessionScene(undoCubeSession(drag.session(), -1)).cubes[0].position).toEqual(origin);
    drag.dispose();
  });

  it("snaps at the cell boundary and leaves a return to the starting cell unrecorded", () => {
    const drag = setup("move", [origin], ["cube-1"], true); drag.send("pointerdown");
    drag.send("pointermove", 432); drag.flush();
    expect(drag.previews.at(-1)?.positions.get("cube-1")?.x).toBe(0);
    drag.send("pointermove", 448); drag.flush();
    expect(drag.previews.at(-1)?.positions.get("cube-1")?.x).toBe(1);
    drag.send("pointermove", 432); drag.flush(); drag.send("pointerup", 432);
    expect(drag.session().lesson?.operations).toHaveLength(0);
    expect(drag.state().cubes[0].position).toEqual(origin); drag.dispose();
  });

  it.each(["x", "y", "z"] as const)("aligns displaced display anchors to actual cells on %s", (axis) => {
    expect(cubeDragOperation("display-move", ["cube-1"], axis, 1.2, 0.5)?.distance).toBe(1.5);
    expect(cubeDragOperation("display-move", ["cube-1"], axis, -1.2, -0.5)?.distance).toBe(-1.5);
    expect(cubeDragOperation("display-move", ["cube-1"], axis, 0.5, -2)?.distance).toBe(1);
    expect(cubeDragOperation("display-move", ["cube-1"], axis, -0.5, 2)?.distance).toBe(-1);
    expect(cubeDragOperation("display-move", ["cube-1"], axis, 0, 0.5)).toBeNull();
  });

  it("aligns an already half-displaced group, preserves geometry, and can disable snapping again", () => {
    const positions = [origin, { x: 0, y: 1, z: 0 }];
    const drag = setup("display-move", positions, ["cube-1", "cube-2"]);
    drag.send("pointerdown", 390, 310); drag.send("pointermove", 430, 310); drag.send("pointerup", 430, 310);
    expect(drag.state().cubes.map(cubeDisplayPosition).map((p) => p.x)).toEqual([0.5, 0.5]);
    drag.setSnapToGrid(true);
    drag.send("pointerdown", 430, 310); drag.send("pointermove", 526, 310); drag.flush();
    expect(["cube-1", "cube-2"].map((id) => drag.previews.at(-1)?.positions.get(id)?.x)).toEqual([2, 2]);
    drag.send("pointerup", 526, 310);
    expect(drag.state().cubes.map(cubeDisplayPosition)).toEqual([{ x: 2, y: 0, z: 0 }, { x: 2, y: 1, z: 0 }]);
    expect(drag.state().cubes.map((cube) => cube.position)).toEqual(positions);
    expect(drag.session().lesson?.operations).toHaveLength(2);
    expect(drag.session().lesson?.operations[1]).toMatchObject({ kind: "display-move", ids: ["cube-1", "cube-2"], distance: 1.5 });
    drag.setSnapToGrid(false);
    drag.send("pointerdown", 550, 310); drag.send("pointermove", 566, 310); drag.flush();
    expect(drag.previews.at(-1)?.positions.get("cube-1")?.x).toBeCloseTo(2.2);
    drag.send("pointercancel", 566, 310);
    expect(drag.session().lesson?.operations).toHaveLength(2); drag.dispose();
  });

  it.each(["pointercancel", "lostpointercapture", "Escape", "blur", "unmount"])("%s discards the preview without changing history", (action) => {
    const drag = setup(); drag.send("pointerdown"); drag.send("pointermove", 496); drag.flush();
    if (action === "Escape") drag.surface.ownerDocument.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    else if (action === "blur") drag.surface.ownerDocument.defaultView.dispatchEvent(new Event("blur"));
    else if (action === "unmount") drag.dispose();
    else drag.send(action, 496);
    expect(drag.session().lesson?.operations).toHaveLength(0);
    expect(drag.previews.at(-1)).toBeNull(); expect(drag.surface.captured.size).toBe(0);
    drag.dispose();
  });

  it("click selects without moving; dragging a handle chooses that axis", () => {
    const drag = setup(); drag.send("pointerdown"); drag.send("pointerup");
    expect(drag.interaction.onSelect).toHaveBeenCalledWith("cube-1");
    expect(drag.session().lesson?.operations).toHaveLength(0);
    drag.send("pointerdown", 400, 240); drag.send("pointermove", 400, 160); drag.send("pointerup", 400, 160);
    expect(drag.interaction.onAxisChange).toHaveBeenCalledWith("y");
    expect(drag.state().cubes[0].position.y).toBe(1); drag.dispose();
  });

  it.each([false, true])("collision previews do not record a move or change other cubes (snap %s)", (snap) => {
    const drag = setup("move", [origin, { x: 1, y: 0, z: 0 }], ["cube-1"], snap);
    drag.send("pointerdown"); drag.send("pointermove", 464); drag.flush();
    expect(drag.previews.at(-1)?.valid).toBe(false);
    expect(drag.previews.at(-1)?.positions.get("cube-1")?.x).toBeCloseTo(snap ? 1 : 0.8);
    drag.send("pointerup", 464);
    expect(drag.session().lesson?.operations).toHaveLength(0);
    expect(drag.state().cubes.map((cube) => cube.position)).toEqual([origin, { x: 1, y: 0, z: 0 }]); drag.dispose();
  });

  it("moves a group together with display-only half steps", () => {
    const drag = setup("display-move", [origin, { x: 0, y: 1, z: 0 }], ["cube-1", "cube-2"]);
    drag.send("pointerdown", 390, 310); drag.send("pointermove", 430, 310); drag.send("pointerup", 430, 310);
    expect(drag.session().lesson?.operations[0]).toMatchObject({ kind: "display-move", distance: 0.5, ids: ["cube-1", "cube-2"] });
    expect(drag.state().cubes.map((cube) => cube.position)).toEqual([origin, { x: 0, y: 1, z: 0 }]);
    expect(drag.state().cubes.map(cubeDisplayPosition).map((p) => p.x)).toEqual([0.5, 0.5]);
    drag.dispose();
  });

  it("picks the visible front cube, and preview offsets retain the exact logical geometry", () => {
    const state = createCubeHistory([origin, { x: 0, y: 0, z: 1 }]).initial;
    const ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    expect(cubeDragHit(state, ray)).toBe("cube-2");
    expect(cubeDragHit({ ...state, hiddenCubeIds: ["cube-2"] }, ray)).toBe("cube-1");
    const preview = cubeDragPositions(state, ["cube-1"], "y", 0.127);
    expect(preview.get("cube-1")?.y).toBe(0.127); expect(preview.get("cube-2")?.y).toBe(0);
    expect(state.cubes[0].position).toEqual(origin);
  });
});

describe("cut edge selection and independent selection/group colors", () => {
  const state = createCubeHistory(Array.from({ length: 27 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) % 3, z: Math.floor(i / 9) }))).initial;
  const ids = state.cubes.map((cube) => cube.id);
  const face = { cell: { x: 1, y: 1, z: 1 }, direction: "z+" as const };

  it("face selection accepts the complete picked layer surface, including corners", () => {
    expect(cubeCutFromFace(state, ids, face, { x: 1, y: 1, z: 1.5 })?.axis).toBe("z");
    expect(cubeCutFromFace(state, ids, face, { x: 1.48, y: 1, z: 1.5 })?.axis).toBe("z");
    expect(cubeCutFromFace(state, ids, face, { x: 1, y: 0.51, z: 1.5 })?.axis).toBe("z");
    expect(cubeCutFromFace(state, ids, face, { x: 1, y: 1, z: 2.5 })).toBeNull();
  });

  it("selection stays yellow in every group; group recoloring preserves membership, order and authored colors", () => {
    expect(CUBE_GROUP_COLORS).not.toContain(CUBE_SELECTION_COLOR);
    let session = startCubeRecording(createCubeSession([origin, { x: 1, y: 0, z: 0 }]));
    session = operateCubeSession(session, { kind: "group", id: "a", name: "A", ids: ["cube-1"] });
    session = operateCubeSession(session, { kind: "group", id: "b", name: "B", ids: ["cube-2"] });
    session = operateCubeSession(session, { kind: "paint", faces: [{ id: "cube-1", direction: "y+" }], color: CUBE_COLORS[1] });
    const before = cubeSessionScene(session);
    session = operateCubeSession(session, { kind: "group", id: "a", name: "A", ids: ["cube-1"], color: CUBE_COLORS[4] });
    const after = cubeSessionScene(session);
    expect(after.groups.map((group) => group.id)).toEqual(["a", "b"]);
    expect(after.groups[0]).toEqual({ ...before.groups[0], color: CUBE_COLORS[4] });
    expect(after.cubes).toEqual(before.cubes); expect(cubeStructureMetrics(after)).toEqual(cubeStructureMetrics(before));
    expect(buildCubeStructureRenderModel(after, ["cube-1"], "Cubes", "a").cells[0].emphasis?.color).toBe(CUBE_SELECTION_COLOR);
    expect(buildCubeStructureRenderModel(after, [], "Cubes", "a").cells[0].emphasis?.color).toBe(CUBE_COLORS[4]);
    expect(cubeSessionScene(undoCubeSession(session, -1))).toEqual(before);
    expect(cubeSessionScene(undoCubeSession(undoCubeSession(session, -1), 1))).toEqual(after);
  });

  it("wires object navigation and preview handoff independently of semantic state", () => {
    const root = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.tsx", "utf8");
    const motion = readFileSync("src/features/tools/spatial-lab/useCubeDisplayMotion.ts", "utf8");
    expect(root).toContain('tool === "move" || tool === "cut" ? "object" : "orbit"');
    expect(root).not.toContain("cutInput");
    expect(root).toContain("if (commit(operation)) setSelected(operation.ids)");
    expect(root).toContain('spatialDirectManipulation(tool) && hasTool("move")');
    expect(root).toContain("snapToGrid: snap");
    expect(root).toContain("enableAxisSnap: m.enableCellSnap");
    expect(motion).toContain("current.current = next; setFrame(next)");
  });
});
