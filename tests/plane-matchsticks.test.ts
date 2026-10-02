import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addMatchMaterial, captureMatchReference, clearMatchReference, clearMatches, createMatchState, dragMatch, duplicateMatch, liveMatches, matchFor, matchIds, referenceIds, removeMatch, setMatchField, settleMatch, turnMatch } from "@/features/tools/plane-matchsticks/model";
import { isValidMatchState } from "@/features/tools/plane-matchsticks/validation";
import { planeMatchsticksScene as definition } from "@/features/tools/plane-matchsticks/scene";
import { matchEndpoints } from "@/features/tools/plane-patterns/model";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { planarSnapshot, planarSnapshotForTool, planarStateSchema } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarFrame, planarHistory, planarPause } from "@/features/tools/planar-kit/presentation";

describe("open equal-length matchstick materials", () => {
  it("keeps one default stick and supports an exact empty start and add/remove/add without reusing identities", () => {
    const initial = createMatchState();
    expect(liveMatches(initial)).toHaveLength(1); expect(initial.flags.reference).toBe(false);
    const empty = removeMatch(initial, "stick.0");
    expect(isValidMatchState(empty)).toBe(true); expect(empty.params.active).toBe(-1);
    const next = addMatchMaterial(empty, "single");
    expect(matchIds(next)).toEqual([1]); expect(next.params.active).toBe(1);
    expect(planarStateSchema.safeParse(clearMatches(next)).success).toBe(true);
  });
  it("appends independent triangles, squares and true shared sides without replacing existing sticks", () => {
    let state = clearMatches(createMatchState());
    for (const [material, count] of [["triangle", 3], ["square", 4], ["shared", 10]] as const) {
      const before = liveMatches(state); state = addMatchMaterial(state, material);
      expect(liveMatches(state)).toHaveLength(before.length + count);
      expect(liveMatches(state).slice(0, before.length)).toEqual(before);
      for (const stick of liveMatches(state)) { const [a, b] = matchEndpoints(stick); expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(100, 10); }
      expect(isValidMatchState(state)).toBe(true);
    }
  });
  it("copies only the selected stick and rejects stale, malformed or missing local selections", () => {
    const initial = createMatchState(), copy = duplicateMatch(initial, "stick.0");
    expect(liveMatches(copy)).toHaveLength(2); expect(copy.params.active).toBe(1); expect(copy.points["stick.0"]).toEqual(initial.points["stick.0"]);
    for (const target of [null, "stick.-1", "stick.00", "stick.99", "other.0"]) {
      expect(duplicateMatch(initial, target)).toBe(initial); expect(removeMatch(initial, target)).toBe(initial);
    }
    expect(definition.selectionAfterChange!(initial, copy, "stick.0")).toBe("stick.1");
    const deleted = removeMatch(copy, "stick.1");
    expect(deleted.params.active).toBe(0); expect(definition.selectionAfterChange!(copy, deleted, "stick.1")).toBe("stick.0");
  });
  it("captures the teacher's current arrangement and retains reference sticks after deletion", () => {
    const initial = setMatchField(createMatchState(), "angle", 27), captured = captureMatchReference(initial);
    const moved = setMatchField(captured, "x", 700), removed = removeMatch(moved, "stick.0");
    expect(matchFor(removed, 0, true)).toEqual(matchFor(initial));
    expect(referenceIds(removed)).toEqual([0]); expect(liveMatches(removed)).toHaveLength(0);
    expect(isValidMatchState(removed)).toBe(true);
    const erased = clearMatchReference(removed);
    expect(referenceIds(erased)).toEqual([]); expect(erased.flags.reference).toBe(false);
  });
  it("crosses the ±180° pointer boundary continuously and preserves length and center", () => {
    const start = setMatchField(createMatchState(), "angle", 170), center = matchFor(start)!.center;
    const point = (angle: number) => ({ x: center.x + 78 * Math.cos(angle * Math.PI / 180), y: center.y + 78 * Math.sin(angle * Math.PI / 180) });
    const origin = point(170); let previous = start;
    for (const angle of [179, -179, -170, -90, 0, 90, 170, -170]) {
      const at = point(angle), next = dragMatch(start, "turn.0", at, { x: at.x - origin.x, y: at.y - origin.y }, previous);
      expect(Math.abs(next.params["angle.0"] - previous.params["angle.0"])).toBeLessThanOrEqual(90.001);
      expect(next.points["stick.0"]).toEqual(center); expect(isValidMatchState(next)).toBe(true); previous = next;
    }
    expect(previous.params["angle.0"]).toBeCloseTo(550);
  });
  it("snaps endpoints only on release and never snaps a rotation handle into translation", () => {
    let state = duplicateMatch(createMatchState(), "stick.0");
    state = setMatchField(setMatchField(state, "x", state.points["stick.0"].x + 105), "y", state.points["stick.0"].y + 4);
    const snapped = settleMatch(state, "stick.1")!;
    expect(snapped.points["stick.1"]).toEqual({ x: state.points["stick.0"].x + 100, y: state.points["stick.0"].y });
    expect(state.points["stick.1"]).not.toEqual(snapped.points["stick.1"]);
    expect(settleMatch(state, "turn.1")).toBeNull();
    expect(settleMatch({ ...state, flags: { ...state.flags, snap: false } }, "stick.1")).toBeNull();
  });
  it("supports 96 sticks and 96 independent references within the strict portable state budget", () => {
    let state = clearMatches(createMatchState());
    for (let i = 0; i < 96; i++) state = addMatchMaterial(state, "single");
    state = captureMatchReference(state);
    expect(matchIds(state)).toHaveLength(96); expect(referenceIds(state)).toHaveLength(96);
    expect(addMatchMaterial(state, "single")).toBe(state); expect(planarStateSchema.safeParse(state).success).toBe(true);
    for (const invalid of [
      { ...state, params: { ...state.params, extra: 1 } },
      { ...state, points: { ...state.points, "stick.999": { x: 100, y: 100 } } },
      { ...state, params: { ...state.params, active: state.params.nextId } },
      { ...state, params: { ...state.params, "angle.1": 36001 } },
      { ...state, flags: { ...state.flags, unsafe: true } },
    ]) expect(isValidMatchState(invalid)).toBe(false);
  });
  it("uses one animated endpoint for pause, classroom round trip, undo and final rendering", () => {
    const initial = createMatchState(), endpoint = turnMatch(initial, "stick.0", 45);
    const snapshot = planarCommit(planarSnapshot(initial), initial, endpoint, { id: "match-turn", duration: 900, now: 1000 });
    const halfway = planarFrame(snapshot, definition, 1450);
    expect(halfway.params["angle.0"]).toBeCloseTo(22.5);
    const paused = planarPause(snapshot, 1450, true);
    expect(planarFrame(paused, definition, 9999)).toEqual(halfway);
    expect(planarSnapshotForTool("plane-matchsticks", "plane-matchsticks-lesson-v2").safeParse(JSON.parse(JSON.stringify(snapshot))).success).toBe(true);
    expect(planarFrame(snapshot, definition, 1900)).toEqual(endpoint);
    expect(planarHistory(snapshot, "undo").current).toEqual(initial);
  });
  it("draws a rotation handle only during the explicit writable operation and no preset reference", () => {
    const api: PlanarDrawingApi = { locale: "en", selected: "stick.0", editable: true, bind: (_target, label = "") => ({ role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": false, "aria-disabled": false }) };
    const markup = (options: Partial<PlanarDrawingApi>) => renderToStaticMarkup(createElement("svg", null, definition.draw(createMatchState(), { ...api, ...options })));
    expect(markup({})).not.toContain("data-match-turn-handle");
    expect(markup({ operation: "rotate" })).toContain("data-match-turn-handle");
    expect(markup({ operation: "rotate", editable: false })).not.toContain("data-match-turn-handle");
    expect(markup({ operation: "rotate", selected: null })).not.toContain("data-match-turn-handle");
    expect(markup({})).not.toContain("data-match-reference");
  });
});
