import { afterEach, describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { newId } from "@/lib/uuid";
import { createClassroomToolState, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { freezeToolScene } from "@/features/tools/scenes/contract";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { changePlaceValueContents, changePlaceValueStrategy, normalizePlaceValueBoxSnapshot, placeValueBoxCapacity, placeValueBoxCarryPose, placeValueBoxDimensions, placeValueBoxFrame, placeValueBoxLayout, placeValueBoxMappingPosition, placeValueBoxMappingSize, placeValueBoxPose, placeValueBoxRedSpans, type PlaceValueBoxPart } from "@/features/tools/place-value/box-model";
import { boardTotal, createDefaultPlaceValueInitial, createPlaceValueBoard, PLACE_VALUE_BASES, PLACE_VALUE_MAPPING_VERSION, placeValueInitial, placeValueInitialSchema, placeValueMappingInitialSchema, placeValueMappingSnapshotSchema, placeValueSnapshot, placeValueSnapshotSchema, type PlaceValueSnapshot } from "@/features/tools/place-value/radix-contract";
import { configurePlaceValue, historyPlaceValue, placeValueLocked, placeValueNotation, planPlaceValue, planPlaceValueCount } from "@/features/tools/place-value/radix-model";
import { writePlaceValueBoxColors } from "@/features/tools/place-value/box-colors";

const initial = (base = 10, value = 10, grouping: "normal" | "ones" | "tens" = "ones") => ({ ...createDefaultPlaceValueInitial(),
  left: createPlaceValueBoard(value, grouping, base, 6), right: createPlaceValueBoard(0, "normal", base, 6), presentation: { strategy: "boxes" as const, contents: "inside" as const } });
const finishStage = (snapshot: PlaceValueSnapshot) => ({ ...snapshot, motion: { ...snapshot.motion!, progress: 1 } });
const worldSize = (part: PlaceValueBoxPart) => {
  const rotation = new Quaternion(...part.rotation);
  const axes = part.size.map((length, axis) => new Vector3().setComponent(axis, length).applyQuaternion(rotation));
  return [0, 1, 2].map((axis) => axes.reduce((sum, edge) => sum + Math.abs(edge.getComponent(axis)), 0));
};
afterEach(() => vi.unstubAllGlobals());

describe("independent place-value box mapping", () => {
  it.each(PLACE_VALUE_BASES)("fixes each case at base minus one and counts units above its rim in base %i", (base) => {
    for (const count of [base - 1, base, base + 3]) {
      const state = placeValueSnapshot(initial(base, count));
      const parts = placeValueBoxPose(state, "left", 1);
      expect(placeValueBoxCapacity(state.left, 0, parts)).toEqual({ limit: base - 1, overflow: count - base + 1, opacity: count >= base ? 1 : 0 });
      for (let level = 1; level < 6; level++) expect(placeValueBoxCapacity(state.left, level, parts)).toEqual({ limit: base - 1, overflow: 0, opacity: 0 });
      for (const part of parts.filter((part) => part.role === "shell" && part.index >= base - 1)) expect(part.position[1] - .5).toBeGreaterThanOrEqual(base - 1);
    }
  });
  it("keeps overflow attached to the visible counting boxes through carry, unpack and restore", () => {
    const origin = placeValueSnapshot(initial());
    const carried = planPlaceValue(origin, "carry", 1000)!;
    const capacityAt = (snapshot: PlaceValueSnapshot, progress: number) => placeValueBoxCapacity(snapshot.left, 0, placeValueBoxPose(snapshot, "left", progress));
    expect(carried.left.places[0]).toHaveLength(0);
    expect(capacityAt(carried, 0)).toEqual({ limit: 9, overflow: 1, opacity: 1 });
    expect(capacityAt(carried, .08)).toEqual({ limit: 9, overflow: 1, opacity: .5 });
    for (const progress of [.2, .6, 1]) expect(capacityAt(carried, progress)).toEqual({ limit: 9, overflow: 0, opacity: 0 });
    const unpacked = planPlaceValue({ ...carried, motion: null }, "unpack", 10000, 1)!;
    expect(capacityAt(unpacked, 0).overflow).toBe(0);
    expect(capacityAt(unpacked, 1)).toEqual(capacityAt(origin, 1));
    const restored = historyPlaceValue({ ...carried, motion: null }, "undo", 10000)!;
    expect(capacityAt(restored, 1)).toEqual(capacityAt(origin, 1));
  });
  it.each([3, 10, 16])("keeps original yellow/blue phases through regrouping in base %i", (base) => {
    const state = planPlaceValueCount(placeValueSnapshot(initial(base, 0)), "left", 1, base, 0)!;
    const carried = planPlaceValue(state, "carry", 1000, 1)!;
    const groups = [...state.left.places[1], carried.left.places[2][0]];
    const data = new Float32Array(groups.reduce((sum, group) => sum + group.length, 0) * 4);
    const ranges = writePlaceValueBoxColors(groups, data);
    const phases = (index: number) => {
      const [start, length] = ranges[index];
      return Array.from({ length: groups[index].reduce((n, span) => n + span.count, 0) }, (_, unit) => {
        let low = start, high = start + length - 1;
        for (let i = 0; i < 12; i++) if (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (unit < data[middle * 4]) high = middle; else low = middle + 1;
        }
        return (unit + data[low * 4 + 1]) % 10 >= 5;
      });
    };
    expect(phases(groups.length - 1)).toEqual(groups.slice(0, -1).flatMap((_, i) => phases(i)));
    const large = new Float32Array(4);
    expect(writePlaceValueBoxColors([[{ start: 0, count: 16 ** 5, phase: 5 }]], large)).toEqual([[0, 1]]);
    expect(large[0]).toBe(16 ** 5); expect(large[1]).toBe(5);
  });
  it.each(PLACE_VALUE_BASES)("keeps original composition dimensions without adding per-unit geometry in base %i", (base) => {
    for (let level = 0; level < 6; level++) {
      const dimensions = placeValueBoxDimensions(base, level), size = placeValueBoxMappingSize(base, level);
      expect(dimensions.reduce((v, n) => v * n, 1)).toBe(base ** level);
      expect(size).toEqual(dimensions);
    }
    const board = createPlaceValueBoard(base ** 6 - 1, "normal", base, 6);
    expect(placeValueBoxLayout(board)).toHaveLength((base - 1) * 6 * 3);
  });
  it("keeps original-sized rows and non-overlapping columns when legacy scenes show every composition", () => {
    const board = createPlaceValueBoard(3333, "normal", 10, 6);
    for (const level of [0, 1, 2]) for (let index = 0; index < 3; index++) expect(placeValueBoxMappingPosition(board, level, index)[1]).toBe(index + .5);
    const mappings = placeValueBoxLayout(board).filter((item) => item.role === "mapping");
    for (let i = 0; i < mappings.length; i++) for (let j = i + 1; j < mappings.length; j++) {
      const a = mappings[i], b = mappings[j];
      expect(a.position.some((v, axis) => Math.abs(v - b.position[axis]) >= (a.size[axis] + b.size[axis]) / 2 - 1e-6)).toBe(true);
    }
    expect(placeValueBoxMappingPosition(board, 3, 1)[1] - placeValueBoxMappingPosition(board, 3, 0)[1]).toBe(10);
    expect(placeValueBoxMappingSize(10, 3)).toEqual([10, 10, 10]);
    expect(placeValueBoxFrame({ ...initial(), left: board, view: "angle" }).center).toEqual({ x: 0, y: 4, z: 0 });
  });
  it("uses one carry command through internal phases and updates digits as it packs directly into the final box", () => {
    const origin = placeValueSnapshot(initial());
    let state = planPlaceValue(origin, "carry", 1000)!;
    const id = state.motion!.id;
    expect(state.motion!.boxStage).toBeUndefined(); expect(boardTotal(state.left)).toBe(10);
    expect(placeValueMappingSnapshotSchema.safeParse(state).success).toBe(true);
    expect(placeValueLocked(state, 3000)).toBe(true);
    expect(planPlaceValueCount(state, "left", 0, 1, 3000)).toBeNull();
    expect(changePlaceValueStrategy(state, "rods", 3000)).toBeNull();
    expect(changePlaceValueContents(state, "outside", 3000)).toBeNull();
    expect(placeValueNotation(state, "left", 0, .6).blend).toBe(0);
    expect(placeValueNotation(state, "left", 0, .8).blend).toBeCloseTo(.5);
    const finalShell = placeValueBoxLayout(state.left).find((part) => part.role === "shell")!;
    for (const progress of [.61, .8, .95]) {
      const shell = placeValueBoxPose(state, "left", progress).find((part) => part.role === "shell" && part.opacity > .5)!;
      expect(shell.position).toEqual(finalShell.position);
      expect(state.motion!.id).toBe(id); expect(state.past).toHaveLength(1);
    }
    state = finishStage(state);
    expect(placeValueLocked(state, 999999)).toBe(false);
    expect(placeValueBoxPose(state, "left", 1)).toEqual(placeValueBoxLayout(state.left));
    expect(placeValueNotation(state, "left", 0, 1).after).toEqual({ digit: 0, extra: 0 });
    expect(placeValueNotation(state, "left", 1, 1).after.digit).toBe(1);
    const undo = historyPlaceValue(state, "undo", 999999)!;
    expect(undo.left).toEqual(origin.left); expect(placeValueMappingSnapshotSchema.safeParse(undo).success).toBe(true);
    expect(placeValueBoxPose(undo, "left", 1)).toEqual(placeValueBoxLayout(origin.left));
    const redo = historyPlaceValue({ ...undo, motion: null }, "redo", 1000000)!;
    expect(redo.motion!.boxStage).toBeUndefined(); expect(redo.left).toEqual(state.left);
  });
  it("retains one packed representation from every view, with whole front faces for nine thousands", () => {
    const state = placeValueSnapshot(initial(10, 909009, "normal"));
    const front = placeValueBoxPose(state, "left", 1);
    for (const view of ["angle", "left", "right", "top"] as const) expect(placeValueBoxPose({ ...state, view }, "left", 1)).toEqual(front);
    expect(front.filter((part) => part.role === "mapping" && part.opacity > 0)).toHaveLength(0);
    const ones = front.filter((part) => part.role === "contents" && part.level === 0);
    const thousands = front.filter((part) => part.role === "contents" && part.level === 3);
    expect(thousands).toHaveLength(9);
    thousands.forEach((part, index) => {
      expect(part.size).toEqual(ones[index].size); expect(part.position[1]).toBe(ones[index].position[1]);
      expect(part.detail).toBe(0); expect(part.frontTone).toBe(index >= 5 ? 1 : 0);
    });
  });
  it("takes out only the selected contents, leaving its box empty, and duplicates only on explicit Show both", () => {
    const state = placeValueSnapshot(initial(10, 3333, "normal"));
    const unit = state.left.places[3][1][0].start;
    const inside = placeValueBoxLayout(state.left), outside = placeValueBoxLayout(state.left, "outside", unit);
    for (const part of outside.filter((part) => part.unit !== unit)) expect(part).toEqual(inside.find((p) => p.key === part.key));
    expect(outside.filter((part) => part.unit === unit && part.role !== "shell" && part.opacity > 0)).toHaveLength(1);
    expect(outside.find((part) => part.unit === unit && part.role === "contents")!.position[2]).toBeLessThan(-1);
    expect(outside.find((part) => part.unit === unit && part.role === "contents")!.size).toEqual([10, 10, 10]);
    expect(placeValueBoxLayout(state.left, "both", unit).filter((part) => part.unit === unit && part.role !== "shell" && part.opacity > 0)).toHaveLength(2);
    state.selection = { side: "left", unit };
    const opening = changePlaceValueContents(state, "outside", 1000)!;
    const mid = placeValueBoxPose(opening, "left", 1, .5);
    for (const part of mid.filter((part) => part.unit !== unit && part.opacity > 0)) expect(part).toEqual(inside.find((p) => p.key === part.key));
  });
  it.each(PLACE_VALUE_BASES)("takes out every place at its original size and leaves the counting boxes unchanged in base %i", (base) => {
    const board = createPlaceValueBoard(Array.from({ length: 6 }, (_, level) => base ** level).reduce((sum, value) => sum + value, 0), "normal", base, 6);
    const stored = placeValueBoxLayout(board);
    for (let level = 0; level < 6; level++) {
      const unit = board.places[level][0][0].start;
      for (const mode of ["outside", "both"] as const) {
        const parts = placeValueBoxLayout(board, mode, unit);
        const expanded = parts.find((part) => part.unit === unit && part.role === (mode === "outside" ? "contents" : "mapping"))!;
        expect(expanded.size).toEqual(placeValueBoxDimensions(base, level));
        expect(expanded.position[2] + expanded.size[2] / 2).toBeCloseTo(-2.4);
        expect(parts.filter((part) => part.role === "shell")).toEqual(stored.filter((part) => part.role === "shell"));
      }
    }
  });
  it("fits only visible compositions and keeps the front counting frame compact while contents are stored", () => {
    const state = { ...initial(16, 16 ** 5, "normal"), view: "angle" as const };
    const stored = placeValueBoxFrame(state), unit = state.left.places[5][0][0].start;
    expect(stored.radius).toBeLessThan(30);
    const extracted = { ...state, selection: { side: "left" as const, unit }, presentation: { strategy: "boxes" as const, contents: "outside" as const } };
    const part = placeValueBoxLayout(state.left, "outside", unit).find((part) => part.role === "contents")!;
    const fitted = placeValueBoxFrame(extracted);
    expect(fitted.center).toEqual(stored.center);
    expect(fitted.radius).toBeGreaterThanOrEqual(Math.abs(part.position[2]) + part.size[2] / 2);
    expect(placeValueBoxFrame({ ...extracted, presentation: { strategy: "boxes", contents: "inside" } })).toEqual(stored);
  });
  it("removes pending red at the start of carry and restores only the next pending group at its endpoint", () => {
    let state = placeValueSnapshot(initial(10, 99, "normal"));
    state = planPlaceValue(state, "add", 0)!;
    expect(placeValueBoxRedSpans(state, "left", 1)).toHaveLength(1);
    state = planPlaceValue(state, "carry", 1000)!;
    for (const progress of [0, .2, .6, .9]) expect(placeValueBoxRedSpans(state, "left", progress)).toEqual([]);
    expect(placeValueBoxRedSpans(state, "left", 1)).toEqual(state.left.places[1].at(-1));
  });
  it("continues old phased classroom commands without another operation", () => {
    const state = planPlaceValue(placeValueSnapshot(initial()), "carry", 1000)!;
    const old = { ...state, motion: { ...state.motion!, boxStage: "pack" as const, progress: 0, durationMs: 1800 } };
    const upgraded = normalizePlaceValueBoxSnapshot(old);
    expect(upgraded.motion!.boxStage).toBeUndefined(); expect(upgraded.motion!.progress).toBe(.6);
    expect(placeValueLocked(upgraded, 2800)).toBe(false);
    expect(placeValueMappingSnapshotSchema.safeParse(upgraded).success).toBe(true);
    expect(normalizePlaceValueBoxSnapshot(upgraded)).toBe(upgraded);
  });
  it("keeps all internal animation boundaries continuous, including the rotation-to-packing boundary", () => {
    for (let level = 0; level < 5; level++) {
      let state = placeValueSnapshot(initial(10, 0));
      state = planPlaceValueCount(state, "left", level, 10, 0)!;
      state = planPlaceValue(state, "carry", 1000, level)!;
      for (const boundary of [.16, .56, .6, .91]) {
        // 原尺寸长边可达 100；靠近边界取极限，避免把正常位移当成阶段跳变。
        const before = placeValueBoxCarryPose(state.motion!, boundary - 1e-9, "inside").filter((part) => part.key.startsWith("carrying:"));
        const after = placeValueBoxCarryPose(state.motion!, boundary + 1e-9, "inside");
        before.forEach((part) => {
          const next = after.find((candidate) => candidate.key === part.key)!;
          [...part.position, ...part.size, ...part.rotation].forEach((value, i) => expect(value).toBeCloseTo([...next.position, ...next.size, ...next.rotation][i], 4));
        });
      }
    }
  });
  it.each([3, 10, 16])("assembles at original size, then packs one connected solid without rotating its pieces again in base %i", (base) => {
    for (let level = 0; level < 5; level++) {
      let state = planPlaceValueCount(placeValueSnapshot(initial(base, 0)), "left", level, base, 0)!;
      state = planPlaceValue(state, "carry", 1000, level)!;
      const motion = state.motion!, axis = (level + 1) % 3 === 1 ? 2 : (level + 1) % 3 === 2 ? 0 : 1;
      const moving = (progress: number) => placeValueBoxCarryPose(motion, progress, "inside").filter((part) => part.key.startsWith("carrying:"));
      for (const progress of [.16, .32, .56, .59]) for (const part of moving(progress)) expect(part.size).toEqual(placeValueBoxDimensions(base, level));
      const assembled = moving(.6);
      expect(assembled).toHaveLength(base);
      for (const progress of [.61, .75, .91, .97]) {
        const parts = moving(progress), sizes = parts.map(worldSize);
        parts.forEach((part, index) => {
          expect(new Quaternion(...part.rotation).angleTo(new Quaternion(...assembled[index].rotation))).toBeLessThan(1e-7);
          if (!index) return;
          for (let coordinate = 0; coordinate < 3; coordinate++) {
            const distance = Math.abs(part.position[coordinate] - parts[index - 1].position[coordinate]);
            expect(distance).toBeCloseTo(coordinate === axis ? (sizes[index][coordinate] + sizes[index - 1][coordinate]) / 2 : 0, 9);
          }
        });
        // 融合后的单体与分块共用同一外轮廓，交接不出现两个错位模型。
        const fused = placeValueBoxCarryPose(motion, progress, "inside").find((part) => part.role === "contents" && part.key.startsWith("contents:") && part.opacity > 0);
        if (fused) for (let coordinate = 0; coordinate < 3; coordinate++) {
          const min = Math.min(...parts.map((part, index) => part.position[coordinate] - sizes[index][coordinate] / 2));
          const max = Math.max(...parts.map((part, index) => part.position[coordinate] + sizes[index][coordinate] / 2));
          expect(fused.position[coordinate]).toBeCloseTo((min + max) / 2, 9);
          expect(fused.size[coordinate]).toBeCloseTo(max - min, 9);
        }
      }
      const unpack = planPlaceValue({ ...state, motion: null }, "unpack", 10000, level + 1)!;
      for (const progress of [.2, .5, .8]) expect(placeValueBoxCarryPose(unpack.motion!, progress, "inside")).toEqual(placeValueBoxCarryPose(motion, 1 - progress, "inside"));
    }
  });
  it("returns inspection to storage when its selected group is removed or the numeration is rebuilt", () => {
    let state = placeValueSnapshot(initial(10, 20, "normal"));
    state.selection = { side: "left", unit: state.left.places[1][1][0].start };
    state = changePlaceValueContents(state, "outside", 1000)!;
    const removed = planPlaceValueCount(state, "left", 1, 1, 2500)!;
    expect(removed.selection).toBeNull(); expect(removed.presentation!.contents).toBe("inside");
    expect(placeValueMappingSnapshotSchema.safeParse(removed).success).toBe(true);
    const configured = configurePlaceValue({ ...state, contentsMotion: undefined }, 3, 6)!;
    expect(configured.selection).toBeNull(); expect(configured.presentation!.contents).toBe("inside");
    expect(placeValueMappingSnapshotSchema.safeParse(configured).success).toBe(true);
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
    expect(placeValueMappingSnapshotSchema.safeParse({ ...state, motion: { ...state.motion!, boxStage: "lay" }, presentation: { strategy: "rods", contents: "both" } }).success).toBe(false);
  });
});
