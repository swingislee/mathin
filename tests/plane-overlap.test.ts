import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { constructionArea, constructionObject, constructionObjects, worldVertices } from "@/features/tools/plane-construction/model";
import { convexRegions, regionsArea } from "@/features/tools/plane-relations/geometry";
import { addOverlapMaterial, assignOverlap, createOverlapGeometry, createOverlapState, dragOverlap, overlapModel, setOverlapField } from "@/features/tools/plane-overlap/model";
import { isValidOverlapState } from "@/features/tools/plane-overlap/validation";
import { planeOverlapScene } from "@/features/tools/plane-overlap/scenes";

const rectangle = (x: number, y: number, width: number, height = width) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const action = (id: string) => [...planeOverlapScene.actions!, ...planeOverlapScene.operations!.flatMap((operation) => operation.actions ?? [])].find((entry) => entry.id === id)!;
const context = { selected: null };
const valid = (state: ReturnType<typeof createOverlapState>) => expect(isValidOverlapState(state)).toBe(true);
const noInteriorOverlap = (pieces: ReturnType<typeof rectangle>[]) => pieces.forEach((a, i) => pieces.slice(i + 1).forEach((b) => expect(constructionArea(convexRegions(a, b).intersection)).toBeLessThan(1e-6)));

describe("convex paper intersection, union and difference", () => {
  it("computes actual areas with either winding and returns disjoint pieces", () => {
    const first = rectangle(0, 0, 100), second = rectangle(50, 50, 100);
    for (const a of [first, [...first].reverse()]) for (const b of [second, [...second].reverse()]) {
      const regions = convexRegions(a, b);
      expect(constructionArea(regions.intersection)).toBeCloseTo(2500, 8);
      expect(regionsArea(regions.difference)).toBeCloseTo(7500, 8);
      expect(regionsArea(regions.union)).toBeCloseTo(17500, 8);
      noInteriorOverlap(regions.difference); noInteriorOverlap(regions.union);
    }
  });

  it("preserves holes and disconnected parts instead of joining across empty space", () => {
    const outer = rectangle(0, 0, 100), inner = rectangle(25, 25, 50);
    const hole = convexRegions(outer, inner);
    expect(hole.difference).toHaveLength(4);
    expect(regionsArea(hole.difference)).toBe(7500);
    hole.difference.forEach((piece) => expect(constructionArea(convexRegions(piece, inner).intersection)).toBe(0));
    noInteriorOverlap(hole.difference);
    const split = convexRegions(outer, rectangle(40, -20, 20, 140));
    expect(split.difference).toHaveLength(2);
    expect(regionsArea(split.difference)).toBe(8000);
    noInteriorOverlap(split.difference);
  });

  it("handles separation, shared edges, tangency, identical and contained papers", () => {
    const a = rectangle(0, 0, 100);
    for (const b of [rectangle(200, 0, 100), rectangle(100, 0, 100), rectangle(100, 100, 100)]) {
      const regions = convexRegions(a, b);
      expect(regions.intersection).toEqual([]); expect(regionsArea(regions.difference)).toBe(10000); expect(regionsArea(regions.union)).toBe(20000);
    }
    expect(convexRegions(a, a).difference).toEqual([]);
    expect(regionsArea(convexRegions(a, a).union)).toBe(10000);
    const contained = convexRegions(a, rectangle(-10, -10, 120));
    expect(constructionArea(contained.intersection)).toBe(10000); expect(contained.difference).toEqual([]); expect(regionsArea(contained.union)).toBe(14400);
  });

  it("uses rotated contours, not axis-aligned bounds", () => {
    const square = rectangle(0, 0, 100), rotated = square.map((point) => ({ x: 50 + ((point.x - 50) - (point.y - 50)) / Math.SQRT2, y: 50 + ((point.x - 50) + (point.y - 50)) / Math.SQRT2 }));
    const model = convexRegions(square, rotated), expected = 10000 - 2 * (100 - 50 * Math.SQRT2) ** 2;
    expect(constructionArea(model.intersection)).toBeCloseTo(expected, 8);
    expect(regionsArea(model.union) + constructionArea(model.intersection)).toBeCloseTo(20000, 8);
    expect(regionsArea(model.difference) + constructionArea(model.intersection)).toBeCloseTo(10000, 8);
  });

  it("keeps finite conserved regions near parallel boundaries over varied exact poses", () => {
    const first = rectangle(100, 120, 260, 140);
    for (const angle of [1e-9, 17, 45, 89.99999999, 137, 180]) for (const offset of [-300, -80, 0, 75, 280]) {
      const radians = angle * Math.PI / 180;
      const second = rectangle(-90, -70, 180, 140).map((point) => ({ x: 245 + offset + point.x * Math.cos(radians) - point.y * Math.sin(radians), y: 210 + point.x * Math.sin(radians) + point.y * Math.cos(radians) }));
      const regions = convexRegions(first, second), overlap = constructionArea(regions.intersection);
      expect(regionsArea(regions.difference) + overlap).toBeCloseTo(constructionArea(first), 6);
      expect(regionsArea(regions.union) + overlap).toBeCloseTo(constructionArea(first) + constructionArea(second), 6);
      expect([...regions.intersection, ...regions.difference.flat()].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    }
  });

  it("allows independent paper dimensions, A/B assignment and direct movement of either paper", () => {
    let state = createOverlapState(); valid(state);
    expect(constructionObject(state, state.params.pairA)!.vertices.length).toBe(4);
    expect(constructionObject(state, state.params.pairB)!.vertices.length).toBe(3);
    const initial = overlapModel(state)!;
    state = dragOverlap(state, `object.${state.params.pairA}`, { x: 0, y: 0 }, { x: -150, y: 80 }); valid(state);
    expect(overlapModel(state)!.intersectionArea).not.toBeCloseTo(initial.intersectionArea);
    const second = constructionObject(state, state.params.pairB)!;
    state = setOverlapField(state, "width", 450); valid(state);
    expect(constructionObject(state, second.id)).toEqual(second);
    expect(overlapModel(state)!.areaA).not.toBeCloseTo(initial.areaA);
    state = dragOverlap(state, `object.${state.params.pairB}`, { x: 0, y: 0 }, { x: 35, y: -25 }); valid(state);
    expect(constructionObject(state)!.id).toBe(second.id);
  });

  it("keeps the current pair while adding, copying or moving other paper", () => {
    let state = createOverlapState(), original = overlapModel(state)!;
    state = addOverlapMaterial(state, "pentagon"); valid(state);
    const third = state.params.active;
    expect(state.params.pairA).toBe(0); expect(state.params.pairB).toBe(1);
    state = dragOverlap(state, `object.${third}`, { x: 0, y: 0 }, { x: 100, y: 50 }); valid(state);
    expect(overlapModel(state)).toEqual(original);
    state = action("construction-duplicate").run(state, context); valid(state);
    expect(overlapModel(state)).toEqual(original);
    state = assignOverlap(state, "pairA"); valid(state);
    expect(state.params.pairA).toBe(state.params.active); expect(state.params.pairB).toBe(1);
    expect(assignOverlap(state, "pairB")).toBe(state);
    original = overlapModel(state)!; expect(original.a).toEqual(worldVertices(constructionObject(state)!));
  });

  it("removes only missing pair references, retaining the other slot and all other paper", () => {
    let state = createOverlapState(); const remainingId = state.params.pairA;
    state = setOverlapField(state, "region", 3);
    state = action("construction-remove").run(state, context); valid(state);
    expect(state.params.pairA).toBe(remainingId); expect(state.params.pairB).toBe(-1); expect(overlapModel(state)).toBeNull();
    state = addOverlapMaterial(state, "pentagon"); valid(state);
    expect(state.params.pairB).toBe(-1);
    state = assignOverlap(state, "pairB"); valid(state);
    expect(state.params.region).toBe(3); expect(overlapModel(state)).not.toBeNull();
  });

  it("rejects concavity, self-crossings, circles and invalid edits atomically", () => {
    const start = createOverlapState();
    expect(createOverlapGeometry(start, "polygon", [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 200 }])).toBeNull();
    expect(createOverlapGeometry(start, "polygon", [{ x: 0, y: 0 }, { x: 200, y: 200 }, { x: 200, y: 0 }, { x: 0, y: 200 }])).toBeNull();
    expect(createOverlapGeometry(start, "circle", [{ x: 10, y: 10 }, { x: 80, y: 20 }])).toBeNull();
    const state = { ...start, flags: { ...start.flags, edit: true } }, object = constructionObject(state, 0)!, point = worldVertices(object)[1];
    expect(dragOverlap(state, "vertex.0.1", point, { x: -200, y: 130 })).toBe(state);
    expect(constructionObjects(state)).toHaveLength(2);
  });

  it("keeps convexity after a collinear edit point is inserted and removes points safely", () => {
    let state = createOverlapState(); state = { ...state, flags: { ...state.flags, edit: true } };
    state = action("construction-insert-vertex").run(state, { selected: "edge.0.0" }); valid(state);
    expect(constructionObject(state, 0)!.vertices).toHaveLength(5);
    const model = overlapModel(state)!;
    state = action("construction-remove-vertex").run(state, { selected: "vertex.0.1" }); valid(state);
    expect(constructionObject(state, 0)!.vertices).toHaveLength(4);
    expect(overlapModel(state)!.intersectionArea).toBeCloseTo(model.intersectionArea, 8);
  });

  it("preserves valid animation endpoints, undo source and exact save/restore", () => {
    const from = setOverlapField(createOverlapState(), "region", 1), rotate = action("construction-rotate"), to = rotate.run(from, context);
    valid(from); valid(to);
    for (const t of [0.2, 0.5, 0.8]) {
      const frame = rotate.interpolate!(from, to, t); valid(frame);
      const model = overlapModel(frame)!;
      expect(model.unionArea + model.intersectionArea).toBeCloseTo(model.areaA + model.areaB, 7);
      expect(model.differenceArea + model.intersectionArea).toBeCloseTo(model.areaA, 7);
    }
    const restored = JSON.parse(JSON.stringify(to)); valid(restored); expect(overlapModel(restored)).toEqual(overlapModel(to));
    expect(from.params.region).toBe(1); expect(from.params["angle.1"]).toBe(0);
    expect(Object.keys(to.params).some((key) => /Area|area|intersection|union/.test(key))).toBe(false);
  });

  it("rejects malformed refs, duplicate pair slots, unsupported regions and unknown data", () => {
    const start = createOverlapState();
    const mutations: Record<string, number>[] = [{ pairA: 999 }, { pairB: 0 }, { pairA: -2 }, { region: 1.5 }, { region: 4 }, { extra: 1 }, { "frameA.1": 1 }];
    for (const params of mutations) {
      expect(isValidOverlapState({ ...start, params: { ...start.params, ...params } })).toBe(false);
    }
    const missing = structuredClone(start); delete missing.params.pairA; expect(isValidOverlapState(missing)).toBe(false);
  });

  it("exposes explicit pair labels, a single geometric region fill and reusable nearby actions", () => {
    const state = setOverlapField(createOverlapState(), "region", 3), api: PlanarDrawingApi = { locale: "en", selected: "object.1", editable: true,
      bind: (_target, label = "") => ({ role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": false, "aria-disabled": false }) };
    const markup = renderToStaticMarkup(planeOverlapScene.draw(state, api));
    expect(markup).toContain('data-overlap-region="3"'); expect(markup).toContain("A · 1"); expect(markup).toContain("B · 2");
    expect(markup).toContain("Difference: A outside B"); expect(markup).not.toContain("clipPath");
    const near = planeOverlapScene.contextActions!(state, "object.1")!;
    const ids = new Set([...planeOverlapScene.actions!.map((entry) => entry.id), ...planeOverlapScene.operations!.map((entry) => entry.id)]);
    expect(near.items.every((entry) => ids.has(entry.id))).toBe(true);
    expect(action("overlap-pairB").active!(state)).toBe(true); expect(planeOverlapScene.contextActions!(state, null)).toBeNull();
    const panel = planeOverlapScene.operations!.find((operation) => operation.id === "regions")!;
    expect(panel.actions!.map((entry) => entry.id)).toEqual(["overlap-pairA", "overlap-pairB"]);
    expect(planeOverlapScene.actions!.some((entry) => entry.id.startsWith("overlap-pair"))).toBe(false);
    expect(near.items.map((entry) => entry.id)).toEqual(["regions", "construction-edit", "rotate", "construction-duplicate"]);
    const icons = near.items.map((entry) => entry.kind === "operation" ? planeOverlapScene.operations!.find((operation) => operation.id === entry.id)!.icon : action(entry.id).icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("delivers private SQL helpers with strict v2 shells without editing the shared dispatcher", () => {
    const sql = readFileSync("supabase/migrations/20261002000300_tool_plane_relations_overlap.sql", "utf8");
    for (const domain of ["relations", "overlap"]) for (const scope of ["state", "scene"]) {
      const name = `public.tool_plane_${domain}_${scope}_is_valid`;
      expect(sql).toContain(`create function ${name}(s jsonb)`);
      expect(sql).toContain(`revoke all on function ${name}(jsonb) from public,anon,authenticated,service_role;`);
    }
    expect(sql).toContain("'plane-area-relations-lesson-v2'"); expect(sql).toContain("'plane-overlap-lesson-v2'");
    expect(sql.match(/exception when others then return false/g)).toHaveLength(4);
    expect(sql).not.toContain("create or replace"); expect(sql).not.toContain("tool_scene_is_valid");
  });
});
