import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarPoint, PlanarState } from "@/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { planarCommit, planarHistory } from "@/features/tools/planar-kit/presentation";
import { planarSnapshot, planarSnapshotForTool } from "@/features/tools/planar-kit/contract";
import { constructionCorners, constructionMeasurements, constructionObject, constructionObjects } from "@/features/tools/plane-construction/model";
import { createPerimeterGeometry, createPerimeterState, deformPerimeterShape, dragPerimeterInvariant, perimeterInvariantHandle, perimeterRectangle, perimeterStretchFrame, setPerimeterField, setPerimeterProgress, squarePerimeterRectangle, type PerimeterInvariant, type RectangleDimension } from "@/features/tools/plane-perimeter/model";
import { planePerimeterScene as scene } from "@/features/tools/plane-perimeter/scenes";
import { isValidPerimeterState } from "@/features/tools/plane-perimeter/validation";
import { freezeToolScene, parseToolScene } from "@/features/tools/scenes/contract";
import { createClassroomToolState, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";

const concave = [{ x: 100, y: 100 }, { x: 330, y: 130 }, { x: 350, y: 330 }, { x: 215, y: 240 }, { x: 95, y: 300 }];
const convex = [{ x: 140, y: 80 }, { x: 340, y: 150 }, { x: 295, y: 340 }, { x: 120, y: 320 }, { x: 80, y: 180 }];
const triangle = [{ x: 100, y: 100 }, { x: 320, y: 150 }, { x: 160, y: 340 }];
const cases = [concave, convex, triangle, [...concave].reverse(), [concave[0], { x: 215, y: 115 }, ...concave.slice(1)]];
const create = (points: PlanarPoint[] = concave) => createPerimeterGeometry(createPerimeterState(), "polygon", points)!;
const invariant = (state: PlanarState, name: PerimeterInvariant, id = state.params.active) => constructionMeasurements(constructionObject(state, id)!)[name];
const api: PlanarDrawingApi = { locale: "zh", selected: "object.1", editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false }) };
const fields = (name: PerimeterInvariant) => scene.operations!.find((operation) => operation.id === `perimeter-fixed-${name}`)!.fields!;

describe("whole-polygon stretching at a fixed quantity", () => {
  for (const [index, points] of cases.entries()) for (const name of ["perimeter", "area"] as const) for (const dimension of ["width", "height"] as const) {
    it(`keeps true ${name}, topology and vertex identities for shape ${index}, changing ${dimension}`, () => {
      const state = create(points), original = structuredClone(state), frame = perimeterStretchFrame(state)!;
      expect(perimeterRectangle(state)).toBeNull(); expect(isValidPerimeterState(state)).toBe(true);
      const changed = deformPerimeterShape(state, name, dimension, frame[dimension] * 1.2);
      expect(changed).not.toBe(state); expect(isValidPerimeterState(changed)).toBe(true);
      expect(invariant(changed, name)).toBeCloseTo(invariant(state, name), 7);
      const next = perimeterStretchFrame(changed)!, before = constructionObject(state)!, after = constructionObject(changed)!;
      expect(next[dimension]).toBeCloseTo(frame[dimension] * 1.2, 8); expect(next.center).toEqual(frame.center);
      expect(after.vertices).toHaveLength(before.vertices.length); expect(after.center).toEqual(before.center);
      expect(constructionCorners(after)).toHaveLength(constructionCorners(before).length);
      before.vertices.forEach((point, vertex) => {
        expect((after.vertices[vertex].x - next.center.x) / next.width).toBeCloseTo((point.x - frame.center.x) / frame.width, 9);
        expect((after.vertices[vertex].y - next.center.y) / next.height).toBeCloseTo((point.y - frame.center.y) / frame.height, 9);
      });
      expect(Object.keys(changed.points)).toEqual(Object.keys(state.points)); expect(constructionObject(changed, 0)).toEqual(constructionObject(state, 0));
      expect(state).toEqual(original);
    });
  }

  it("solves real edge lengths rather than holding the bounding-box perimeter", () => {
    const state = create(), before = perimeterStretchFrame(state)!;
    const changed = deformPerimeterShape(state, "perimeter", "width", before.width * 1.3), after = perimeterStretchFrame(changed)!;
    expect(invariant(changed, "perimeter")).toBeCloseTo(invariant(state, "perimeter"), 8);
    expect(2 * (after.width + after.height)).not.toBeCloseTo(2 * (before.width + before.height), 3);
    expect(invariant(changed, "area")).not.toBeCloseTo(invariant(state, "area"), 3);
  });

  it("shares field and direction-handle endpoints after rotation and reflection, resolving the dragged material ID", () => {
    for (const angle of [0, 37, 149]) for (const flip of [-1, 1]) for (const name of ["perimeter", "area"] as const) for (const dimension of ["width", "height"] as const) {
      let state = create(); state = { ...state, params: { ...state.params, "angle.1": angle, "flip.1": flip }, flags: { ...state.flags, snap: true } };
      const frame = perimeterStretchFrame(state)!, direction = perimeterInvariantHandle(state, dimension)!.direction;
      const delta = { x: direction.x * 12 - direction.y * 41, y: direction.y * 12 + direction.x * 41 };
      const dragged = dragPerimeterInvariant({ ...state, params: { ...state.params, active: 0 } }, `invariant.${name}.${dimension}.1`, delta);
      const accurate = setPerimeterField(state, `${name}-${dimension}`, (frame[dimension] + 24) / 30);
      expect(isValidPerimeterState(dragged)).toBe(true); expect(dragged.params.active).toBe(1);
      expect(perimeterStretchFrame(dragged)!.width).toBeCloseTo(perimeterStretchFrame(accurate)!.width, 8);
      expect(perimeterStretchFrame(dragged)!.height).toBeCloseTo(perimeterStretchFrame(accurate)!.height, 8);
      expect(invariant(dragged, name)).toBeCloseTo(invariant(state, name), 7);
      expect(dragged.params["angle.1"]).toBe(angle); expect(dragged.params["flip.1"]).toBe(flip); expect(dragged.flags.snap).toBe(true);
      expect(constructionObject(dragged, 0)).toEqual(constructionObject(state, 0));
    }
  });

  it("preserves marks and other material progress while resetting only the stretched boundary demonstration", () => {
    const first = setPerimeterProgress(setPerimeterProgress(createPerimeterState(), "walk", 1), "straight", 0.6);
    let state = setPerimeterProgress(setPerimeterProgress(createPerimeterGeometry(first, "polygon", concave)!, "walk", 0.3), "straight", 1);
    state = { ...state, marks: ["vertex.1.3", "edge.0.1"], flags: { ...state.flags, measures: true, edit: true } };
    const changed = setPerimeterField(state, "area-width", 12);
    expect(isValidPerimeterState(changed)).toBe(true); expect(changed.marks).toEqual(state.marks); expect(changed.flags).toEqual(state.flags);
    expect(changed.params["walk.1"]).toBe(0); expect(changed.params["straight.1"]).toBe(0);
    expect(changed.params["walk.0"]).toBe(1); expect(changed.params["straight.0"]).toBe(0.6);
    expect(Object.keys(changed.params)).toEqual(Object.keys(state.params));
    expect(deformPerimeterShape(state, "area", "width", perimeterStretchFrame(state)!.width)).toBe(state);
  });

  it("keeps legal quantities at extreme requests and uses atomic no-op for short-edge limits or unsupported input", () => {
    const state = create(), saved = structuredClone(state);
    for (const name of ["perimeter", "area"] as const) for (const dimension of ["width", "height"] as const) for (const value of [-1000, 0, 0.1, 1000000]) {
      const changed = deformPerimeterShape(state, name, dimension, value);
      expect(isValidPerimeterState(changed)).toBe(true); expect(invariant(changed, name)).toBeCloseTo(invariant(state, name), 7);
      expect(constructionObject(changed)!.vertices.every((point) => Math.abs(point.x) <= 800 && Math.abs(point.y) <= 800)).toBe(true);
    }
    const short = create([{ x: 100, y: 100 }, { x: 101.1, y: 100 }, { x: 340, y: 100 }, { x: 340, y: 250 }, { x: 100, y: 250 }]);
    expect(deformPerimeterShape(short, "area", "width", 120)).toBe(short);
    for (const value of [NaN, Infinity, -Infinity]) expect(deformPerimeterShape(state, "area", "width", value)).toBe(state);
    expect(deformPerimeterShape(state, "perimeter", "width", 200, 999)).toBe(state);
    expect(deformPerimeterShape(state, "unknown" as PerimeterInvariant, "width", 200)).toBe(state);
    expect(deformPerimeterShape(state, "area", "unknown" as RectangleDimension, 200)).toBe(state);
    expect(dragPerimeterInvariant(state, "invariant.area.width.0001", { x: 10, y: 0 })).toBe(state);
    expect(state).toEqual(saved);
  });

  it("respects local coordinate limits for an edited polygon whose local bounds are not centered at the origin", () => {
    let state = create();
    state = { ...state, points: Object.fromEntries(Object.entries(state.points).map(([key, point]) => [key, key.startsWith("vertex.1.") ? { x: point.x + 500, y: point.y } : point])) };
    expect(isValidPerimeterState(state)).toBe(true);
    const changed = deformPerimeterShape(state, "area", "width", 1600);
    expect(changed).not.toBe(state); expect(isValidPerimeterState(changed)).toBe(true);
    expect(perimeterStretchFrame(changed)!.width).toBeCloseTo(600, 8);
    expect(perimeterStretchFrame(changed)!.center).toEqual(perimeterStretchFrame(state)!.center);
    expect(invariant(changed, "area")).toBeCloseTo(invariant(state, "area"), 7);
  });

  it("conserves quantities across several simple star-shaped polygons and repeated moderate changes", () => {
    for (const count of [3, 5, 8, 16, 32]) for (const name of ["perimeter", "area"] as const) {
      let state = create(Array.from({ length: count }, (_, index) => {
        const radius = index % 2 ? 85 : 150, angle = 2 * Math.PI * index / count + 0.27;
        return { x: 340 + radius * Math.cos(angle), y: 280 + radius * Math.sin(angle) };
      }));
      const target = invariant(state, name);
      for (let step = 0; step < 16; step++) {
        const dimension = step % 2 ? "width" : "height", frame = perimeterStretchFrame(state)!;
        state = deformPerimeterShape(state, name, dimension, frame[dimension] * (step % 4 < 2 ? 1.08 : 1 / 1.08));
        expect(isValidPerimeterState(state)).toBe(true); expect(invariant(state, name)).toBeCloseTo(target, 6);
      }
    }
  });

  it("uses the existing save, fixed-copy, history and classroom snapshot contracts without extra keys", () => {
    const initial = create(), prepared = parseToolScene({ toolId: "plane-perimeter", contentVersion: "plane-perimeter-lesson-v2", payload: { title: "Polygon stretching", initial } });
    const frozen = freezeToolScene(prepared), serialized = JSON.stringify(frozen);
    const endpoint = deformPerimeterShape(initial, "perimeter", "height", 280);
    const snapshot = planarCommit(planarSnapshot(initial), initial, endpoint);
    expect(planarSnapshotForTool("plane-perimeter", "plane-perimeter-lesson-v2").safeParse(snapshot).success).toBe(true);
    expect(parseToolScene({ ...prepared, payload: { title: "Result", initial: endpoint } }).payload).toMatchObject({ initial: endpoint });
    const event = createClassroomToolState("page", "doc", "instance", { toolId: "plane-perimeter", contentVersion: "plane-perimeter-lesson-v2", state: snapshot }, toolSceneOriginHash(frozen.payload));
    expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(planarHistory(snapshot, "undo").current).toEqual(initial); expect(planarHistory(planarHistory(snapshot, "undo"), "redo").current).toEqual(endpoint);
    expect(JSON.stringify(frozen)).toBe(serialized); expect(constructionObjects(endpoint)).toHaveLength(2);
  });

  it("offers polygon fields and contextual access, gates handles by the explicit operation and keeps measurement on close", () => {
    const state = create(), observed = { ...state, flags: { ...state.flags, measures: true } };
    for (const name of ["perimeter", "area"] as const) {
      for (const field of fields(name)) { expect(field.disabled!(state)).toBe(false); expect(field.read!(state)).toBeGreaterThan(0); }
      const operation = `perimeter-fixed-${name}`, draw = (overrides: Partial<PlanarDrawingApi> = {}) => renderToStaticMarkup(scene.draw(observed, { ...api, operation, ...overrides }));
      expect(draw().match(/data-perimeter-invariant-handle=/g)).toHaveLength(2);
      expect(draw({ editable: false })).not.toContain("data-perimeter-invariant-handle");
      expect(draw({ selected: null })).not.toContain("data-perimeter-invariant-handle");
      expect(draw({ operation: null })).not.toContain("data-perimeter-invariant-handle");
      expect(draw({ operation: null })).toContain("u²");
      expect(squarePerimeterRectangle(state, name)).toBe(state);
      expect(scene.operations!.find((entry) => entry.id === operation)!.actions![0].disabled!(state, { selected: "object.1" })).toBe(true);
    }
    expect(scene.contextActions!(state, "invariant.area.height.1")!.items).toContainEqual({ kind: "operation", id: "perimeter-fixed-perimeter" });
    const framed = { ...state, params: { ...state.params, "frameA.1": 1, "frameB.1": 0, "frameC.1": 0, "frameD.1": 1 } };
    expect(perimeterStretchFrame(framed)).toBeNull(); expect(deformPerimeterShape(framed, "area", "width", 320)).toBe(framed);
  });
});
