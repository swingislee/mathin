import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrthographicCamera } from "three";
import { bindCubeAxisDrag, type CubeDragPreview, type CubeMoveInteraction } from "@/features/tools/spatial-lab/cube-structures-drag-controller";
import { commitDiceDrag, diceDragState, DICE_DRAG_GRID_ORIGIN, moveDiceByDrag } from "@/features/tools/spatial-lab/dice-drag-adapter";
import { createDiceScene } from "@/features/tools/spatial-lab/dice-teaching-model";

class Surface extends EventTarget {
  style = { cursor: "" };
  ownerDocument = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
  captured = new Set<number>();
  getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}
afterEach(() => vi.unstubAllGlobals());

function setup(snapToGrid: boolean, axis: "x" | "y" = "x") {
  let scene = createDiceScene();
  let state = diceDragState(scene.dice);
  const surface = new Surface(), previews: (CubeDragPreview | null)[] = [], frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const camera = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.01, 100);
  camera.position.set(-1, 0.5, 10); camera.lookAt(-1, 0.5, 0); camera.updateMatrixWorld();
  const commit = vi.fn((operation: Parameters<typeof commitDiceDrag>[1]) => {
    const next = commitDiceDrag(scene, operation);
    if (next) { scene = next; state = diceDragState(scene.dice); }
  });
  const interaction: CubeMoveInteraction = { state, ids: ["dice-1"], scopeIds: scene.dice.map((die) => die.id), axis, kind: "move", snapToGrid,
    gridOrigin: DICE_DRAG_GRID_ORIGIN, isValidOperation: (operation) => moveDiceByDrag(scene.dice, operation) !== null,
    onAxisChange: vi.fn(), onSelect: vi.fn(), onUnavailable: vi.fn(), onCommit: commit };
  const dispose = bindCubeAxisDrag(surface as unknown as HTMLCanvasElement, () => ({ ...interaction, state }), () => camera, (preview) => previews.push(preview));
  const send = (type: string, x = 400, y = 300) => (type === "pointerdown" ? surface : surface.ownerDocument)
    .dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true }));
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(100)); };
  return { scene: () => scene, surface, previews, commit, send, flush, dispose };
}

describe("dice reuse the cube axis-drag controller", () => {
  it.each([false, true])("commits the endpoint once with snap=%s and keeps the other die untouched", (snap) => {
    const drag = setup(snap), other = drag.scene().dice[1];
    drag.send("pointerdown"); drag.send("pointermove", 496); drag.flush();
    expect(drag.previews.at(-1)?.positions.get("dice-1")?.x).toBeCloseTo(snap ? 0 : 0.2);
    expect(drag.commit).not.toHaveBeenCalled();
    drag.send("pointerup", 496);
    expect(drag.commit).toHaveBeenCalledOnce();
    expect(drag.scene().dice[0].position).toEqual({ x: 0, y: 0.5, z: 0 });
    expect(drag.scene().dice[1]).toBe(other); expect(drag.previews.at(-1)).toBeNull();
    expect(drag.surface.captured.size).toBe(0); drag.dispose();
  });

  it("uses half-height as the Y-grid origin and blocks movement below the table", () => {
    const drag = setup(true, "y");
    drag.send("pointerdown"); drag.send("pointermove", 400, 204); drag.flush();
    expect(drag.previews.at(-1)?.positions.get("dice-1")?.y).toBe(1.5);
    expect(drag.previews.at(-1)?.valid).toBe(true);
    drag.send("pointerup", 400, 204); expect(drag.scene().dice[0].position.y).toBe(1.5); drag.dispose();
    const original = createDiceScene();
    expect(commitDiceDrag(original, { kind: "move", ids: ["dice-1"], axis: "y", distance: -1 })).toBeNull();
  });

  it("previews blocked collisions as invalid and leaves the scene unchanged", () => {
    const drag = setup(true), snapshot = JSON.stringify(drag.scene());
    drag.send("pointerdown"); drag.send("pointermove", 560); drag.flush();
    expect(drag.previews.at(-1)?.valid).toBe(false); drag.send("pointerup", 560);
    expect(JSON.stringify(drag.scene())).toBe(snapshot); drag.dispose();
  });

  it.each(["pointercancel", "Escape", "blur", "unmount"])("cancels %s without recording a position or leaving a preview", (action) => {
    const drag = setup(false), before = JSON.stringify(drag.scene());
    drag.send("pointerdown"); drag.send("pointermove", 496); drag.flush();
    if (action === "Escape") drag.surface.ownerDocument.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    else if (action === "blur") drag.surface.ownerDocument.defaultView.dispatchEvent(new Event("blur"));
    else if (action === "unmount") drag.dispose();
    else drag.send(action, 496);
    expect(drag.commit).not.toHaveBeenCalled(); expect(drag.previews.at(-1)).toBeNull();
    expect(JSON.stringify(drag.scene())).toBe(before); expect(drag.surface.captured.size).toBe(0); drag.dispose();
  });

  it("preserves face displacement, marks, pips and true orientation during manual placement", () => {
    const scene = createDiceScene();
    scene.dice[0].hidden = ["y-"]; scene.dice[0].offsets = { "y-": 0.9 }; scene.dice[0].surfaces = { "x+": { opacity: 0.35 } };
    scene.puzzle = { scope: "each", target: 7, revealed: false };
    const next = commitDiceDrag(scene, { kind: "move", ids: ["dice-1"], axis: "z", distance: 1 })!;
    for (const key of ["rotation", "hidden", "offsets", "surfaces"] as const) expect(next.dice[0][key]).toBe(scene.dice[0][key]);
    expect(next.puzzle).toBeNull(); expect(next.trail).toBe(scene.trail);
  });

  it("reuses shared handles and the magnet and directly commits a manual drag", () => {
    const workspace = readFileSync("src/features/tools/spatial-lab/DiceTeachingWorkspace.tsx", "utf8");
    const handler = workspace.slice(workspace.indexOf("const dragCommit ="), workspace.indexOf("const add ="));
    expect(handler).toContain("commitDiceDrag(scene, operation)"); expect(handler).toContain("commit(next)");
    expect(handler).not.toContain("animate("); expect(handler).not.toContain("playback.start");
    expect(workspace).toContain("<SpatialAxisSnapButton"); expect(workspace).toContain("const snap = useSpatialAxisSnap()");
    const canvas = readFileSync("src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "utf8");
    expect(canvas).toContain("<CubeMoveHandles"); expect(canvas).toContain("snapToGrid: props.snap");
    expect(canvas).toContain("axisSnapEnabled={props.snap}"); expect(canvas).toContain("onTransitionStateChange={ignoreCameraTransition}");
    expect(canvas).not.toContain("new Plane("); expect(canvas).not.toContain("setPointerCapture(");
  });
});
