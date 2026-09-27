import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "@/lib/uuid";
import { createClassroomToolState, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { freezeToolScene } from "@/features/tools/scenes/contract";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { advancePlaceValueBoxCarry, changePlaceValueContents, changePlaceValueStrategy, placeValueBoxCarryPose, placeValueBoxDimensions, placeValueBoxFrame, placeValueBoxLayout, placeValueBoxMappingPosition, placeValueBoxMappingSize, placeValueBoxPose } from "@/features/tools/place-value/box-model";
import { boardTotal, createDefaultPlaceValueInitial, createPlaceValueBoard, PLACE_VALUE_BASES, PLACE_VALUE_MAPPING_VERSION, placeValueInitial, placeValueInitialSchema, placeValueMappingInitialSchema, placeValueMappingSnapshotSchema, placeValueSnapshot, placeValueSnapshotSchema, type PlaceValueSnapshot } from "@/features/tools/place-value/radix-contract";
import { historyPlaceValue, placeValueLocked, placeValueNotation, planPlaceValue, planPlaceValueCount } from "@/features/tools/place-value/radix-model";

const initial = (base = 10, value = 10, grouping: "normal" | "ones" | "tens" = "ones") => ({ ...createDefaultPlaceValueInitial(),
  left: createPlaceValueBoard(value, grouping, base, 6), right: createPlaceValueBoard(0, "normal", base, 6), presentation: { strategy: "boxes" as const, contents: "both" as const } });
const finishStage = (snapshot: PlaceValueSnapshot) => ({ ...snapshot, motion: { ...snapshot.motion!, progress: 1 } });
afterEach(() => vi.unstubAllGlobals());

describe("independent place-value box mapping", () => {
  it.each(PLACE_VALUE_BASES)("keeps exact composition weights with bounded geometry in base %i", (base) => {
    for (let level = 0; level < 6; level++) {
      const dimensions = placeValueBoxDimensions(base, level), size = placeValueBoxMappingSize(base, level);
      expect(dimensions.reduce((v, n) => v * n, 1)).toBe(base ** level);
      expect(Math.max(...size)).toBeLessThanOrEqual(3.800001);
      expect(size[0] / dimensions[0]).toBeCloseTo(size[1] / dimensions[1], 10);
      expect(size[1] / dimensions[1]).toBeCloseTo(size[2] / dimensions[2], 10);
    }
    const board = createPlaceValueBoard(base ** 6 - 1, "normal", base, 6);
    expect(placeValueBoxLayout(board)).toHaveLength((base - 1) * 6 * 3);
  });
  it("keeps plates aligned with the front rows while three solid thousands occupy disjoint volumes", () => {
    const board = createPlaceValueBoard(3333, "normal", 10, 6);
    for (const level of [0, 1, 2]) for (let index = 0; index < 3; index++) expect(placeValueBoxMappingPosition(board, level, index)[1]).toBe(index + .5);
    const mappings = placeValueBoxLayout(board).filter((item) => item.role === "mapping");
    for (let i = 0; i < mappings.length; i++) for (let j = i + 1; j < mappings.length; j++) {
      const a = mappings[i], b = mappings[j];
      expect(a.position.some((v, axis) => Math.abs(v - b.position[axis]) >= (a.size[axis] + b.size[axis]) / 2 - 1e-6)).toBe(true);
    }
    expect(placeValueBoxMappingPosition(board, 3, 1)[1] - placeValueBoxMappingPosition(board, 3, 0)[1]).toBeCloseTo(3.96);
    expect(placeValueBoxFrame({ ...initial(), left: board, view: "angle" }).center).toEqual({ x: 0, y: 4, z: 0 });
  });
  it("waits at both stage boundaries, locks quantity and strategy, and updates digits only on final placement", () => {
    const origin = placeValueSnapshot(initial());
    let state = planPlaceValue(origin, "carry", 1000)!;
    const id = state.motion!.id;
    expect(state.motion!.boxStage).toBe("lay"); expect(boardTotal(state.left)).toBe(10);
    expect(advancePlaceValueBoxCarry(state, 1001)).toBeNull();
    for (const stage of ["lay", "pack"] as const) {
      expect(state.motion!.boxStage).toBe(stage); expect(placeValueMappingSnapshotSchema.safeParse(state).success).toBe(true);
      state = finishStage(state);
      expect(placeValueLocked(state, 999999)).toBe(true);
      expect(planPlaceValueCount(state, "left", 0, 1, 999999)).toBeNull();
      expect(changePlaceValueStrategy(state, "rods", 999999)).toBeNull();
      expect(changePlaceValueContents(state, "inside", 999999)).toBeNull();
      expect(placeValueNotation(state, "left", 0, 1).blend).toBe(0);
      const before = placeValueBoxPose(state, "left", 1);
      state = advancePlaceValueBoxCarry(state, 10000)!;
      const after = placeValueBoxPose(state, "left", 0);
      expect(after).toEqual(before); expect(state.motion!.id).toBe(id);
      expect(state.past).toHaveLength(1);
    }
    expect(state.motion!.boxStage).toBe("place");
    expect(placeValueNotation(state, "left", 0, .5).blend).toBeCloseTo(.5);
    state = finishStage(state);
    expect(placeValueLocked(state, 999999)).toBe(false);
    expect(placeValueBoxPose(state, "left", 1)).toEqual(placeValueBoxLayout(state.left));
    expect(placeValueNotation(state, "left", 0, 1).after).toEqual({ digit: 0, extra: 0 });
    expect(placeValueNotation(state, "left", 1, 1).after.digit).toBe(1);
    const undo = historyPlaceValue(state, "undo", 999999)!;
    expect(undo.left).toEqual(origin.left); expect(placeValueMappingSnapshotSchema.safeParse(undo).success).toBe(true);
    expect(placeValueBoxPose(undo, "left", 1)).toEqual(placeValueBoxLayout(origin.left));
    const redo = historyPlaceValue({ ...undo, motion: null }, "redo", 1000000)!;
    expect(redo.motion!.boxStage).toBe("lay"); expect(redo.left).toEqual(state.left);
  });
  it.each(PLACE_VALUE_BASES)("preserves group members, endpoints and finite animation across all places in base %i", (base) => {
    for (let level = 0; level < 5; level++) for (const contents of ["inside", "outside", "both"] as const) {
      let state = placeValueSnapshot({ ...initial(base, 0), presentation: { strategy: "boxes", contents } });
      state = planPlaceValueCount(state, "left", level, base, 0)!;
      state = planPlaceValue(state, "carry", 1000, level)!;
      const change = state.motion!;
      expect(boardTotal(change.before)).toBe(boardTotal(change.after));
      expect(placeValueBoxCarryPose(change, 0, contents)).toEqual(placeValueBoxLayout(change.before, contents));
      expect(placeValueBoxCarryPose(change, 1, contents)).toEqual(placeValueBoxLayout(change.after, contents));
      for (const progress of [.01, .16, 1 / 3, .5, 2 / 3, .83, .9999]) for (const part of placeValueBoxCarryPose(change, progress, contents)) {
        expect([...part.position, ...part.rotation, ...part.size, part.opacity].every(Number.isFinite)).toBe(true);
        expect(part.size.every((n) => n > 0)).toBe(true);
      }
    }
  });
  it("animates taking out and returning the same contents without changing the number or history", () => {
    let state = placeValueSnapshot({ ...initial(10, 321, "normal"), presentation: { strategy: "boxes", contents: "inside" } });
    const origin = structuredClone(state);
    for (const [i, mode] of (["outside", "both", "inside"] as const).entries()) {
      const now = 1000 + i * 2000;
      const next = changePlaceValueContents(state, mode, now)!;
      expect(next.left).toEqual(origin.left); expect(next.past).toEqual([]);
      expect(placeValueMappingSnapshotSchema.safeParse(next).success).toBe(true);
      expect(changePlaceValueContents(next, "both", now + 1)).toBeNull();
      expect(planPlaceValue(next, "add", now + 1)).toBeNull();
      const mid = placeValueBoxPose(next, "left", 1, .5);
      expect(mid).not.toEqual(placeValueBoxPose(next, "left", 1, 1));
      expect(placeValueBoxPose(next, "left", 1, 1)).toEqual(placeValueBoxLayout(next.left, mode));
      state = next;
    }
    const rods = changePlaceValueStrategy(state, "rods", 10000)!;
    expect(rods.left).toEqual(state.left); expect(rods.contentsMotion).toBeUndefined();
  });
  it("round-trips new scene strategy and waiting classroom commands without widening frozen v1/v2 wire contracts", () => {
    vi.stubGlobal("crypto", { getRandomValues: <T extends ArrayBufferView>(array: T) => { new Uint8Array(array.buffer).fill(37); return array; } });
    const state = finishStage(planPlaceValue(placeValueSnapshot(initial()), "carry", 1000)!);
    const scene = freezeToolScene({ toolId: "place-value", contentVersion: PLACE_VALUE_MAPPING_VERSION, payload: { title: "Boxes", initial: placeValueInitial(state) } });
    if (scene.contentVersion !== PLACE_VALUE_MAPPING_VERSION) throw new Error("Expected mapping version");
    expect(placeValueMappingInitialSchema.safeParse(scene.payload.initial).success).toBe(true);
    const event = createClassroomToolState(newId(), newId(), newId(), { toolId: "place-value", contentVersion: PLACE_VALUE_MAPPING_VERSION, state: { ...state, presentation: state.presentation! } }, toolSceneOriginHash(scene));
    expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(placeValueSnapshotSchema.safeParse(state).success).toBe(false);
    expect(placeValueInitialSchema.safeParse(placeValueInitial(state)).success).toBe(false);
    const old = placeValueSnapshot(createDefaultPlaceValueInitial());
    expect(placeValueSnapshotSchema.safeParse(old).success).toBe(true);
    expect(placeValueInitial(old)).toEqual(createDefaultPlaceValueInitial());
    expect(placeValueMappingSnapshotSchema.safeParse({ ...state, presentation: { strategy: "rods", contents: "both" } }).success).toBe(false);
  });
});
