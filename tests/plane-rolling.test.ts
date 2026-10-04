import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PlanarPoint as Point, PlanarState } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarFrame, planarHistory, planarPause } from "@/features/tools/planar-kit/presentation";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { addRollingPair, constructRollingPair, createRollingWorkbenchState, dragRollingPair, duplicateRollingPair, fitRollingView, interpolateRolling, removeRollingPair, rollCurrentPair, rollingExtent, rollingFromStage, rollingIds, rollingPair, rollingPairs, rollingPose, rollingScale, rollingToStage, rollingTracePoints, selectRollingPair, setRollingField, setRollingFlag } from "@/features/tools/plane-rolling-workbench/model";
import { planeRollingWorkbenchScene as scene } from "@/features/tools/plane-rolling-workbench/scenes";
import { isValidRollingWorkbenchState } from "@/features/tools/plane-rolling-workbench/validation";
import { planeRollingCases } from "./fixtures/plane-rolling-cases";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const api = (props: Partial<PlanarDrawingApi> = {}): PlanarDrawingApi => ({ locale: "zh", selected: null, editable: true,
  bind: (target, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? target, "aria-pressed": false, "aria-disabled": false }), ...props });
const markup = (state: PlanarState, props: Partial<PlanarDrawingApi> = {}) => renderToStaticMarkup(createElement("svg", {}, scene.draw(state, api(props))));
const poseAt = (state: PlanarState, angle: number) => { const pair = rollingPair(state)!; return rollingToStage(rollingPose({ ...pair, angle }).center, state); };
function gesture(initial: PlanarState, angles: number[]) {
  const down = poseAt(initial, rollingPair(initial)!.angle); let previous = initial;
  for (const angle of angles) { const at = poseAt(initial, angle); previous = dragRollingPair(initial, `roll.${initial.params.active}`, at, { x: at.x - down.x, y: at.y - down.y }, { previous }); }
  return previous;
}

describe("open rolling materials", () => {
  it("starts with one exact pair and no observations", () => {
    const state = createRollingWorkbenchState(); expect(isValidRollingWorkbenchState(state)).toBe(true);
    expect(rollingIds(state)).toEqual([0]); expect(Object.values(state.flags).every((flag) => !flag)).toBe(true);
    expect(markup(state)).not.toMatch(/data-rolling-(orbit|links|trace|measures|names)=/);
    expect(markup(state)).toContain("双向滚动小圆 1");
  });
  it("adds four independent pairs, duplicates observations and retains monotone IDs", () => {
    const initial = setRollingFlag(createRollingWorkbenchState(), "orbit", true), copied = duplicateRollingPair(initial);
    expect(rollingPair(copied, 0)).toEqual(rollingPair(initial, 0)); expect(copied.flags["orbit.1"]).toBe(true);
    const full = addRollingPair(addRollingPair(copied)); expect(rollingIds(full)).toEqual([0, 1, 2, 3]); expect(addRollingPair(full)).toBe(full);
    const removed = removeRollingPair(selectRollingPair(full, "pair.1")), added = addRollingPair(removed);
    expect(rollingIds(added)).toEqual([0, 2, 3, 4]); expect(added.flags["orbit.4"]).toBe(false); expect(isValidRollingWorkbenchState(added)).toBe(true);
    expect(added.points["center.0"]).not.toBe(added.points["center.4"]);
  });
  it("keeps an empty stage legal and can draw a new exact circle pair", () => {
    const empty = removeRollingPair(createRollingWorkbenchState()); expect(empty.params.active).toBe(-1); expect(isValidRollingWorkbenchState(empty)).toBe(true);
    const from = { x: 1.25, y: -2.5 }, to = { x: 4.85, y: -2.5 };
    const drawn = constructRollingPair(empty, [rollingToStage(from, empty), rollingToStage(to, empty)])!;
    expect(rollingPair(drawn)!.center.x).toBeCloseTo(from.x); expect(rollingPair(drawn)!.center.y).toBeCloseTo(from.y);
    expect(rollingPair(drawn)!.R).toBeCloseTo(3.6); expect(rollingPair(drawn)!.r).toBeCloseTo(1.2);
    expect(constructRollingPair(empty, [{ x: 300, y: 300 }, { x: 300, y: 300 }])).toBeNull();
  });
  it("accepts unrounded exact parameters and rejects coupled invalid changes atomically", () => {
    let state = createRollingWorkbenchState();
    for (const [key, value] of [["x", 1.23456789], ["y", -3.7654321], ["R", 8.123456789], ["r", 2.234567891], ["angle", -1090.2468], ["rollBy", -89.13579]] as const) state = setRollingField(state, key, value);
    expect(rollingPair(state)).toMatchObject({ center: { x: 1.23456789, y: -3.7654321 }, R: 8.123456789, r: 2.234567891, angle: -1090.2468 });
    state = setRollingField(state, "mode", 1); expect(setRollingField(state, "r", 9)).toBe(state); expect(setRollingField(state, "R", 2)).toBe(state);
    expect(setRollingField(state, "angle", Infinity)).toBe(state); expect(setRollingField(state, "x", 1000.1)).toBe(state); expect(setRollingField(state, "mode", 0.5)).toBe(state);
  });
  it("permits a larger roller outside while retaining a strict interior contact", () => {
    const state = setRollingField(setRollingField(createRollingWorkbenchState(), "R", 0.1), "r", 1000);
    expect(isValidRollingWorkbenchState(state)).toBe(true); expect(setRollingField(state, "mode", 1)).toBe(state);
    expect(rollingPose(rollingPair(state)!).orbitRadius).toBeCloseTo(1000.1);
  });
  it("fits the full swept bounds and keeps mathematical dimensions unchanged", () => {
    let state = createRollingWorkbenchState(); for (let i = 1; i < 4; i++) state = addRollingPair(state);
    state = setRollingField(setRollingField(state, "R", 1000), "x", 1000);
    const fitted = fitRollingView(state); expect(fitted.points).toEqual(state.points);
    for (const pair of rollingPairs(fitted)) { const c = rollingToStage(pair.center, fitted), r = rollingExtent(pair) * rollingScale(fitted); expect(c.x - r).toBeGreaterThan(40); expect(c.x + r).toBeLessThan(870); expect(c.y - r).toBeGreaterThan(90); expect(c.y + r).toBeLessThan(590); }
    const p = { x: 0.1234, y: -5.6789 }; const back = rollingFromStage(rollingToStage(p, fitted), fitted); expect(back.x).toBeCloseTo(p.x, 10); expect(back.y).toBeCloseTo(p.y, 10);
  });
});

describe.each([false, true])("no-slip rolling inside=%s", (inside: boolean) => {
  it.each([-1080.125, -181, -90, 0, 37.125, 180, 541.5, 99999.25])("preserves contact and rigid radius at signed orbit %s", (angle: number) => {
    const state = setRollingField(setRollingField(createRollingWorkbenchState(), "mode", inside ? 1 : 0), "angle", angle), pair = rollingPair(state)!, pose = rollingPose(pair);
    expect(distance(pair.center, pose.center)).toBeCloseTo(pair.R + (inside ? -pair.r : pair.r), 9);
    expect(distance(pair.center, pose.contact)).toBeCloseTo(pair.R, 9); expect(distance(pose.center, pose.contact)).toBeCloseTo(pair.r, 9); expect(distance(pose.center, pose.marker)).toBeCloseTo(pair.r, 9);
    expect(pose.rotation).toBeCloseTo((inside ? -1 : 1) * pose.orbitRadius / pair.r * angle, 7);
    const radians = angle * Math.PI / 180, omega = (inside ? -1 : 1) * pose.orbitRadius / pair.r, dx = pose.contact.x - pose.center.x, dy = pose.contact.y - pose.center.y;
    expect(-pose.orbitRadius * Math.sin(radians) - omega * dy).toBeCloseTo(0, 9); expect(pose.orbitRadius * Math.cos(radians) + omega * dx).toBeCloseTo(0, 9);
  });
  it("interpolates actual circular motion and relative spin, not a chord", () => {
    const from = setRollingField(createRollingWorkbenchState(), "mode", inside ? 1 : 0), to = rollCurrentPair(from, -450.5), middle = interpolateRolling(from, to, 0.5);
    expect(rollingPair(middle)!.angle).toBe(-225.25); expect(isValidRollingWorkbenchState(middle)).toBe(true);
    const p = rollingPose(rollingPair(middle)!); expect(distance(p.center, rollingPair(middle)!.center)).toBeCloseTo(p.orbitRadius, 12);
    expect(interpolateRolling(from, to, 0)).toBe(from); expect(interpolateRolling(from, to, 1)).toBe(to);
  });
});

describe("frozen direct rolling gestures", () => {
  it("starts backwards from zero and continues through multiple positive turns", () => {
    const initial = createRollingWorkbenchState(), negative = gesture(initial, [-60, -120, -180, -240, -300, -360, -420]);
    expect(rollingPair(negative)!.angle).toBeCloseTo(-420, 9);
    const positive = gesture(initial, Array.from({ length: 13 }, (_, i) => (i + 1) * 60)); expect(rollingPair(positive)!.angle).toBeCloseTo(780, 9);
    expect(positive.params.viewSpan).toBe(initial.params.viewSpan); expect(positive.points).toEqual(initial.points);
  });
  it("unwraps across ±180 from a nonzero starting pose and reverses smoothly", () => {
    const initial = setRollingField(createRollingWorkbenchState(), "angle", 177.25), result = gesture(initial, [200, 270, 340, 410, 370, 310, 220, 150, 80]);
    expect(rollingPair(result)!.angle).toBeCloseTo(80, 9);
  });
  it("moves one center without changing the rolling state of either pair", () => {
    const initial = setRollingField(addRollingPair(createRollingWorkbenchState()), "angle", 721.123), down = rollingToStage(rollingPair(initial)!.center, initial), scale = rollingScale(initial);
    const next = dragRollingPair(initial, "pair.1", { x: down.x + 30, y: down.y - 40 }, { x: 30, y: -40 });
    expect(rollingPair(next)!.center.x).toBeCloseTo(12 + 30 / scale); expect(rollingPair(next)!.center.y).toBeCloseTo(40 / scale);
    expect(rollingPair(next)!.angle).toBe(721.123); expect(rollingPair(next, 0)).toEqual(rollingPair(initial, 0)); expect(next.params.viewSpan).toBe(initial.params.viewSpan);
  });
  it.each([0, 1])("edits exact radii with direct handles, mode=%s", (mode: number) => {
    const initial = setRollingField(setRollingField(createRollingWorkbenchState(), "angle", 137.75), "mode", mode), pair = rollingPair(initial)!;
    const R = 4.234567, atR = rollingToStage({ x: pair.center.x, y: pair.center.y + R }, initial), changedR = dragRollingPair(initial, "radius.0", atR, { x: 0, y: 0 });
    expect(rollingPair(changedR)!.R).toBeCloseTo(R, 10); expect(rollingPair(changedR)!.r).toBe(pair.r);
    const r = 1.56789, radius = pair.R + (mode ? -2 : 2) * r, radians = pair.angle * Math.PI / 180, at = rollingToStage({ x: pair.center.x + radius * Math.cos(radians), y: pair.center.y + radius * Math.sin(radians) }, initial);
    const next = dragRollingPair(initial, "roller.0", at, { x: 0, y: 0 }); expect(rollingPair(next)!.r).toBeCloseTo(r, 10); expect(rollingPair(next)!.angle).toBe(pair.angle);
  });
  it("holds the last legal frame at the numeric boundary instead of wrapping the stored angle", () => {
    const initial = setRollingField(createRollingWorkbenchState(), "angle", 99950), result = gesture(initial, [99980, 100010]); expect(rollingPair(result)!.angle).toBeCloseTo(99980, 8);
  });
});

describe("observations and exact history", () => {
  it("keeps per-pair observations independent and hides handles when their panel closes or becomes readonly", () => {
    let state = addRollingPair(createRollingWorkbenchState()); state = setRollingFlag(setRollingFlag(state, "orbit", true), "links", true);
    expect(markup(state)).toContain('data-rolling-orbit="1"'); expect(markup(state)).not.toContain('data-rolling-orbit="0"');
    expect(markup(state, { selected: "pair.1", operation: "rolling-radii" })).toContain("data-rolling-radius-handles");
    expect(markup(state, { selected: "pair.1" })).not.toContain("data-rolling-handle"); expect(markup(state, { selected: "pair.1", operation: "rolling-radii", editable: false })).not.toContain("data-rolling-handle");
    expect(markup(state, { locale: "en" })).toContain("Roll circle 2 in either direction");
  });
  it("samples real marker positions and suppresses an under-sampled dense trace", () => {
    const pair = rollingPair(setRollingField(createRollingWorkbenchState(), "angle", -390))!, trace = rollingTracePoints(pair);
    expect(trace.tooDense).toBe(false); expect(trace.points[0]).toEqual(rollingPose({ ...pair, angle: 0 }).marker); expect(trace.points.at(-1)).toEqual(rollingPose(pair).marker);
    const dense = { ...pair, R: 1000, r: 0.1 }; expect(rollingTracePoints(dense)).toEqual({ points: [], tooDense: true });
  });
  it("leaves all continuous fields unquantized and shares declarative mathematical actions", () => {
    const fields = scene.operations!.flatMap((operation) => operation.fields ?? []); expect(fields.filter((f) => !f.options).every((f) => f.step === undefined)).toBe(true);
    for (const action of [...scene.actions!, ...scene.operations!.flatMap((operation) => operation.actions ?? [])]) {
      const state = createRollingWorkbenchState(); expect(isValidRollingWorkbenchState(action.run(state, { selected: "pair.0" })), action.id).toBe(true);
    }
    expect(scene.contextActions!(createRollingWorkbenchState(), "roll.0")!.items).toHaveLength(5);
  });
  it("keeps a drag as one undo step and a paused semantic animation exact without randomUUID", () => {
    const crypto = globalThis.crypto; vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const initial = createRollingWorkbenchState(), to = rollCurrentPair(initial, 720), base = { current: initial, past: [], future: [], motion: null };
      const direct = planarCommit(base, initial, gesture(initial, [60, 120, 180, 240, 300, 360, 420])); expect(direct.past).toHaveLength(1); expect(planarHistory(direct, "undo").current).toEqual(initial);
      const animation = planarCommit(base, initial, to, { id: "rolling-play", duration: 1800, now: 1000 }), paused = planarPause(animation, 1450, true), frame = planarFrame(paused, scene, 9999);
      expect(rollingPair(frame)!.angle).toBe(180); expect(isValidRollingWorkbenchState(frame)).toBe(true); expect(planarFrame(planarPause(paused, 10000, false), scene, 10450).params["angle.0"]).toBe(360);
      expect(planarHistory(animation, "undo").current).toEqual(initial);
    } finally { vi.unstubAllGlobals(); }
  });
  it("checks current-version shared fixtures, while leaving legacy envelopes to the shared dispatcher", () => {
    for (const entry of planeRollingCases()) {
      if (entry.scene.contentVersion !== "plane-rolling-lesson-v2" || entry.scene.toolId !== "plane-rolling" || entry.label.startsWith("rolling-title")) continue;
      expect(isValidRollingWorkbenchState(entry.scene.payload.initial), entry.label).toBe(entry.accepted);
    }
    const initial = createRollingWorkbenchState(); expect(isValidRollingWorkbenchState({ ...initial, answer: 42 })).toBe(false); expect(isValidRollingWorkbenchState(null)).toBe(false);
  });
});
