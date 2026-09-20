// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { OrthographicCamera, Quaternion, Vector3 } from "three";
import { bindSpatialObjectGestures, isSpatialCameraHandoff, startSpatialRotationGrip, type SpatialGestureTarget, type SpatialObjectInteraction, type SpatialObjectPreview } from "@/features/tools/spatial-interaction/object-gesture-controller";
import { spatialMoveDelta, spatialMoveProjection } from "@/features/tools/spatial-interaction/object-gesture-math";
import { spatialArcball, spatialArcballRotation } from "@/features/tools/spatial-interaction/arcball";
import { somaGestureLanding } from "@/features/tools/soma-cube/manipulation";
import { createSomaInitial, somaAnchorIndex, somaOrientAroundAnchor, somaRotate, somaRotationPivot } from "@/features/tools/soma-cube/model";
import { somaRigidPoses } from "@/features/tools/soma-cube/motion";
import { SOMA_IDS, SOMA_ROTATIONS, somaDefinition, somaTurn } from "@/features/tools/soma-cube/pieces";

vi.mock("three", async () => {
  const { createRequire } = await import("node:module"); return createRequire(import.meta.url)("three");
});
const viewport = { left: 20, top: 10, width: 800, height: 600 };
const point = { x: 420, y: 310 }, origin = { x: 0, y: 0, z: 0 };
const require = createRequire(import.meta.url);
// 使用 Drei 实际依赖的相机控制器验证双指交接，不引入第二套浏览器运行环境。
const { OrbitControls } = createRequire(require.resolve("@react-three/drei"))("three-stdlib");
function camera(position = [7, 8, 10]) {
  const c = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.1, 100);
  c.position.set(...position as [number, number, number]); c.lookAt(0, 0, 0); c.updateMatrixWorld(); return c;
}
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number; readonly pointerType: string; readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? "mouse"; this.isPrimary = init.isPrimary ?? true;
  }
}
const disposers: (() => void)[] = [];
beforeEach(() => vi.stubGlobal("PointerEvent", TestPointerEvent));
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); vi.unstubAllGlobals(); });
function setup() {
  const canvas = document.createElement("canvas"); document.body.append(canvas);
  canvas.getBoundingClientRect = () => viewport as DOMRect;
  const captured = new Set<number>();
  canvas.setPointerCapture = (id) => { captured.add(id); };
  canvas.releasePointerCapture = (id) => { captured.delete(id); };
  canvas.hasPointerCapture = (id) => captured.has(id);
  const frames = new Map<number, FrameRequestCallback>(); let serial = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const target: SpatialGestureTarget = { pose: { id: "piece", position: origin, quaternion: [0, 0, 0, 1] }, pivot: origin, grabPoint: origin };
  const previews: (SpatialObjectPreview | null)[] = [], apply = vi.fn(() => true);
  const interaction: SpatialObjectInteraction = {
    key: {}, enabled: true, plane: "table", selected: target, pick: () => target,
    resolve: vi.fn((_target, pose) => ({ pose: { ...pose, position: { x: Math.round(pose.position.x), y: Math.round(pose.position.y), z: Math.round(pose.position.z) } }, valid: true, apply })),
    onPreview: (frame) => previews.push(frame), onSelect: vi.fn(), onDragging: vi.fn(), onUnavailable: vi.fn(),
  };
  const c = camera(); const dispose = bindSpatialObjectGestures(canvas, () => interaction, () => c);
  disposers.push(() => { dispose(); canvas.remove(); });
  const send = (type: string, init: PointerEventInit = {}) => {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0, buttons: 1, ...init });
    canvas.dispatchEvent(event); return event;
  };
  const flush = (time: number) => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(time)); };
  return { canvas, target, previews, interaction, apply, send, flush, dispose, camera: c, captured };
}

describe("continuous plane and camera-relative object gestures", () => {
  it.each([ ["table", "y", [7, 8, 10]], ["xy", "z", [0, 0, 10]], ["yz", "x", [10, 0, 0]] ] as const)("%s keeps %s fixed and the grab point under the pointer", (mode, fixedAxis, position) => {
    const c = camera([...position]), anchor = { x: 1.25, y: 2.5, z: -0.75 };
    const projection = spatialMoveProjection(point, anchor, mode, c, viewport)!;
    const next = { x: point.x + 63, y: point.y + 35 }, delta = spatialMoveDelta(projection, next, c, viewport)!;
    expect(delta[fixedAxis]).toBeCloseTo(0);
    for (const axis of ["x", "y", "z"] as const) if (axis !== fixedAxis) expect(Math.abs(delta[axis])).toBeGreaterThan(0.1);
    const projected = projection.start.clone().add(new Vector3(delta.x, delta.y, delta.z)).project(c);
    expect(viewport.left + (projected.x + 1) * viewport.width / 2).toBeCloseTo(next.x);
    expect(viewport.top + (1 - projected.y) * viewport.height / 2).toBeCloseTo(next.y);
    expect(projection.start[fixedAxis]).toBeCloseTo(anchor[fixedAxis]);
  });
  it.each(["mouse", "touch"])("%s locks the chosen plane for the entire gesture", (pointerType) => {
    const g = setup(); g.interaction.plane = "xy";
    g.send("pointerdown", { pointerType });
    g.interaction.plane = "yz";
    g.send("pointermove", { pointerType, clientX: point.x + 65, clientY: point.y - 41 });
    expect(g.previews.at(-1)!.pose.position.z).toBeCloseTo(0);
    expect(Math.abs(g.previews.at(-1)!.pose.position.y)).toBeGreaterThan(0.1);
    g.send("pointerup", { pointerType, clientX: point.x + 65, clientY: point.y - 41 });
    expect(g.apply).toHaveBeenCalledTimes(1);
  });
  it("keeps edge-on XY and YZ explicit instead of changing plane silently", () => {
    expect(spatialMoveProjection(point, origin, "xy", camera([10, 0, 0]), viewport)).toBeNull();
    expect(spatialMoveProjection(point, origin, "yz", camera([0, 0, 10]), viewport)).toBeNull();
  });
  it("keeps the grab point under the pointer on the table, with two axes free and height fixed", () => {
    const c = camera(), projection = spatialMoveProjection(point, origin, "table", c, viewport)!;
    const next = { x: point.x + 63, y: point.y + 35 }, delta = spatialMoveDelta(projection, next, c, viewport)!;
    expect(delta.y).toBeCloseTo(0); expect(Math.abs(delta.x)).toBeGreaterThan(0.1); expect(Math.abs(delta.z)).toBeGreaterThan(0.1);
    const projected = projection.start.clone().add(new Vector3(delta.x, delta.y, delta.z)).project(c);
    expect(viewport.left + (projected.x + 1) * viewport.width / 2).toBeCloseTo(next.x);
    expect(viewport.top + (1 - projected.y) * viewport.height / 2).toBeCloseTo(next.y);
    expect(spatialMoveDelta(projection, point, c, viewport)).toEqual(origin);
  });
  it.each([[0, 0, 10], [10, 4, -3]])("screen-plane dragging follows pixels at a zoomed view %s", (...position) => {
    const c = camera(position); c.zoom = 2; c.updateProjectionMatrix();
    const projection = spatialMoveProjection(point, origin, "screen", c, viewport)!;
    const delta = spatialMoveDelta(projection, { x: point.x + 80, y: point.y + 40 }, c, viewport)!;
    const screen = projection.start.clone().add(new Vector3(delta.x, delta.y, delta.z)).project(c);
    expect(screen.x * viewport.width / 2).toBeCloseTo(80); expect(-screen.y * viewport.height / 2).toBeCloseTo(40);
  });
  it("does not silently change movement rules when the table is edge-on", () => {
    expect(spatialMoveProjection(point, origin, "table", camera([0, 0, 10]), viewport)).toBeNull();
    expect(spatialMoveProjection(point, origin, "screen", camera([0, 0, 10]), viewport)).not.toBeNull();
  });
  it("shows unsnapped positions, commits once, and animates only the short landing adjustment", () => {
    const g = setup(); g.send("pointerdown"); g.send("pointermove", { clientX: point.x + 63, clientY: point.y - 47 });
    const preview = g.previews.at(-1)!;
    expect(preview.pose.position).not.toEqual(preview.landing.position); expect(g.apply).not.toHaveBeenCalled();
    expect(g.captured.has(1)).toBe(true);
    g.send("pointerup", { clientX: point.x + 63, clientY: point.y - 47 }); expect(g.apply).toHaveBeenCalledTimes(1);
    g.flush(100); expect(g.previews.at(-1)?.pose).toEqual(preview.pose);
    g.flush(180); expect(g.previews.at(-1)?.phase).toBe("settle"); expect(g.previews.at(-1)?.pose.position).not.toEqual(preview.pose.position);
    g.flush(260); expect(g.previews.at(-1)).toBeNull(); expect(g.interaction.onDragging).toHaveBeenLastCalledWith(false);
    g.send("pointerup"); expect(g.apply).toHaveBeenCalledTimes(1); expect(g.captured.size).toBe(0);
  });
  it.each(["shift", "grip", "mode"])("%s rotation shares continuous preview and a fixed pivot", (kind) => {
    const g = setup(); g.interaction.rotate = kind === "mode";
    if (kind === "grip") startSpatialRotationGrip(g.canvas, new PointerEvent("pointerdown", { clientX: point.x, clientY: point.y, pointerType: "touch" }));
    else g.send("pointerdown", { shiftKey: kind === "shift" });
    g.send("pointermove", { clientX: point.x + 60, clientY: point.y + 25 });
    expect(g.interaction.resolve).toHaveBeenLastCalledWith(g.target, expect.anything(), "rotate");
    expect(g.previews.at(-1)?.pose.quaternion).not.toEqual([0, 0, 0, 1]); expect(g.apply).not.toHaveBeenCalled();
    g.send("pointerup", { clientX: point.x + 60, clientY: point.y + 25 }); expect(g.apply).toHaveBeenCalledTimes(1);
  });
  it("passes blank and right drags to the camera and only selects on a tap", () => {
    const g = setup(); g.interaction.pick = () => null;
    expect(g.send("pointerdown").defaultPrevented).toBe(false);
    g.interaction.pick = () => g.target; expect(g.send("pointerdown", { button: 2 }).defaultPrevented).toBe(false);
    g.send("pointerdown"); g.send("pointerup"); expect(g.interaction.onSelect).toHaveBeenCalledWith("piece"); expect(g.apply).not.toHaveBeenCalled();
  });
  it("releases a free endpoint immediately with one commit, then allows blank-space orbit", () => {
    const g = setup(); g.interaction.rotate = true;
    g.interaction.resolve = (_target, pose) => ({ pose, valid: true, apply: g.apply });
    g.send("pointerdown"); g.send("pointermove", { clientX: point.x + 45, clientY: point.y + 12 });
    const preview = g.previews.at(-1)!; expect(preview.arcball).toBeDefined();
    g.send("pointerup", { clientX: point.x + 45, clientY: point.y + 12 });
    expect(g.apply).toHaveBeenCalledTimes(1); expect(g.previews.at(-1)).toBeNull();
    expect(g.interaction.onDragging).toHaveBeenLastCalledWith(false);
    g.interaction.pick = () => null;
    expect(g.send("pointerdown").defaultPrevented).toBe(false);
  });
  it.each(["mouse", "touch"])("%s rotation previews a nearby grid landing, then smoothly snaps only on release", (pointerType) => {
    const g = setup(), snapshot = createSomaInitial(); snapshot.pieces = [snapshot.pieces[0]];
    const piece = snapshot.pieces[0], pivot = somaRotationPivot(piece, true);
    Object.assign(g.target, { pose: somaRigidPoses([piece])[0], pivot, grabPoint: pivot });
    g.camera.position.set(pivot.x, pivot.y, pivot.z + 10); g.camera.lookAt(pivot.x, pivot.y, pivot.z); g.camera.updateMatrixWorld();
    g.interaction.rotate = true;
    g.interaction.resolve = (_target, pose) => ({ ...somaGestureLanding(snapshot, piece.id, pose, "rotate", true), apply: g.apply });
    const ball = spatialArcball(pivot, 1, g.camera, viewport);
    const start = { clientX: ball.center.x, clientY: ball.center.y, pointerType };
    const end = { ...start, clientX: ball.center.x + ball.radius * Math.sin(40 * Math.PI / 180) };
    g.send("pointerdown", start); g.send("pointermove", end);
    const preview = g.previews.at(-1)!;
    expect(preview.snapped).toBe(true); expect(g.apply).not.toHaveBeenCalled();
    const goal = new Quaternion(...preview.landing.quaternion), free = new Quaternion(...preview.pose.quaternion);
    expect(free.angleTo(goal)).toBeCloseTo(10 * Math.PI / 180);
    g.send("pointerup", end); expect(g.apply).toHaveBeenCalledTimes(1);
    g.flush(100); expect(g.previews.at(-1)?.pose).toEqual(preview.pose);
    g.flush(180); expect(g.previews.at(-1)?.phase).toBe("settle");
    expect(new Quaternion(...g.previews.at(-1)!.pose.quaternion).angleTo(goal)).toBeCloseTo(5 * Math.PI / 180);
    g.flush(260); expect(g.previews.at(-1)).toBeNull(); expect(g.interaction.onDragging).toHaveBeenLastCalledWith(false);
    g.send("pointerup", end); expect(g.apply).toHaveBeenCalledTimes(1);
    g.interaction.pick = () => null; expect(g.send("pointerdown").defaultPrevented).toBe(false);
  });
  it("hands both initial touches to the camera before movement, without moving or selecting an object", () => {
    const g = setup(), cameraDown: { id: number; replay: boolean }[] = [];
    g.canvas.addEventListener("pointerdown", (event) => cameraDown.push({ id: event.pointerId, replay: isSpatialCameraHandoff(event) }));
    g.send("pointerdown", { pointerType: "touch" }); g.send("pointermove", { clientX: point.x + 5, pointerType: "touch" });
    expect(g.previews).toHaveLength(0);
    g.send("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false });
    expect(cameraDown).toEqual([{ id: 1, replay: true }, { id: 2, replay: false }]);
    g.send("pointerup", { pointerType: "touch" }); g.send("pointerup", { pointerId: 2, pointerType: "touch" });
    expect(g.apply).not.toHaveBeenCalled(); expect(g.interaction.onSelect).not.toHaveBeenCalled();
    expect(g.send("pointerdown").defaultPrevented).toBe(true);
  });
  it("keeps an active touch drag owned by its first finger", () => {
    const g = setup(); g.send("pointerdown", { pointerType: "touch" }); g.send("pointermove", { clientX: point.x + 40, pointerType: "touch" });
    expect(g.send("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false }).defaultPrevented).toBe(true);
    g.send("pointerup", { pointerId: 2, pointerType: "touch" }); expect(g.apply).not.toHaveBeenCalled();
    g.send("pointerup", { clientX: point.x + 40, pointerType: "touch" }); expect(g.apply).toHaveBeenCalledTimes(1);
  });
  it("the actual OrbitControls receives a usable pinch and can orbit empty space afterwards", () => {
    const g = setup();
    Object.defineProperties(g.canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const orbit = new OrbitControls(g.camera, g.canvas); orbit.enableDamping = false; disposers.push(() => orbit.dispose());
    const before = g.camera.quaternion.clone();
    g.send("pointerdown", { pointerType: "touch" });
    g.send("pointerdown", { pointerType: "touch", pointerId: 2, isPrimary: false, clientX: point.x + 100 });
    g.send("pointermove", { pointerType: "touch", pointerId: 2, isPrimary: false, clientX: point.x + 150 });
    expect(g.camera.zoom).toBeGreaterThan(1); expect(g.camera.quaternion.angleTo(before)).toBeLessThan(1e-7);
    g.send("pointerup", { pointerType: "touch" }); g.send("pointerup", { pointerType: "touch", pointerId: 2, isPrimary: false });
    g.interaction.pick = () => null;
    g.send("pointerdown"); g.send("pointermove", { clientX: point.x + 90 }); g.send("pointerup", { clientX: point.x + 90 });
    expect(g.camera.quaternion.angleTo(before)).toBeGreaterThan(0.1); expect(g.apply).not.toHaveBeenCalled();
  });
  it.each(["pointercancel", "lostpointercapture", "Escape", "blur", "authority", "unmount"])("%s cancels without a commit", (reason) => {
    const g = setup(); g.send("pointerdown"); g.send("pointermove", { clientX: point.x + 50 });
    if (reason === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    else if (reason === "blur") window.dispatchEvent(new Event("blur"));
    else if (reason === "authority") { g.interaction.key = {}; g.send("pointermove", { clientX: point.x + 55 }); }
    else if (reason === "unmount") g.dispose(); else g.send(reason);
    g.flush(0); g.flush(160); expect(g.apply).not.toHaveBeenCalled(); expect(g.previews.at(-1)).toBeNull(); expect(g.captured.size).toBe(0);
  });
  it("animates an invalid landing back without publishing it", () => {
    const g = setup(); g.interaction.resolve = (_target, pose) => ({ pose, valid: false, apply: g.apply });
    g.send("pointerdown"); g.send("pointerup", { clientX: point.x + 50 });
    expect(g.apply).not.toHaveBeenCalled(); expect(g.interaction.onUnavailable).toHaveBeenCalledWith("blocked");
    g.flush(0); g.flush(80); expect(g.previews.at(-1)?.landing).toEqual(g.target.pose); g.flush(160); expect(g.previews.at(-1)).toBeNull();
  });
});

describe("Soma gesture landing preserves exact mathematical state", () => {
  it("anchors all seven pieces across all 24 orientations, with reversible quarter turns", () => {
    for (const id of SOMA_IDS) for (let orientation = 0; orientation < 24; orientation++) for (const axis of ["x", "y", "z"] as const) {
      const piece = { id, orientation, position: { x: 0, y: 5, z: 0 } }, pivot = somaRotationPivot(piece);
      const next = somaOrientAroundAnchor(piece, somaTurn(orientation, axis, 1));
      expect(somaRotationPivot(next)).toEqual(pivot); expect(somaOrientAroundAnchor(next, orientation)).toEqual(piece);
      const snapshot = { ...createSomaInitial(), selectedId: id, pieces: [piece] };
      expect(somaRotate(snapshot, axis, 1)?.pieces[0]).toEqual(next);
    }
  });
  it("continuous rotations and snapping preserve the same marked anchor, without AABB drift", () => {
    const c = camera();
    for (const id of SOMA_IDS) {
      const snapshot = { ...createSomaInitial(), selectedId: id, pieces: [{ id, orientation: 0, position: { x: 0, y: 5, z: 0 } }] };
      const source = snapshot.pieces[0], pivot = somaRotationPivot(source), local = somaDefinition(id).cells[somaAnchorIndex(id)];
      const ball = spatialArcball(pivot, 1.5, c, viewport);
      const preview = spatialArcballRotation(somaRigidPoses([source])[0], pivot, ball.center, { x: ball.center.x + 67, y: ball.center.y - 49 }, ball);
      const marked = new Vector3(local.x, local.y, local.z).applyQuaternion(new Quaternion(...preview.quaternion)).add(new Vector3(preview.position.x, preview.position.y, preview.position.z));
      expect(marked.distanceTo(new Vector3(pivot.x, pivot.y, pivot.z))).toBeLessThan(1e-8);
      const landing = somaGestureLanding(snapshot, id, preview, "rotate"); expect(landing.valid).toBe(true);
      expect(somaRotationPivot(landing.snapshot.pieces[0])).toEqual(pivot);
      expect(landing.snapshot.pieces[0].orientation).toBeLessThan(SOMA_ROTATIONS.length);
    }
  });
  it("snaps a two-axis translation once and rejects collisions and underground endpoints", () => {
    const initial = createSomaInitial(), source = initial.pieces[0], pose = somaRigidPoses([source])[0];
    const landed = somaGestureLanding(initial, source.id, { ...pose, position: { ...pose.position, x: pose.position.x + 1.2, z: pose.position.z + 1.7 } }, "translate");
    expect(landed.snapshot.pieces[0].position).toEqual({ ...source.position, x: source.position.x + 1, z: source.position.z + 2 });
    expect(somaGestureLanding(initial, source.id, { ...pose, position: { ...pose.position, y: -1 } }, "translate").valid).toBe(false);
    expect(somaGestureLanding(initial, source.id, { ...pose, position: { ...pose.position, x: pose.position.x + 3 } }, "translate").valid).toBe(false);
  });
});
