// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanarPoint, PlanarSnapshot, PlanarState } from "@/features/tools/planar-kit/contract";
import type { PlanarAction, PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { planarCommit, planarFrame, planarHistory, planarPause } from "@/features/tools/planar-kit/presentation";
import {
  addConstruction, constructionMeasurements, constructionObject, constructionObjects, duplicateConstruction, removeConstruction, worldVertices,
} from "@/features/tools/plane-construction/model";
import { distance, polygonSegments } from "@/features/tools/plane-geometry/model";
import { planeGeometryScenes } from "@/features/tools/plane-geometry/scenes";
import { isValidPlaneGeometryState } from "@/features/tools/plane-geometry/validation";
import {
  PERIMETER_UNIT, createPerimeterGeometry, createPerimeterState, perimeterComparison, perimeterLength,
  deformPerimeterRectangle, dragPerimeterInvariant, perimeterInvariantHandle, perimeterRectangle, perimeterVertices, setPerimeterField, setPerimeterProgress, straightenPerimeter, syncPerimeterGeometry, walkPerimeter,
} from "@/features/tools/plane-perimeter/model";
import { planePerimeterScene as scene } from "@/features/tools/plane-perimeter/scenes";
import { isValidPerimeterState } from "@/features/tools/plane-perimeter/validation";

const concave: PlanarPoint[] = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 280 }, { x: 250, y: 190 }, { x: 100, y: 280 }];
const api: PlanarDrawingApi = { locale: "zh", selected: null, editable: true, bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false }) };
const action = (id: string): PlanarAction => [...scene.actions!, ...scene.operations!.flatMap((operation) => operation.actions ?? [])].find((entry) => entry.id === id)!;
const run = (id: string, state: PlanarState, selected: string | null = null) => action(id).run(state, { selected });
const empty = () => syncPerimeterGeometry(createPerimeterState(), removeConstruction(createPerimeterState()));
const completed = (state = createPerimeterState()) => setPerimeterProgress(setPerimeterProgress(state, "walk", 1), "straight", 1);
function draw(state: PlanarState, extras: Partial<PlanarDrawingApi> = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.innerHTML = renderToStaticMarkup(scene.draw(state, { ...api, ...extras }));
  expect(svg.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
  return svg;
}
function expectPoint(actual: PlanarPoint, expected: PlanarPoint) {
  expect(actual.x).toBeCloseTo(expected.x, 8); expect(actual.y).toBeCloseTo(expected.y, 8);
}
afterEach(() => vi.unstubAllGlobals());

describe("perimeter materials and strict v2 state", () => {
  it("starts with a real 6 by 4 rectangle, exact progress keys and no conclusions shown", () => {
    const state = createPerimeterState(), object = constructionObject(state)!;
    expect(state.sceneId).toBe("10-create"); expect(state.phase).toBe(0);
    expect(isValidPerimeterState(state)).toBe(true);
    expect(perimeterLength(object) / PERIMETER_UNIT).toBe(20);
    expect(state.params["walk.0"]).toBe(0); expect(state.params["straight.0"]).toBe(0);
    expect(Object.values(state.flags).some(Boolean)).toBe(false);
    expect(draw(state, { selected: "object.0" }).querySelectorAll("text, [data-construction-edit-handle]")).toHaveLength(0);
  });

  it("appends a teacher-drawn concave polygon while preserving existing material and demonstrations", () => {
    const before = completed(), original = structuredClone(before);
    const after = createPerimeterGeometry(before, "polygon", concave)!;
    expect(isValidPerimeterState(after)).toBe(true); expect(before).toEqual(original);
    expect(constructionObjects(after)).toHaveLength(2);
    expect(constructionObject(after, 0)).toEqual(constructionObject(before, 0));
    worldVertices(constructionObject(after)!).forEach((point, index) => expectPoint(point, concave[index]));
    expect(after.params["walk.0"]).toBe(1); expect(after.params["straight.0"]).toBe(1);
    expect(after.params["walk.1"]).toBe(0); expect(after.params["straight.1"]).toBe(0);
    expect(scene.selectionAfterChange!(before, after, null)).toBe("object.1");
  });

  it("accepts either winding and keeps point editing separate from mathematical corners", () => {
    for (const points of [concave, [...concave].reverse()]) {
      let state = createPerimeterGeometry(empty(), "polygon", points)!;
      const id = state.params.active, length = perimeterLength(constructionObject(state)!);
      state = run("construction-edit", state);
      state = run("construction-insert-vertex", state, `edge.${id}.0`);
      expect(constructionObject(state)!.vertices).toHaveLength(6);
      expect(perimeterVertices(constructionObject(state)!)).toHaveLength(5);
      expect(perimeterLength(constructionObject(state)!)).toBeCloseTo(length, 8);
      expect(isValidPerimeterState(state)).toBe(true);
    }
  });

  it("keeps drawing failures local and rejects curved, degenerate, crossing and oversized polygons", () => {
    const initial = createPerimeterState(), before = structuredClone(initial);
    for (const points of [
      [{ x: 0, y: 0 }, { x: 200, y: 200 }, { x: 200, y: 0 }, { x: 0, y: 200 }],
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }],
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }],
      [{ x: NaN, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }],
      Array.from({ length: 33 }, (_, index) => ({ x: 200 + 100 * Math.cos(index * Math.PI * 2 / 33), y: 200 + 100 * Math.sin(index * Math.PI * 2 / 33) })),
    ]) expect(createPerimeterGeometry(initial, "polygon", points)).toBeNull();
    for (const tool of ["circle", "ellipse", "unknown"]) expect(createPerimeterGeometry(initial, tool, concave)).toBeNull();
    expect(createPerimeterGeometry(initial, "rectangle", [{ x: 0, y: 0 }, { x: 0, y: 100 }])).toBeNull();
    expect(initial).toEqual(before);
  });

  it("adds every straight-edged shortcut without replacing the current scene", () => {
    expect(scene.materials).toHaveLength(5);
    expect(scene.construction!.tools.map((tool) => tool.id)).toEqual(["rectangle", "polygon"]);
    for (const material of scene.materials!) {
      const before = completed(), after = material.add(before);
      expect(isValidPerimeterState(after), material.id).toBe(true);
      expect(constructionObjects(after)).toHaveLength(2);
      expect(constructionObject(after, 0)).toEqual(constructionObject(before, 0));
      expect(after.params["straight.0"]).toBe(1); expect(after.params["straight.1"]).toBe(0);
    }
  });

  it("duplicates with fresh progress and removes all keys of only the removed material", () => {
    const before = completed(), copied = run("construction-duplicate", before), id = copied.params.active;
    expect(id).toBe(1); expect(isValidPerimeterState(copied)).toBe(true);
    expect(copied.params[`walk.${id}`]).toBe(0); expect(copied.params[`straight.${id}`]).toBe(0);
    expect(copied.params["straight.0"]).toBe(1);
    const removed = run("construction-remove", copied);
    expect(isValidPerimeterState(removed)).toBe(true);
    expect(Object.keys(removed.params).some((key) => key.endsWith(".1"))).toBe(false);
    expect(constructionObject(removed)).toEqual(constructionObject(before));
    expect(removed.params["straight.0"]).toBe(1);
    const cleared = run("construction-remove", removed);
    expect(isValidPerimeterState(cleared)).toBe(true); expect(cleared.params.active).toBe(-1);
    expect(action("perimeter-walk").disabled!(cleared, { selected: null })).toBe(true);
    expect(scene.contextActions!(cleared, "object.0")).toBeNull();
  });

  it("updates dimensions in u and resets only the changed shape's progress", () => {
    const first = completed(), second = completed(createPerimeterGeometry(first, "polygon", concave)!);
    const resized = setPerimeterField(second, "width", 12);
    expect(isValidPerimeterState(resized)).toBe(true);
    expect(scene.fields!.find((field) => field.key === "width")!.read!(resized)).toBeCloseTo(12);
    expect(resized.params["walk.1"]).toBe(0); expect(resized.params["straight.1"]).toBe(0);
    expect(resized.params["walk.0"]).toBe(1); expect(resized.params["straight.0"]).toBe(1);
    expect(setPerimeterField(second, "width", NaN)).toBe(second);
  });

  it("edits selected vertices and rejects self-crossing edits without clearing the demonstration", () => {
    let state = run("construction-edit", completed());
    const before = constructionObject(state)!, first = worldVertices(before)[0];
    const moved = scene.drag!(state, "vertex.0.0", { x: first.x - 30, y: first.y }, { x: -30, y: 0 });
    expect(isValidPerimeterState(moved)).toBe(true); expect(moved.params["straight.0"]).toBe(0);
    expect(constructionObject(moved)!.kind).toBe(0);
    const invalid = scene.drag!(state, "vertex.0.0", { x: 520, y: 250 }, { x: 230, y: 40 });
    expect(invalid).toBe(state); expect(invalid.params["straight.0"]).toBe(1);
    state = run("construction-insert-vertex", state, "edge.0.0");
    expect(state.params["walk.0"]).toBe(0); expect(perimeterVertices(constructionObject(state)!)).toHaveLength(4);
    state = completed(state);
    const removed = run("construction-remove-vertex", state, "vertex.0.1");
    expect(isValidPerimeterState(removed)).toBe(true); expect(removed.params["straight.0"]).toBe(0);
    expect(constructionObject(removed)!.vertices).toHaveLength(4);
  });

  it("preserves progress during rigid moving, rotation, marking and selected-edge dragging", () => {
    let state = run("construction-edges", completed());
    state = scene.tap!(state, "edge.0.1");
    const center = constructionObject(state)!.center;
    const moved = scene.drag!(state, "edge.0.1", { x: center.x + 40, y: center.y + 20 }, { x: 40, y: 20 });
    expectPoint(constructionObject(moved)!.center, { x: center.x + 40, y: center.y + 20 });
    expect(moved.params["walk.0"]).toBe(1); expect(moved.params["straight.0"]).toBe(1);
    expect(perimeterLength(constructionObject(moved)!)).toBeCloseTo(600);
    const rotated = setPerimeterField(moved, "angle", 37);
    expect(rotated.params["straight.0"]).toBe(1); expect(isValidPerimeterState(rotated)).toBe(true);
    expect(rotated.marks).toEqual(["edge.0.1"]);
  });

  it("retains construction budgets for objects and total vertices", () => {
    let state = empty();
    for (let i = 0; i < 16; i++) state = createPerimeterGeometry(state, "polygon", concave)!;
    expect(isValidPerimeterState(state)).toBe(true); expect(constructionObjects(state)).toHaveLength(16);
    expect(createPerimeterGeometry(state, "polygon", concave)).toBeNull();
    expect(action("construction-duplicate").disabled!(state, { selected: null })).toBe(true);
    const polygon = Array.from({ length: 32 }, (_, index) => ({ x: 200 + 100 * Math.cos(index * Math.PI * 2 / 32), y: 200 + 100 * Math.sin(index * Math.PI * 2 / 32) }));
    state = empty();
    for (let i = 0; i < 6; i++) state = createPerimeterGeometry(state, "polygon", polygon)!;
    expect(isValidPerimeterState(state)).toBe(true);
    expect(createPerimeterGeometry(state, "polygon", concave)).toBeNull();
  });

  it("strictly rejects missing, orphan, malformed and out-of-range progress or extra state", () => {
    const state = createPerimeterState();
    for (const mutation of [
      (s: PlanarState) => { delete s.params["walk.0"]; },
      (s: PlanarState) => { s.params["walk.8"] = 0; },
      (s: PlanarState) => { s.params["walk.00"] = 0; },
      (s: PlanarState) => { s.params["straight.0"] = 1.01; },
      (s: PlanarState) => { s.params["straight.0"] = -0.01; },
      (s: PlanarState) => { s.params["walk.0"] = NaN; },
      (s: PlanarState) => { s.params["walk.0"] = Infinity; },
      (s: PlanarState) => { s.params["frameA.0"] = 1; },
      (s: PlanarState) => { s.phase = 0.1; },
      (s: PlanarState) => { s.sceneId = "10"; },
      (s: PlanarState) => { s.params.active = 123; },
      (s: PlanarState) => { s.params["life.0"] = 2; s.params["detail.0"] = 1; },
      (s: PlanarState) => { s.points["vertex.0.0"].x = 801; },
      (s: PlanarState) => { s.points["vertex.0.0"] = { ...s.points["vertex.0.0"], extra: 1 } as PlanarPoint; },
      (s: PlanarState) => { s.marks = ["edge.9.0"]; },
      (s: PlanarState) => { s.flags.unknown = false; },
    ]) {
      const changed = structuredClone(state); mutation(changed); expect(isValidPerimeterState(changed)).toBe(false);
    }
    expect(isValidPerimeterState({ ...state, extra: true } as PlanarState)).toBe(false);
    expect(isValidPerimeterState({ ...state, params: null } as unknown as PlanarState)).toBe(false);
    expect(isValidPerimeterState(null as unknown as PlanarState)).toBe(false);
    const curved = syncPerimeterGeometry(null, addConstruction(empty(), "circle", [{ x: 100, y: 100 }, { x: 180, y: 100 }]));
    expect(isValidPerimeterState(curved)).toBe(false);
    const uncheckedCopy = duplicateConstruction(state);
    expect(isValidPerimeterState(uncheckedCopy)).toBe(false);
  });
});

describe("continuous boundary mathematics and shared-scale comparison", () => {
  it("walks by true accumulated length rather than equal time per edge", () => {
    const object = constructionObject(createPerimeterState())!, vertices = perimeterVertices(object);
    const quarter = walkPerimeter(object, 0.25);
    expect(quarter.length).toBe(150); expect(quarter.segments).toHaveLength(1);
    expectPoint(quarter.cursor, { x: vertices[0].x + 150, y: vertices[0].y });
    expectPoint(walkPerimeter(object, 0).cursor, vertices[0]);
    expectPoint(walkPerimeter(object, 1).cursor, vertices[0]);
    expect(walkPerimeter(object, 1).segments).toHaveLength(4);
    expect(walkPerimeter(object, -1).length).toBe(0); expect(walkPerimeter(object, 2).length).toBe(600);
  });

  it("preserves every edge in intermediate frames and meets end to end when straight", () => {
    const state = createPerimeterGeometry(empty(), "polygon", concave)!;
    for (const angle of [0, 37, 180, -90]) {
      const object = constructionObject(setPerimeterField(state, "angle", angle))!, edges = polygonSegments(perimeterVertices(object));
      for (const progress of [0, 0.01, 0.25, 0.5, 0.85, 1]) {
        const frame = straightenPerimeter(object, progress);
        frame.forEach((segment, index) => expect(distance(segment.a, segment.b)).toBeCloseTo(distance(edges[index].a, edges[index].b), 8));
        expect(frame.reduce((sum, segment) => sum + distance(segment.a, segment.b), 0)).toBeCloseTo(perimeterLength(object), 8);
      }
      const end = straightenPerimeter(object, 1);
      end.forEach((segment, index) => {
        expect(segment.a.y).toBeCloseTo(segment.b.y, 8);
        if (index > 0) expectPoint(segment.a, end[index - 1].b);
      });
    }
  });

  it("does not rewrite original geometry while tracing or straightening", () => {
    const state = createPerimeterGeometry(createPerimeterState(), "polygon", concave)!, saved = structuredClone(state);
    const traced = run("perimeter-walk", state), straight = run("perimeter-straighten", traced);
    expect(constructionObjects(straight)).toEqual(constructionObjects(saved)); expect(straight.points).toEqual(saved.points);
    expect(state).toEqual(saved); expect(isValidPerimeterState(straight)).toBe(true);
    expect(run("perimeter-walk", traced).params["walk.1"]).toBe(0);
    expect(run("perimeter-straighten", straight).params["straight.1"]).toBe(0);
  });

  it("uses one stable scale for different lengths throughout both copies' animations", () => {
    let state = createPerimeterGeometry(completed(), "polygon", concave)!;
    state = setPerimeterProgress(state, "straight", 0.2);
    const comparison = perimeterComparison(state)!;
    expect(comparison.entries).toHaveLength(2);
    const completedState = setPerimeterProgress(state, "straight", 1), final = perimeterComparison(completedState)!;
    expect(final.scale).toBe(comparison.scale);
    const lengths = final.entries.map(({ segments }) => (segments.at(-1)!.b.x - segments[0].a.x) * final.scale);
    expect(lengths[0] / lengths[1]).toBeCloseTo(perimeterLength(final.entries[0].object) / perimeterLength(final.entries[1].object), 9);
    expect(constructionObject(completedState, 0)).toEqual(constructionObject(createPerimeterState()));
  });

  it("keeps all intermediate edge endpoints in the fixed comparison envelope", () => {
    let state = completed(setPerimeterField(createPerimeterGeometry(completed(), "polygon", concave)!, "angle", 147));
    state = scene.tap!(state, "object.0");
    const comparison = perimeterComparison(state)!, { bounds } = comparison;
    for (const { object } of comparison.entries) for (let index = 0; index <= 200; index++) {
      for (const segment of straightenPerimeter(object, index / 200)) for (const point of [segment.a, segment.b]) {
        expect(point.x).toBeGreaterThanOrEqual(bounds.minX); expect(point.x).toBeLessThanOrEqual(bounds.maxX);
        expect(point.y).toBeGreaterThanOrEqual(bounds.minY); expect(point.y).toBeLessThanOrEqual(bounds.maxY);
      }
    }
  });

  it("limits visible comparisons while preserving all material and progress, and follows selection", () => {
    let state = completed();
    for (let i = 0; i < 5; i++) state = completed(run("construction-duplicate", state));
    const saved = structuredClone(state), comparison = perimeterComparison(state)!;
    expect(comparison.entries).toHaveLength(2); expect(comparison.hiddenCount).toBe(4);
    expect(comparison.entries[0].object.id).toBe(5);
    const selected = scene.tap!(state, "object.3"), changed = perimeterComparison(selected)!;
    expect(changed.entries[0].object.id).toBe(3); expect(constructionObjects(selected)).toHaveLength(6);
    expect(state).toEqual(saved);
    for (let id = 0; id < 6; id++) expect(selected.params[`straight.${id}`]).toBe(1);
    expect(perimeterComparison(createPerimeterState())).toBeNull();
    expect(perimeterComparison(createPerimeterState(), true)!.entries).toHaveLength(1);
  });

  it("supports accurate paused frames, replay, history and HTTP-safe IDs through the shared host model", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const start = createPerimeterState(), snapshot: PlanarSnapshot = { current: start, past: [], future: [], motion: null };
    const playback = planarCommit(snapshot, start, run("perimeter-straighten", start), { id: "perimeter-straighten", duration: 2200, now: 100 });
    expect(playback.motion!.id).toMatch(/^[0-9a-f-]{36}$/);
    const half = planarFrame(playback, scene, 1200);
    expect(half.params["straight.0"]).toBeCloseTo(0.5); expect(isValidPerimeterState(half)).toBe(true);
    const paused = planarPause(playback, 1200, true);
    expect(planarFrame(paused, scene, 5000)).toEqual(half);
    expect(planarFrame(JSON.parse(JSON.stringify(paused)), scene, 5000)).toEqual(half);
    const resumed = planarPause(paused, 5000, false);
    expect(planarFrame(resumed, scene, 6100)).toEqual(playback.current);
    const undone = planarHistory(playback, "undo"); expect(undone.current).toEqual(start);
    expect(planarHistory(undone, "redo").current).toEqual(playback.current);
    expect(constructionObjects(half)).toEqual(constructionObjects(start));
  });
});

describe("perimeter descriptor, rendering and helper contract", () => {
  it("reads exact fields from the active material and routes progress through the same endpoint", () => {
    const state = setPerimeterField(setPerimeterField(createPerimeterState(), "walk", 25), "straight", 60);
    expect(state.params["walk.0"]).toBe(0.25); expect(state.params["straight.0"]).toBe(0.6);
    const fields = scene.operations!.find((operation) => operation.id === "perimeter")!.fields!;
    expect(fields.map((field) => field.read!(state))).toEqual([25, 60]);
    expect(setPerimeterField(state, "walk", NaN)).toBe(state);
    expect(setPerimeterField(state, "walk", -10).params["walk.0"]).toBe(0);
    expect(setPerimeterField(state, "straight", 200).params["straight.0"]).toBe(1);
  });

  it("shows actual side/perimeter values without copying the base pixel-scale area labels", () => {
    const state = run("construction-measures", createPerimeterState());
    for (const locale of ["zh", "en"]) {
      const svg = draw(state, { locale });
      expect(svg.textContent).toContain("P = 20 u"); expect(svg.textContent).toContain("6 u"); expect(svg.textContent).toContain("4 u");
      expect(svg.textContent).not.toMatch(/u²|600 u|面积|Area/);
      const comparing = draw(completed(state), { locale });
      expect(comparing.textContent).toContain(locale === "en" ? "Boundary copies · one shared scale" : "边界副本 · 共同比例尺");
      expect(comparing.querySelectorAll("[data-perimeter-copy-edge]")).toHaveLength(4);
      expect(comparing.querySelectorAll("[data-perimeter-cursor]")).toHaveLength(1);
    }
  });

  it("reuses declared actions and bounds for the contextual toolbar without activating edit handles", () => {
    const state = createPerimeterState(), context = scene.contextActions!(state, "object.0")!;
    expect(context.bounds).toMatchObject({ minX: 290, maxX: 470, minY: 210, maxY: 330 });
    expect(context.items).toEqual([{ kind: "operation", id: "perimeter" }, { kind: "action", id: "construction-edit" }, { kind: "action", id: "construction-duplicate" }, { kind: "operation", id: "perimeter-fixed-perimeter" }]);
    for (const item of context.items) expect((item.kind === "action" ? scene.actions : scene.operations)!.some((entry) => entry.id === item.id)).toBe(true);
    expect(scene.contextActions!(state, null)).toBeNull(); expect(scene.contextActions!(state, "object.999")).toBeNull();
    expect(draw(state, { selected: "object.0" }).querySelectorAll("[data-construction-edit-handle]")).toHaveLength(0);
    expect(draw(run("construction-edit", state), { selected: "object.0" }).querySelectorAll("[data-construction-edit-handle]")).toHaveLength(4);
  });

  it("retains the existing v1 mathematics rather than changing historical scene defaults", () => {
    for (const id of ["10", "12", "13", "43"]) {
      const legacy = planeGeometryScenes.find((definition) => definition.id === id)!;
      expect(legacy).toBeDefined(); expect(isValidPlaneGeometryState(legacy.create())).toBe(true);
      expect(legacy.create().sceneId).toBe(id); expect(isValidPerimeterState(legacy.create())).toBe(false);
    }
  });

  it("provides only the two strict private SQL helpers, leaving dispatcher wiring to integration", () => {
    const sql = readFileSync("supabase/migrations/20261002000100_tool_plane_perimeter.sql", "utf8");
    expect(sql).toContain("create function public.tool_plane_perimeter_state_is_valid(s jsonb)");
    expect(sql).toContain("create function public.tool_plane_perimeter_scene_is_valid(s jsonb)");
    expect(sql).toContain("tool_plane_construction_state_is_valid"); expect(sql).toContain("progress_count=object_count*2");
    expect(sql).toContain("'plane-perimeter-lesson-v2'"); expect(sql).toContain("octet_length(s::text)<=150000");
    expect(sql.match(/exception when others then return false/g)).toHaveLength(2);
    expect(sql.match(/from public,anon,authenticated,service_role/g)).toHaveLength(2);
    expect(sql).not.toMatch(/create or replace|notify pgrst|insert into|delete from/i);
  });
});

describe("rectangle reshaping at a fixed quantity", () => {
  it("solves both dimensions atomically, keeps the center and resets only the changed material's demonstration", () => {
    const state = completed(run("construction-duplicate", completed())), original = structuredClone(state);
    const id = state.params.active, before = constructionMeasurements(constructionObject(state)!);
    const fixedPerimeter = setPerimeterField(state, "perimeter-width", 8);
    expect(perimeterRectangle(fixedPerimeter)).toMatchObject({ width: 240, height: 60 });
    expect(constructionMeasurements(constructionObject(fixedPerimeter)!).perimeter).toBeCloseTo(before.perimeter, 9);
    const fixedArea = setPerimeterField(state, "area-height", 8);
    expect(perimeterRectangle(fixedArea)).toMatchObject({ width: 90, height: 240 });
    expect(constructionMeasurements(constructionObject(fixedArea)!).area).toBeCloseTo(before.area, 8);
    for (const result of [fixedPerimeter, fixedArea]) {
      expect(isValidPerimeterState(result)).toBe(true);
      expect(constructionObject(result)!.center).toEqual(constructionObject(state)!.center);
      expect(constructionObject(result, 0)).toEqual(constructionObject(state, 0));
      expect(result.params[`walk.${id}`]).toBe(0); expect(result.params[`straight.${id}`]).toBe(0);
      expect(result.params["walk.0"]).toBe(1); expect(result.params["straight.0"]).toBe(1);
      expect(Object.keys(result.params)).toEqual(Object.keys(state.params));
    }
    expect(state).toEqual(original);
  });

  it("uses the frozen true edge direction for a rotated or reflected handle even when the grid is on", () => {
    let state = setPerimeterField(createPerimeterState(), "angle", 37);
    state = { ...state, params: { ...state.params, "flip.0": -1 }, flags: { ...state.flags, snap: true } };
    for (const invariant of ["perimeter", "area"] as const) for (const dimension of ["width", "height"] as const) {
      const handle = perimeterInvariantHandle(state, dimension)!, u = handle.direction;
      const delta = { x: u.x * 23 - u.y * 90, y: u.y * 23 + u.x * 90 };
      const next = dragPerimeterInvariant(state, `invariant.${invariant}.${dimension}.0`, delta);
      const accurate = deformPerimeterRectangle(state, invariant, dimension, perimeterRectangle(state)![dimension] + 46);
      expect(isValidPerimeterState(next)).toBe(true);
      const actual = constructionMeasurements(constructionObject(next)!), initial = constructionMeasurements(constructionObject(state)!);
      expect(actual[invariant]).toBeCloseTo(initial[invariant], 7);
      expect(perimeterRectangle(next)!.width).toBeCloseTo(perimeterRectangle(accurate)!.width, 9);
      expect(perimeterRectangle(next)!.height).toBeCloseTo(perimeterRectangle(accurate)!.height, 9);
      expect(next.flags.snap).toBe(true); expect(constructionObject(next)!.angle).toBe(37); expect(constructionObject(next)!.flip).toBe(-1);
    }
  });

  it("accepts a rotated rectangle drawn as a polygon while retaining its vertex identities", () => {
    const state = createPerimeterGeometry(empty(), "polygon", [{ x: 150, y: 100 }, { x: 270, y: 260 }, { x: 190, y: 320 }, { x: 70, y: 160 }])!;
    const id = state.params.active;
    expect(perimeterRectangle(state)).toMatchObject({ width: 200, height: 100 });
    const next = setPerimeterField(state, "perimeter-width", 5);
    expect(perimeterRectangle(next)).toMatchObject({ width: 150, height: 150 });
    expect(isValidPerimeterState(next)).toBe(true);
    expect(next.params[`kind.${id}`]).toBe(0); expect(Object.keys(next.points)).toEqual(Object.keys(state.points));
  });

  it("preserves the invariant at limits and leaves unsupported or non-finite requests untouched", () => {
    const state = createPerimeterState(), other = createPerimeterGeometry(state, "polygon", concave)!;
    for (const invariant of ["perimeter", "area"] as const) for (const value of [-100, 0, 10000]) {
      const next = deformPerimeterRectangle(state, invariant, "width", value);
      expect(isValidPerimeterState(next)).toBe(true);
      expect(constructionMeasurements(constructionObject(next)!)[invariant]).toBeCloseTo(constructionMeasurements(constructionObject(state)!)[invariant], 7);
      expect(perimeterRectangle(next)!.width).toBeGreaterThanOrEqual(1); expect(perimeterRectangle(next)!.height).toBeGreaterThanOrEqual(1);
    }
    expect(setPerimeterField(other, "area-width", 7)).toBe(other);
    expect(setPerimeterField(state, "area-width", NaN)).toBe(state);
    expect(setPerimeterField(state, "perimeter-height", Infinity)).toBe(state);
    expect(dragPerimeterInvariant(state, "invariant.area.width.999", { x: 30, y: 0 })).toBe(state);
    expect(dragPerimeterInvariant(state, "invariant.area.width.0", { x: NaN, y: 0 })).toBe(state);
    expect(dragPerimeterInvariant(state, "invariant.area.width.000", { x: 30, y: 0 })).toBe(state);
  });

  it("keeps the same quantity through every square-making animation frame and shared history", () => {
    for (const invariant of ["perimeter", "area"] as const) {
      const start = createPerimeterState(), command = action(`perimeter-square-${invariant}`), end = command.run(start, { selected: "object.0" });
      const snapshot: PlanarSnapshot = { current: start, past: [], future: [], motion: null };
      const playback = planarCommit(snapshot, start, end, { id: command.id, duration: command.duration!, now: 100 });
      for (const progress of [0, 0.1, 0.5, 0.9, 1]) {
        const frame = command.interpolate!(start, end, progress);
        expect(isValidPerimeterState(frame)).toBe(true);
        expect(constructionMeasurements(constructionObject(frame)!)[invariant]).toBeCloseTo(constructionMeasurements(constructionObject(start)!)[invariant], 7);
      }
      expect(perimeterRectangle(end)!.width).toBeCloseTo(perimeterRectangle(end)!.height, 9);
      const paused = planarPause(playback, 900, true), replay = JSON.parse(JSON.stringify(paused));
      expect(planarFrame(replay, scene, 5000)).toEqual(planarFrame(paused, scene, 900));
      expect(planarHistory(playback, "undo").current).toEqual(start);
      expect(planarHistory(planarHistory(playback, "undo"), "redo").current).toEqual(end);
    }
  });

  it("shows deformation handles only in their explicit editable operation and restores ordinary editing on exit", () => {
    const state = run("construction-edit", createPerimeterState());
    for (const operation of ["perimeter-fixed-perimeter", "perimeter-fixed-area"]) {
      const active = draw(state, { selected: "object.0", operation });
      expect(active.querySelectorAll("[data-perimeter-invariant-handle]")).toHaveLength(2);
      expect(active.querySelectorAll("[data-construction-edit-handle]")).toHaveLength(0);
      expect(draw(state, { selected: "object.0", operation, editable: false }).querySelectorAll("[data-perimeter-invariant-handle]")).toHaveLength(0);
      expect(draw(state, { selected: null, operation }).querySelectorAll("[data-perimeter-invariant-handle]")).toHaveLength(0);
    }
    expect(draw(state, { selected: "object.0" }).querySelectorAll("[data-construction-edit-handle]")).toHaveLength(4);
    expect(draw(state, { selected: "object.0" }).querySelectorAll("[data-perimeter-invariant-handle]")).toHaveLength(0);
    const observed = run("construction-measures", state);
    expect(draw(observed, { selected: "object.0", operation: "perimeter-fixed-area" }).textContent).toContain("S = 24 u²");
    expect(scene.contextActions!(state, "invariant.area.height.0")!.items).toEqual(scene.contextActions!(state, "object.0")!.items);
  });
});
