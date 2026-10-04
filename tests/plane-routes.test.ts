import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PlanarState } from "@/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { planarCommit, planarFrame, planarHistory } from "@/features/tools/planar-kit/presentation";
import { resolvePlanarContextActions } from "@/features/tools/planar-kit/context-actions";
import { addGridCandidate, addReflectionCandidate, appendGridVisit, constructReflectionRoute, createGridRouteState, createReflectionRouteState, dragGridRoute, dragReflectionRoute, fitReflectionView, gridCandidate, gridCandidateIds, gridFromStage, gridRouteAnalysis, gridToStage, removeGridCandidate, removeReflectionCandidate, resizeGridRoutes, revealGridNumber, reflectionCandidateIds, reflectionCandidateLength, reflectionContact, reflectionDirection, reflectionFoldPoint, reflectionFromStage, reflectionMinimum, reflectionMirror, reflectionToStage, selectGridCandidate, selectReflectionCandidate, setGridPoint, setGridRouteField, setGridRouteFlag, setReflectionRouteField, setReflectionRouteFlag, shortenGridCandidate, toggleGridRoad } from "@/features/tools/plane-route-workbench/model";
import { isValidRouteState } from "@/features/tools/plane-route-workbench/validation";
import { planeRouteScenes } from "@/features/tools/plane-route-workbench/scenes";

const valid = (state: PlanarState) => expect(isValidRouteState(state)).toBe(true);
const walk = (state: PlanarState, points: readonly [number, number][]) => points.reduce((current, [x, y]) => appendGridVisit(current, { x, y }), state);
const freeze = <T>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };

describe("independent teacher-built lattice candidates", () => {
  it("starts with explicit endpoints, one candidate, and hidden conclusions", () => {
    const state = createGridRouteState(); valid(state);
    expect(state.points.start).toEqual({ x: 0, y: 0 }); expect(state.points.end).toEqual({ x: 4, y: 3 });
    expect(gridCandidateIds(state)).toEqual([0]); expect(state.flags.measures).toBe(false); expect(state.flags.shortest).toBe(false); expect(state.params.numberStep).toBe(-1);
  });
  it("allows a second candidate to reuse every edge of the first", () => {
    const first = walk(createGridRouteState(), [[2, 0], [2, 2]]), second = walk(addGridCandidate(first), [[2, 0], [2, 2]]);
    valid(second); expect(gridCandidate(second, 0)).toEqual(gridCandidate(second, 1)); expect(gridCandidate(first, 0)).toHaveLength(5);
  });
  it("duplicates independently, removes one candidate and never reuses its ID", () => {
    const first = walk(createGridRouteState(), [[2, 0]]), copied = appendGridVisit(addGridCandidate(first, true), { x: 3, y: 0 });
    expect(gridCandidate(copied, 0)).toHaveLength(3); expect(gridCandidate(copied, 1)).toHaveLength(4);
    const next = addGridCandidate(removeGridCandidate(copied)); valid(next); expect(gridCandidateIds(next)).toEqual([0, 2]);
  });
  it("supports an empty candidate tray and the eight-candidate bound", () => {
    let state = removeGridCandidate(createGridRouteState()); valid(state); expect(state.params.active).toBe(-1);
    for (let i = 0; i < 8; i++) state = addGridCandidate(state);
    valid(state); expect(gridCandidateIds(state)).toHaveLength(8); expect(addGridCandidate(state)).toBe(state);
  });
  it("edits both endpoints and can follow left/down directions", () => {
    let state = resizeGridRoutes(createGridRouteState(), 2, 2);
    state = setGridPoint(state, "start", { x: 2, y: 2 }); state = setGridPoint(state, "end", { x: 0, y: 0 });
    state = walk(state, [[0, 2], [0, 0]]); valid(state); expect(gridCandidate(state)).toHaveLength(5);
    expect(gridRouteAnalysis(state).count).toBe(BigInt(6)); expect(gridRouteAnalysis(state).distance).toBe(4);
  });
  it("changes a start to an existing route node without losing the valid suffix", () => {
    const state = walk(createGridRouteState(), [[3, 0], [3, 2]]), changed = setGridPoint(state, "start", { x: 2, y: 0 });
    valid(changed); expect(gridCandidate(changed)).toEqual([{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }]);
  });
  it("retains unaffected candidates and trims only at the newly closed road", () => {
    const first = walk(createGridRouteState(), [[3, 0]]), both = walk(addGridCandidate(first), [[0, 2]]);
    const next = toggleGridRoad(both, { x: 1, y: 0 }, { x: 2, y: 0 }); valid(next);
    expect(gridCandidate(next, 0)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]); expect(gridCandidate(next, 1)).toEqual(gridCandidate(both, 1));
    expect(planarHistory(planarCommit({ current: both, past: [], future: [], motion: null }, both, next), "undo").current).toEqual(both);
  });
  it("resizes without replacing candidate identities or valid prefixes", () => {
    const first = walk(createGridRouteState(), [[4, 0], [4, 2]]), both = walk(addGridCandidate(first), [[0, 1], [2, 1]]);
    const changed = resizeGridRoutes(both, 3, 2); valid(changed);
    expect(gridCandidateIds(changed)).toEqual([0, 1]); expect(gridCandidate(changed, 0)).toHaveLength(4); expect(gridCandidate(changed, 1)).toEqual(gridCandidate(both, 1)); expect(changed.points.end).toEqual({ x: 3, y: 2 });
  });
  it("supports four-direction detours and loops without borrowing another candidate's state", () => {
    const state = walk(setGridRouteField(createGridRouteState(), "direction", 1), [[1, 0], [1, 1], [0, 1], [0, 0]]); valid(state);
    expect(gridCandidate(state)).toHaveLength(5); expect(gridCandidate(shortenGridCandidate(state))).toHaveLength(4); expect(gridCandidate(shortenGridCandidate(state, true))).toEqual([state.points.start]);
  });
  it("computes shortest distance/counts for closed roads and an optional required vertex", () => {
    const grid = resizeGridRoutes(createGridRouteState(), 2, 2);
    expect(gridRouteAnalysis(grid)).toMatchObject({ distance: 4, count: BigInt(6) });
    expect(gridRouteAnalysis(toggleGridRoad(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).count).toBe(BigInt(3));
    const through = setGridRouteFlag(setGridPoint(grid, "required", { x: 1, y: 1 }), "required", true);
    expect(gridRouteAnalysis(through).count).toBe(BigInt(4)); expect(gridRouteAnalysis(through).shortest).toContainEqual({ x: 1, y: 1 });
  });
  it("does not equate a necessary detour with a nonexistent monotone route", () => {
    let state = setGridPoint(resizeGridRoutes(createGridRouteState(), 2, 2), "end", { x: 2, y: 0 });
    state = toggleGridRoad(state, { x: 1, y: 0 }, { x: 2, y: 0 });
    expect(gridRouteAnalysis(state)).toMatchObject({ distance: null, count: BigInt(0), shortest: [] });
    expect(gridRouteAnalysis(setGridRouteField(state, "direction", 1)).distance).toBe(4);
  });
  it("handles coincident endpoints and a required out-and-back visit", () => {
    let state = setGridPoint(resizeGridRoutes(createGridRouteState(), 2, 2), "end", { x: 0, y: 0 });
    expect(gridRouteAnalysis(state)).toMatchObject({ distance: 0, count: BigInt(1) });
    state = setGridRouteFlag(setGridPoint(setGridRouteField(state, "direction", 1), "required", { x: 1, y: 1 }), "required", true);
    expect(gridRouteAnalysis(state)).toMatchObject({ distance: 4, count: BigInt(4) }); valid(state);
  });
  it("reveals counts only on teacher action and resets revealed counts after constraints change", () => {
    const state = revealGridNumber(createGridRouteState()); expect(state.params.numberStep).toBe(0);
    expect(setGridRouteFlag(state, "required", true).params.numberStep).toBe(-1);
    expect(setGridRouteField(state, "columns", 5).params.numberStep).toBe(-1);
  });
  it("keeps direct grid gestures aligned with the same exact lattice", () => {
    const state = createGridRouteState(), point = { x: 3, y: 0 }, at = gridToStage(state, point);
    expect(gridFromStage(state, at)).toEqual(point);
    const moved = dragGridRoute(state, "node.0_0", at); valid(moved); expect(gridCandidate(moved)).toHaveLength(4);
    const selected = selectGridCandidate(addGridCandidate(moved), 0); expect(selected.params.active).toBe(0);
  });
  it("bounds payload visits while retaining legal loops", () => {
    let state = setGridRouteField(createGridRouteState(), "direction", 1);
    for (let i = 1; i < 480; i++) state = appendGridVisit(state, { x: i % 2, y: 0 });
    valid(state); expect(state.marks).toHaveLength(480); expect(appendGridVisit(state, { x: 0, y: 0 })).toBe(state); expect(addGridCandidate(state)).toBe(state);
  });
  it("never mutates an existing grid or its candidate records", () => {
    const state = freeze(walk(createGridRouteState(), [[2, 0]]));
    valid(addGridCandidate(state)); valid(resizeGridRoutes(state, 6, 6)); valid(toggleGridRoad(state, { x: 1, y: 0 }, { x: 2, y: 0 }));
  });
});

describe("arbitrary-axis reflection candidates", () => {
  it("starts with genuine points and a line, with answer observations hidden", () => {
    const state = createReflectionRouteState(); valid(state);
    expect(state.flags.mirror).toBe(false); expect(state.flags.shortest).toBe(false); expect(state.flags.measures).toBe(false); expect(reflectionCandidateIds(state)).toEqual([0]);
  });
  it.each([-180, -135, -90, -35, 0, 50, 90, 135, 180])("keeps true reflection and contact geometry at %s degrees", (angle: number) => {
    const state = setReflectionRouteField(createReflectionRouteState(), "axisAngle", angle), point = reflectionContact(state), mirror = reflectionMirror(state), direction = reflectionDirection(state);
    valid(state); expect((point.x - state.points.axis.x) * direction.y - (point.y - state.points.axis.y) * direction.x).toBeCloseTo(0, 10);
    expect(Math.hypot(point.x - state.points.b.x, point.y - state.points.b.y)).toBeCloseTo(Math.hypot(point.x - mirror.x, point.y - mirror.y), 10);
    expect(reflectionFoldPoint({ ...state, phase: 1 })).toEqual(mirror);
  });
  it("preserves independently editable contacts while endpoints and axis remain shared", () => {
    const initial = createReflectionRouteState(), added = addReflectionCandidate(initial), second = setReflectionRouteField(added, "contact", 7);
    valid(second); expect(second.params["contact.0"]).toBe(-2); expect(second.params["contact.1"]).toBe(7);
    expect(selectReflectionCandidate(second, 0).params.active).toBe(0);
    const next = addReflectionCandidate(removeReflectionCandidate(second)); expect(reflectionCandidateIds(next)).toEqual([0, 2]);
  });
  it("allows an empty candidate tray and at most eight independent contacts", () => {
    let state = removeReflectionCandidate(createReflectionRouteState()); valid(state);
    for (let i = 0; i < 8; i++) state = addReflectionCandidate(state);
    valid(state); expect(addReflectionCandidate(state)).toBe(state); expect(reflectionCandidateIds(state)).toHaveLength(8);
    expect(reflectionCandidateIds(addReflectionCandidate(setReflectionRouteField(createReflectionRouteState(), "contact", 5000)))).toHaveLength(2);
  });
  it("uses the mirror minimum for same-side endpoints without selecting a candidate for the teacher", () => {
    const state = createReflectionRouteState(), minimum = reflectionMinimum(state);
    expect(minimum).toMatchObject({ from: 1, to: 1, relation: "same-side" }); expect(minimum.length).toBeCloseTo(Math.sqrt(162));
    expect(reflectionCandidateLength(setReflectionRouteField(state, "contact", minimum.from))).toBeCloseTo(minimum.length);
    expect(state.params["contact.0"]).toBe(-2);
  });
  it("uses a straight crossing when endpoints lie on opposite sides", () => {
    const state = setReflectionRouteField(createReflectionRouteState(), "bY", -4), minimum = reflectionMinimum(state);
    expect(minimum.relation).toBe("opposite-side"); expect(minimum.length).toBeCloseTo(Math.hypot(9, 9));
    expect(reflectionCandidateLength(setReflectionRouteField(state, "contact", minimum.from))).toBeCloseTo(minimum.length);
  });
  it("preserves every minimizer for two on-axis endpoints and handles coincident points", () => {
    let state = setReflectionRouteField(setReflectionRouteField(createReflectionRouteState(), "aY", 0), "bY", 0);
    expect(reflectionMinimum(state)).toEqual({ from: -4, to: 5, length: 9, relation: "on-axis" });
    state = setReflectionRouteField(state, "bX", -4); expect(reflectionMinimum(state)).toEqual({ from: -4, to: -4, length: 0, relation: "on-axis" }); valid(state);
  });
  it("has the correct endpoint minimum when only one point lies on the line", () => {
    const state = setReflectionRouteField(createReflectionRouteState(), "aY", 0), minimum = reflectionMinimum(state);
    expect(minimum.from).toBe(-4); expect(minimum.length).toBeCloseTo(Math.hypot(9, 4));
  });
  it("keeps drag and exact contact distances equivalent for vertical axes beyond the old range", () => {
    const state = setReflectionRouteField(createReflectionRouteState(), "axisAngle", 90), pixels = 440 / state.params.viewSpan;
    const next = dragReflectionRoute(state, "contact.0", { x: 0, y: 0 }, { x: 0, y: -20 * pixels }); valid(next);
    expect(next.params["contact.0"]).toBeCloseTo(18); expect(reflectionContact(next).y).toBeCloseTo(18);
    expect(dragReflectionRoute(state, "contact.0", { x: 0, y: 0 }, { x: 30, y: 0 }).params["contact.0"]).toBeCloseTo(-2);
  });
  it("fits an entire arbitrary-axis reflection orbit without changing world geometry", () => {
    const state = fitReflectionView(setReflectionRouteField(createReflectionRouteState(), "contact", 800));
    expect(state.params["contact.0"]).toBe(800);
    for (let angle = -180; angle <= 180; angle += 30) {
      const next = setReflectionRouteField(state, "axisAngle", angle);
      for (const point of [reflectionContact(next), reflectionMirror(next), next.points.a, next.points.b]) {
        const at = reflectionToStage(next, point); expect(at.x).toBeGreaterThan(100); expect(at.x).toBeLessThan(800); expect(at.y).toBeGreaterThan(80); expect(at.y).toBeLessThan(600);
        const roundtrip = reflectionFromStage(next, at); expect(roundtrip.x).toBeCloseTo(point.x, 9); expect(roundtrip.y).toBeCloseTo(point.y, 9);
      }
    }
  });
  it("constructs a genuine line from a teacher drag and refuses a zero-length direction", () => {
    const state = createReflectionRouteState(), first = reflectionToStage(state, { x: 1, y: 2 }), last = reflectionToStage(state, { x: 1, y: 5 });
    expect(constructReflectionRoute(state, "axis", [first, first])).toBeNull();
    const next = constructReflectionRoute(state, "axis", [first, last])!; valid(next); expect(next.params.axisAngle).toBeCloseTo(90); expect(next.points.axis.x).toBeCloseTo(1); expect(next.points.axis.y).toBeCloseTo(2);
    expect(next.params["contact.0"]).toBe(-2);
  });
  it("keeps exact edits and captured inputs detached", () => {
    const state = freeze(createReflectionRouteState()); valid(addReflectionCandidate(state, true)); valid(setReflectionRouteField(state, "aX", 300)); valid(setReflectionRouteFlag(state, "mirror", true));
  });
});

describe("route descriptors and shared action endpoints", () => {
  const api = (editable = true, operation: string | null = null): PlanarDrawingApi => ({ locale: "en", selected: null, editable, operation,
    bind: (_target, label = "") => ({ role: "button", tabIndex: editable ? 0 : -1, "aria-label": label, "aria-pressed": false, "aria-disabled": !editable }) });
  it("keeps measures, counts, shortest routes and mirror observations hidden initially", () => {
    for (const definition of planeRouteScenes) {
      const markup = renderToStaticMarkup(definition.draw(definition.create(), api()));
      expect(markup).not.toMatch(/data-grid-shortest|data-grid-count|data-reflection-shortest|data-reflection-mirror| · ≈| · [0-9]+ u/);
      expect(markup).toContain("data-route-candidates");
    }
  });
  it("draws accumulated candidates and keeps explicit observations when the panel closes", () => {
    const [gridDefinition, reflectionDefinition] = planeRouteScenes;
    const grid = setGridRouteFlag(revealGridNumber(addGridCandidate(createGridRouteState())), "shortest", true);
    const gridMarkup = renderToStaticMarkup(gridDefinition.draw(grid, api()));
    expect(gridMarkup).toContain('data-grid-candidate="0"'); expect(gridMarkup).toContain('data-grid-candidate="1"'); expect(gridMarkup).toContain("data-grid-shortest"); expect(gridMarkup).toContain("data-grid-count");
    const state = setReflectionRouteFlag(setReflectionRouteFlag(addReflectionCandidate(createReflectionRouteState()), "mirror", true), "measures", true);
    const markup = renderToStaticMarkup(reflectionDefinition.draw(state, api(false)));
    expect(markup).toContain('data-reflection-candidate="1"'); expect(markup).toContain("data-reflection-mirror"); expect(markup).toContain(" · ≈"); expect(markup).not.toContain("data-route-axis-handles");
  });
  it("exposes full axis and contact precision and resolves contextual actions to the same callbacks", () => {
    const [gridDefinition, reflectionDefinition] = planeRouteScenes;
    const axis = reflectionDefinition.operations!.find((operation) => operation.id === "axis")!;
    expect(axis.fields!.find((field) => field.key === "axisAngle")).toMatchObject({ min: -180, max: 180 });
    const state = reflectionDefinition.create();
    expect(renderToStaticMarkup(reflectionDefinition.draw(state, api(true, "axis")))).toContain("data-route-axis-handles");
    expect(renderToStaticMarkup(reflectionDefinition.draw(state, api(false, "axis")))).not.toContain("data-route-axis-handles");
    expect(resolvePlanarContextActions(reflectionDefinition, state, "contact.0")!.items.map((item) => item.item.id)).toEqual(["routes", "reflection-route-copy", "reflection-route-remove"]);
    expect(resolvePlanarContextActions(gridDefinition, gridDefinition.create(), "route.0")!.items.map((item) => item.item.id)).toEqual(["routes", "grid-route-copy", "grid-route-remove"]);
  });
  it("keeps every action/material/toggle endpoint within its strict domain contract", () => {
    for (const definition of planeRouteScenes) {
      const state = definition.id === "53-create" ? appendGridVisit(definition.create(), { x: 2, y: 0 }) : definition.create();
      for (const action of [...definition.actions ?? [], ...definition.operations?.flatMap((operation) => operation.actions ?? []) ?? []]) {
        const next = action.run(state, { selected: "route.0" }); valid(next);
        if (action.interpolate) for (const phase of [0, 0.37, 1]) valid(action.interpolate(state, next, phase));
      }
      for (const material of definition.materials ?? []) valid(material.add(state));
      for (const toggle of definition.toggles ?? []) valid(definition.setFlag!(state, toggle.key, !state.flags[toggle.key]));
    }
  });
  it("replays exact endpoints and keeps one undo step when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      for (const definition of planeRouteScenes) {
        const state = definition.id === "53-create" ? appendGridVisit(definition.create(), { x: 2, y: 0 }) : definition.create();
        const action = definition.operations!.flatMap((operation) => operation.actions ?? []).find((entry) => entry.id === (definition.id === "53-create" ? "grid-route-replay" : "reflection-show-mirror"))!;
        const endpoint = action.run(state, { selected: null }), snapshot = planarCommit({ current: state, past: [], future: [], motion: null }, state, endpoint, { id: action.id, duration: action.duration!, now: 100 });
        expect(snapshot.motion!.id).toMatch(/^[0-9a-f-]{36}$/); expect(planarFrame(snapshot, definition, 100 + action.duration!)).toEqual(endpoint);
        valid(planarFrame(snapshot, definition, 600)); expect(planarFrame(JSON.parse(JSON.stringify(snapshot)), definition, 600)).toEqual(planarFrame(snapshot, definition, 600));
        if (JSON.stringify(state) !== JSON.stringify(endpoint)) expect(planarHistory(snapshot, "undo").current).toEqual(state);
      }
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("strict versioned route materials", () => {
  it.each([createGridRouteState, createReflectionRouteState])("rejects unknown top-level fields and malformed containers", (create: () => PlanarState) => {
    for (const value of [null, [], {}, { ...create(), extra: 1 }, { ...create(), marks: {} }, { ...create(), flags: null }, { ...create(), phase: NaN }, { ...create(), phase: 2 }]) expect(isValidRouteState(value)).toBe(false);
    const state = create(); state.params.extra = 1; expect(isValidRouteState(state)).toBe(false);
    const flag = create(); flag.flags.extra = false; expect(isValidRouteState(flag)).toBe(false);
    const point = create(); point.points.extra = { x: 0, y: 0 }; expect(isValidRouteState(point)).toBe(false);
  });
  it("rejects malformed, disconnected, backwards and blocked saved grid visits", () => {
    const base = walk(createGridRouteState(), [[2, 0]]);
    for (const change of [
      (s: PlanarState) => { s.marks[1] = "visit.0.1.2_1"; }, (s: PlanarState) => { s.marks[1] = s.marks[0]; },
      (s: PlanarState) => { s.params["h.0"] = 1; }, (s: PlanarState) => { s.params["h.0"] = 16; },
      (s: PlanarState) => { s.params["visits.0"] = 4; }, (s: PlanarState) => { s.params.active = 5; },
      (s: PlanarState) => { s.params.nextId = 0; }, (s: PlanarState) => { s.points.start.x = 0.5; },
      (s: PlanarState) => { s.marks = ["visit.0.0.0_0", "visit.0.1.1_0", "visit.0.2.0_0"]; },
    ]) { const state = structuredClone(base); change(state); expect(isValidRouteState(state)).toBe(false); }
  });
  it("rejects cross-purpose state and out-of-bounds reflection fields", () => {
    const reflected = createReflectionRouteState();
    expect(isValidRouteState({ ...reflected, sceneId: "53-create" })).toBe(false);
    for (const [key, value] of [["axisAngle", 181], ["contact.0", 5001], ["viewSpan", 0], ["viewX", 1001], ["active", -1]] as const) expect(isValidRouteState({ ...reflected, params: { ...reflected.params, [key]: value } })).toBe(false);
    expect(isValidRouteState({ ...reflected, marks: ["answer.1"] })).toBe(false);
  });
});
