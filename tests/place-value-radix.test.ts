import { describe, expect, it, vi, afterEach } from "vitest";
import { boardTotal, createDefaultPlaceValueInitial, createPlaceValueBoard, digitSymbol, formatPlaceValue, groupSize, parsePlaceValue, PLACE_VALUE_BASES, PLACE_VALUE_VERSION, placeValueBoardSchema, placeValueInitial, placeValueInitialSchema, placeValueLimit, placeValueSnapshot, placeValueSnapshotSchema, samePlaceValueGroup } from "@/features/tools/place-value/radix-contract";
import { changePlaceValueBoard, configurePlaceValue, historyPlaceValue, pausePlaceValue, placeValueFrame, placeValueLayout, placeValueNotation, placeValuePendingCarry, placeValuePose, placeValueProgress, placeValueRedSpans, planPlaceValue, planPlaceValueCount, resumePlaceValue, rodUnitAt, rodUnitPosition } from "@/features/tools/place-value/radix-model";
import { placeValueRenderPlan, placeValueRodSegments, PLACE_VALUE_CUBE_BUDGET } from "@/features/tools/place-value/render-plan";
import { createDefaultPlaceValueInitial as legacyDefault, createPlaceValueBoard as legacyBoard, placeValueSnapshot as legacySnapshot, PLACE_VALUE_VERSION as LEGACY_VERSION } from "@/features/tools/place-value/contract";
import { planPlaceValue as legacyPlan } from "@/features/tools/place-value/model";
import { downgradePlaceValueInitial, downgradePlaceValueSnapshot, upgradePlaceValueInitial, upgradePlaceValueSnapshot } from "@/features/tools/place-value/legacy-adapter";
import { freezeToolScene, preparedToolDefinitions } from "@/features/tools/scenes/contract";
import { createClassroomToolState, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { newId } from "@/lib/uuid";
import { placeValueLabel } from "@/features/tools/place-value/messages";

const initial = (base = 10, digits = 3, value = base - 1) => ({ ...createDefaultPlaceValueInitial(), left: createPlaceValueBoard(value, "normal", base, digits), right: createPlaceValueBoard(0, "normal", base, digits) });
afterEach(() => vi.unstubAllGlobals());
describe("radix place-value contract and classroom", () => {
  it.each(PLACE_VALUE_BASES)("carries twice in base %i with protected commands, red overflow and conserved units", (base) => {
    let state = placeValueSnapshot(initial(base, 3, base ** 2 - 1));
    state = planPlaceValue(state, "add", 1000)!;
    expect(placeValuePendingCarry(state, "left")).toBe(0);
    expect(placeValueNotation(state, "left", 0, 1).after).toEqual({ digit: base - 1, extra: 1 });
    expect(placeValueRedSpans(state, "left", 1).reduce((sum, span) => sum + span.count, 0)).toBe(1);
    expect(planPlaceValueCount(state, "left", 1, 0, 2000)).toBeNull();
    expect(planPlaceValue(state, "carry", 2000, 1)).toBeNull();
    state = planPlaceValue(state, "carry", 2000, 0)!;
    expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
    expect(placeValueRedSpans(state, "left", .5).reduce((sum, span) => sum + span.count, 0)).toBe(1);
    expect(placeValueRedSpans(state, "left", 1).reduce((sum, span) => sum + span.count, 0)).toBe(base);
    expect(placeValuePendingCarry(state, "left")).toBe(1);
    expect(planPlaceValue(state, "remove", 5000)).toBeNull();
    state = planPlaceValue(state, "carry", 5000, 1)!;
    expect(boardTotal(state.left)).toBe(base ** 2);
    expect(state.left.places.map((groups) => groups.length)).toEqual([0, 0, 1]);
    expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
    expect(placeValueRedSpans(state, "left", 1)).toEqual([]);
    expect(placeValueNotation(state, "left", 2, 1).after).toEqual({ digit: 1, extra: 0 });
    expect(planPlaceValue(state, "add", 5001)).toBeNull();
    expect(planPlaceValue(state, "add", 30000)).not.toBeNull();
  });
  it.each(PLACE_VALUE_BASES)("retains true group lengths, rigid intermediate poses and five/half color reversals for base %i", (base) => {
    let state = planPlaceValue(placeValueSnapshot(initial(base, 3)), "add", 0)!;
    state = planPlaceValue(state, "carry", 1000)!;
    const a = placeValuePose(state.motion!, 0), b = placeValuePose(state.motion!, 1);
    expect(a).toEqual(placeValueLayout(state.motion!.before)); expect(b).toEqual(placeValueLayout(state.left));
    for (const progress of [.001, .25, .5, .75, .999]) {
      const rod = placeValuePose(state.motion!, progress)[0];
      const first = rodUnitPosition(rod, 0), last = rodUnitPosition(rod, base - 1);
      expect(Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z)).toBeCloseTo(base - 1, 8);
      expect(groupSize(rod.group)).toBe(base);
    }
    const board = createPlaceValueBoard((base - 1) * base, "normal", base, 3);
    for (const rod of placeValueLayout(board)) {
      const i = rod.index < Math.ceil(base / 2) ? 0 : rod.length - 1;
      expect(rodUnitPosition(rod, i).z).toBe(0);
      expect(rodUnitAt(rod, i).phase % base < Math.ceil(base / 2)).toBe(rod.index < Math.ceil(base / 2));
    }
  });
  it("supports high-place carry and undo, preserves the fixed camera pivot, and bounds rendering independently of quantity", () => {
    let state = placeValueSnapshot(initial(10, 6, 99_999));
    state = planPlaceValue(state, "add", 1000)!;
    for (let level = 0; level < 5; level++) {
      state = planPlaceValue(state, "carry", 10000 + level * 20000, level)!;
      expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
      const pose = placeValuePose(state.motion!, .43);
      expect(pose.reduce((sum, rod) => sum + rod.length, 0)).toBe(100_000);
      expect(placeValueRenderPlan(pose, [], 10).cubes.length).toBeLessThanOrEqual(PLACE_VALUE_CUBE_BUDGET);
    }
    expect(state.left.places[5]).toHaveLength(1);
    const stable = placeValueLayout(state.left)[0]; expect(stable.length).toBe(100_000);
    expect(rodUnitPosition(stable, 99_999).z).toBe(-99_999);
    expect(placeValueFrame({ ...state, view: "left" }).center).toEqual({ x: 0, y: 4, z: 0 });
    const undo = historyPlaceValue(state, "undo", 200000)!;
    expect(boardTotal(undo.left)).toBe(100_000); expect(undo.left.places[4]).toHaveLength(10);
    expect(placeValueSnapshotSchema.safeParse(undo).success).toBe(true);
  });
  it.each(PLACE_VALUE_BASES)("stores the maximum six-digit base %i number compactly and exposes exact endpoint IDs", (base) => {
    const board = createPlaceValueBoard(placeValueLimit(base, 6), "normal", base, 6), rods = placeValueLayout(board), plan = placeValueRenderPlan(rods, [], base);
    expect(boardTotal(board)).toBe(base ** 6 - 1);
    expect(JSON.stringify(board).length).toBeLessThan(8000);
    expect(plan.cubes.length).toBeLessThanOrEqual(PLACE_VALUE_CUBE_BUDGET);
    expect(plan.compact.length).toBeLessThanOrEqual(6 * (base - 1));
    expect(plan.compact.reduce((sum, rod) => sum + rod.length, 0) + plan.cubes.length).toBe(boardTotal(board));
    for (const rod of plan.compact) expect(placeValueRodSegments(rod, [], base).reduce((sum, segment) => sum + segment.count, 0)).toBe(rod.length);
  });
  it("rejects duplicate ranges, wrong weights, forged carry colors, unsupported bases and capacity loss", () => {
    const board = createPlaceValueBoard(20);
    const duplicate = structuredClone(board); duplicate.places[1][1] = duplicate.places[1][0];
    expect(placeValueBoardSchema.safeParse(duplicate).success).toBe(false);
    expect(() => createPlaceValueBoard(16, "normal", 6)).toThrow();
    expect(() => createPlaceValueBoard(16 ** 6, "normal", 16, 6)).toThrow();
    expect(() => createPlaceValueBoard(999999, "ones", 10, 6)).toThrow();
    expect(configurePlaceValue(placeValueSnapshot(initial(10, 6, 999999)), 2, 6)).toBeNull();
    const moving = planPlaceValue(placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(10, "ones") }), "carry", 0)!;
    const forged = structuredClone(moving); forged.left.places[1][0][0].phase = 5;
    forged.motion!.after = forged.left;
    expect(placeValueSnapshotSchema.safeParse(forged).success).toBe(false);
  });
  it("keeps deliberate unpacking usable, including a selected middle rod, then re-enables carry protection on addition", () => {
    const start = placeValueSnapshot(initial(10, 3, 900));
    const selected = start.left.places[2][1][0].start;
    let state = planPlaceValue({ ...start, selection: { side: "left", unit: selected } }, "unpack", 1000, 2)!;
    expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
    expect(placeValuePendingCarry(state, "left")).toBeNull();
    const undo = historyPlaceValue(state, "undo", 20000)!;
    expect(placeValueSnapshotSchema.safeParse(undo).success).toBe(true);
    expect(undo.left).toEqual(start.left);
    state = planPlaceValue(state, "unpack", 20000, 1)!;
    state = planPlaceValue(state, "remove", 30000)!;
    expect(boardTotal(state.left)).toBe(899);
    expect(planPlaceValue(state, "add", 40000)).not.toBeNull();
  });
  it("uses uppercase hexadecimal digits, parses the selected base strictly and labels places by powers", () => {
    expect(formatPlaceValue(0xA0F, 16)).toBe("A0F"); expect(digitSymbol(15)).toBe("F");
    expect(parsePlaceValue("a0f", 16)).toBe(0xA0F); expect(parsePlaceValue("10", 2)).toBe(2);
    for (const text of ["2", "10z", "1.0", "-1", "1e2", ""]) expect(parsePlaceValue(text, 2)).toBeNull();
    expect(placeValueLabel("zh", 3, 2)).toBe("2³"); expect(placeValueLabel("en", 5, 16)).toBe("16⁵");
    expect(placeValueLabel("zh", 5, 10)).toBe("十万位");
    const state = configurePlaceValue(placeValueSnapshot(initial(10, 3, 23)), 2, 6)!;
    expect(boardTotal(state.left)).toBe(23); expect(state.left.places.map((groups) => groups.length)).toEqual([1, 1, 1, 0, 1, 0]);
  });
  it("round-trips frozen v1 identity, scenes, running animations and subsequent classroom commands", () => {
    const old = { ...legacyDefault(), left: legacyBoard(59), right: legacyBoard(900) };
    expect(downgradePlaceValueInitial(upgradePlaceValueInitial(old))).toEqual(old);
    let oldState = legacyPlan(legacySnapshot(old), "add", 1000)!;
    oldState = legacyPlan(oldState, "carry-one", 2000)!;
    const current = upgradePlaceValueSnapshot(oldState);
    expect(placeValueSnapshotSchema.safeParse(current).success).toBe(true);
    expect(downgradePlaceValueSnapshot(current)).toEqual(oldState);
    const next = planPlaceValue(current, "add", 10000)!;
    expect(downgradePlaceValueSnapshot(next).left.ones).toHaveLength(1);
    expect(freezeToolScene({ toolId: "place-value", contentVersion: LEGACY_VERSION, payload: { title: "Old", initial: old } }).contentVersion).toBe(LEGACY_VERSION);
  });
  it("saves and replays v2 scenes within the shared payload budget without native randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: <T extends ArrayBufferView>(array: T) => { new Uint8Array(array.buffer).fill(29); return array; } });
    let state = placeValueSnapshot(initial(16, 6, 0xFFFFE)); state = planPlaceValueCount(state, "left", 0, 16, 0)!;
    state = planPlaceValue(state, "carry", 1000, 0)!;
    const paused = pausePlaceValue(state, 2100), resumed = resumePlaceValue(paused, 9000);
    expect(placeValueProgress(resumed.motion, 9000)).toBe(.5);
    const scene = freezeToolScene({ toolId: "place-value", contentVersion: PLACE_VALUE_VERSION, payload: { title: "Radix", initial: placeValueInitial(state) } });
    const payload = createClassroomToolState(newId(), newId(), newId(), { toolId: "place-value", contentVersion: PLACE_VALUE_VERSION, state: paused }, toolSceneOriginHash(scene));
    expect(parseClassroomToolState(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(512000);
    expect(preparedToolDefinitions("formal-courseware").find((item) => item.catalogId === "place-value")!.contentVersion).toBe(PLACE_VALUE_VERSION);
    if (scene.contentVersion !== PLACE_VALUE_VERSION) throw new Error("Expected a v2 place-value scene");
    expect(placeValueInitialSchema.safeParse(scene.payload.initial).success).toBe(true);
    expect(samePlaceValueGroup([{ start: 0, count: 10, phase: 0 }], [{ start: 0, count: 5, phase: 0 }, { start: 5, count: 5, phase: 5 }], 10)).toBe(true);
    expect(changePlaceValueBoard(createPlaceValueBoard(0), "remove")).toBeNull();
  });
});
