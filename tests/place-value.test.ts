import { afterEach, describe, expect, it, vi } from "vitest";
import { boardTotal, boardUnits, createDefaultPlaceValueInitial, createPlaceValueBoard, PLACE_VALUE_VERSION, placeValueBoardSchema, placeValueInitial, placeValueSnapshot, placeValueSnapshotSchema, validPlaceValueChange, type PlaceValueChange } from "@/features/tools/place-value/contract";
import { changePlaceValueBoard, historyPlaceValue, pausePlaceValue, PLACE_VALUE_CAMERA_TARGET, placeValueCarry, placeValueFrame, placeValueLayout, placeValueNotation, placeValuePose, placeValueProgress, planPlaceValue, planPlaceValueCount, resumePlaceValue } from "@/features/tools/place-value/model";
import { freezeToolScene, parseToolScene, preparedToolDefinitions } from "@/features/tools/scenes/contract";
import { createClassroomToolState, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { newId } from "@/lib/uuid";
import { createEmptyCoursewareCompositionPage, coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";

afterEach(() => vi.unstubAllGlobals());
const initial = () => createDefaultPlaceValueInitial();
const scene = () => ({ toolId: "place-value" as const, contentVersion: PLACE_VALUE_VERSION, payload: { title: "Place value", initial: initial() } });
const change = (value: number, kind: PlaceValueChange["kind"], grouping: "ones" | "tens" | "normal" = "normal"): PlaceValueChange => {
  const before = createPlaceValueBoard(value, grouping), after = changePlaceValueBoard(before, kind)!;
  return { side: "left", kind, before, after };
};
const positions = (value: ReturnType<typeof placeValuePose>) => [
  ...value.cubes,
  ...(value.rotation?.local.map((cube) => {
    const { pivot, angle } = value.rotation!;
    return { ...cube, x: cube.x + pivot.x, y: cube.y * Math.cos(angle) - cube.z * Math.sin(angle) + pivot.y, z: cube.y * Math.sin(angle) + cube.z * Math.cos(angle) + pivot.z };
  }) ?? []),
].sort((a, b) => a.id - b.id);

describe("place-value counting and grouping", () => {
  it("changes one place at a time, preserving other groups and identities through editing and undo", () => {
    const source = placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(234) });
    let state = planPlaceValueCount(source, "left", "tens", 4, 1000)!;
    expect(boardTotal(state.left)).toBe(244); expect(state.left.hundreds).toEqual(source.left.hundreds);
    expect(state.left.ones).toEqual(source.left.ones); expect(state.left.tens.slice(0, 3)).toEqual(source.left.tens);
    expect(state.left.tens[3].map((id) => id % 2)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
    expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
    state = planPlaceValueCount(state, "left", "hundreds", 6, 1010)!;
    expect(boardTotal(state.left)).toBe(644); expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
    state = historyPlaceValue(state, "undo", 1020)!;
    expect(boardTotal(state.left)).toBe(244);
    expect(planPlaceValueCount(state, "left", "hundreds", 10)).toBeNull();
    expect(planPlaceValueCount(state, "left", "tens", -1)).toBeNull();
  });
  it("keeps 9/+1 until regrouping, then animates notation on the same 9→10 and 99→100 timeline", () => {
    for (const value of [9, 99]) {
      let state = planPlaceValue(placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(value) }), "add", 1000)!;
      expect(placeValueNotation(state, "left", "ones", 1).after).toEqual({ digit: 9, extra: 1 });
      expect(placeValueNotation(state, "left", "tens", 1).after).toEqual({ digit: value === 9 ? 0 : 9, extra: 0 });
      state = planPlaceValue(state, "carry-one", 1100)!;
      expect(placeValueNotation(state, "left", "ones", 0)).toMatchObject({ before: { digit: 9, extra: 1 }, after: { digit: 0, extra: 0 }, blend: 0 });
      expect(placeValueNotation(state, "left", "ones", .5).blend).toBe(.5);
      expect(placeValueNotation(state, "left", "tens", 1).after).toEqual(value === 9 ? { digit: 1, extra: 0 } : { digit: 9, extra: 1 });
      if (value === 99) {
        state = planPlaceValue(state, "carry-ten", 5000)!;
        expect(placeValueNotation(state, "left", "hundreds", 0)).toMatchObject({ before: { digit: 0, extra: 0 }, after: { digit: 1, extra: 0 }, blend: 0 });
        expect(placeValueNotation(state, "left", "tens", 1)).toMatchObject({ after: { digit: 0, extra: 0 }, blend: 1 });
      }
    }
    const restored = placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(10, "ones") });
    expect(placeValueNotation(restored, "left", "ones", 1).after).toEqual({ digit: 9, extra: 1 });
  });
  it("provides five-yellow/five-blue front bands without recoloring the original unit blocks", () => {
    for (const place of ["tens", "hundreds"] as const) {
      const board = createPlaceValueBoard(place === "tens" ? 90 : 900), cubes = placeValueLayout(board);
      expect(cubes.filter((p) => p.band !== undefined).map((p) => p.band)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1]);
      expect(cubes.filter((p) => p.band !== undefined).every((p) => p.z === 0 && p.place === place)).toBe(true);
      expect(cubes.map((p) => p.id).sort((a, b) => a - b)).toEqual(boardUnits(board).sort((a, b) => a - b));
    }
  });
  it("fits around the number-front anchor for all values and never recenters on a hundred chain", () => {
    for (const value of [0, 9, 10, 99, 100, 999]) for (const view of ["front", "left", "angle", "top"] as const) {
      const state = { ...initial(), view, left: createPlaceValueBoard(value) };
      expect(placeValueFrame(state).center).toEqual(PLACE_VALUE_CAMERA_TARGET);
    }
  });
  it("keeps identities and five-yellow/five-blue colors through 9 → 10 and 99 → 100", () => {
    for (const value of [9, 19, 99, 199, 998]) {
      let state = placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(value) });
      state = planPlaceValue(state, "add", 1000)!;
      expect(boardTotal(state.left)).toBe(value + 1);
      const ids = boardUnits(state.left).sort((a, b) => a - b);
      let clock = 10_000, steps = 0;
      while (placeValueCarry(state.left)) {
        state = planPlaceValue(state, placeValueCarry(state.left)!, clock)!;
        expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
        expect(boardTotal(state.left)).toBe(value + 1);
        expect(boardUnits(state.left).sort((a, b) => a - b)).toEqual(ids);
        clock += 20_000; steps++;
      }
      expect(steps).toBe(value === 99 || value === 199 ? 2 : value === 998 ? 0 : 1);
      expect(state.left.ones.length).toBe((value + 1) % 10);
    }
    const ten = change(10, "carry-one", "ones");
    expect(ten.after.tens[0].map((id) => id % 2)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  });
  it("unpacks selected middle units, preserves all members and reverses without losing history", () => {
    let state = placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(231) });
    state.selection = { side: "left", unit: state.left.hundreds[0][0][0] };
    const source = state.left;
    state = planPlaceValue(state, "unpack-hundred", 1000)!;
    expect(validPlaceValueChange(state.motion!)).toBe(true);
    expect(state.left.hundreds).toHaveLength(1); expect(state.left.tens).toHaveLength(13);
    state = historyPlaceValue(state, "undo", 20_000)!;
    expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
    expect(state.left).toEqual(source);
    state = historyPlaceValue(state, "redo", 40_000)!;
    state.selection = { side: "left", unit: state.left.tens[1][0] };
    state = planPlaceValue(state, "unpack-ten", 60_000)!;
    expect(state.left.ones).toHaveLength(11);
    expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
    state = historyPlaceValue(state, "undo", 80_000)!;
    expect(placeValueSnapshotSchema.safeParse(state).success).toBe(true);
    expect(boardTotal(state.left)).toBe(231);
  });
  it("stores noncanonical groups and enforces whole-unit, unique-member and 999 bounds", () => {
    for (const grouping of ["normal", "ones", "tens"] as const) {
      const board = createPlaceValueBoard(999, grouping);
      expect(placeValueBoardSchema.parse(board)).toEqual(board);
      expect(changePlaceValueBoard(board, "add")).toBeNull();
    }
    const board = createPlaceValueBoard(20, "ones");
    const duplicate = { ...board, ones: [...board.ones.slice(0, -1), board.ones[0] + 1] };
    expect(placeValueBoardSchema.safeParse(duplicate).success).toBe(false);
    expect(placeValueBoardSchema.safeParse({ ...board, nextId: 0 }).success).toBe(false);
    expect(placeValueBoardSchema.safeParse({ ...board, tens: [[0]] }).success).toBe(false);
    expect(placeValueBoardSchema.safeParse({ ...board, ones: [1.1] }).success).toBe(false);
    expect(changePlaceValueBoard(createPlaceValueBoard(10), "remove")).toBeNull();
    const forged = change(10, "carry-one", "ones");
    forged.after.tens[0].reverse();
    expect(validPlaceValueChange(forged)).toBe(false);
  });
});

describe("visible conservation during animation", () => {
  it("rotates one rigid ten to exactly the existing rod positions with no teleport or disappearance", () => {
    const motion = change(19, "carry-one", "ones");
    expect(placeValuePose(motion, 0).cubes).toEqual(placeValueLayout(motion.before));
    for (const t of [.001, .25, .5, .75, .999]) {
      const pose = placeValuePose(motion, t), units = positions(pose);
      expect(units).toHaveLength(19); expect(new Set(units.map((p) => p.id)).size).toBe(19);
      const group = motion.after.tens[0].map((id) => units.find((p) => p.id === id)!);
      for (let i = 1; i < 10; i++) expect(Math.hypot(group[i].x - group[i - 1].x, group[i].y - group[i - 1].y, group[i].z - group[i - 1].z)).toBeCloseTo(1, 9);
    }
    const end = positions(placeValuePose(motion, 1));
    expect(end).toEqual(placeValueLayout(motion.after).sort((a, b) => a.id - b.id));
    for (const t of [.000001, .999999]) {
      const close = positions(placeValuePose(motion, t)), exact = positions(placeValuePose(motion, t < .5 ? 0 : 1));
      close.forEach((p, i) => expect(Math.hypot(p.x - exact[i].x, p.y - exact[i].y, p.z - exact[i].z)).toBeLessThan(.001));
    }
  });
  it("joins ten rods sequentially into a true 100-unit chain, and unpack retraces the same process", () => {
    const motion = change(100, "carry-ten", "tens"), from = placeValueLayout(motion.before), end = placeValuePose(motion, 1).cubes;
    expect(Math.max(...end.map((p) => p.z)) - Math.min(...end.map((p) => p.z))).toBe(99);
    for (const progress of [.05, .35, .75]) {
      const pose = placeValuePose(motion, progress).cubes;
      expect(pose).toHaveLength(100);
      const movingGroups = motion.before.tens.filter((group) => group.some((id) => {
        const p = pose.find((p) => p.id === id)!, a = from.find((p) => p.id === id)!, b = end.find((p) => p.id === id)!;
        return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) > .001 && Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) > .001;
      }));
      expect(movingGroups).toHaveLength(1);
      for (const group of motion.before.tens) {
        const rod = group.map((id) => pose.find((p) => p.id === id)!);
        expect(rod[0].z - rod[9].z).toBeCloseTo(9);
      }
      const reverse: PlaceValueChange = { ...motion, kind: "unpack-hundred", before: motion.after, after: motion.before };
      placeValuePose(reverse, 1 - progress).cubes.forEach((p, i) => {
        expect(p.id).toBe(pose[i].id);
        for (const axis of ["x", "y", "z"] as const) expect(p[axis]).toBeCloseTo(pose[i][axis], 9);
      });
    }
  });
  it("pauses exactly, resumes by elapsed semantic time and leaves the common camera frame alone", () => {
    const state = planPlaceValue(placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(10, "ones") }), "carry-one", 1000)!;
    const paused = pausePlaceValue(state, 2100);
    expect(placeValueProgress(paused.motion, 100_000)).toBe(.5);
    const resumed = resumePlaceValue(paused, 5000);
    expect(placeValueProgress(resumed.motion, 5550)).toBe(.75);
    expect(placeValueProgress(resumed.motion, 6100)).toBe(1);
    expect(resumed.frame).toEqual(state.frame);
    expect(planPlaceValue(paused, "add", 999999)).toBeNull();
    const compare = { ...initial(), mode: "compare" as const, left: createPlaceValueBoard(100), right: createPlaceValueBoard(999) };
    expect(placeValueFrame(compare).radius).toBeGreaterThanOrEqual(11.7);
    expect(placeValueFrame({ ...compare, view: "left" }).radius).toBeGreaterThan(38);
  });
});

describe("common Tools scene and classroom contracts", () => {
  it("registers both editors, freezes independent scenes and allows another insertion without private draft references", () => {
    for (const surface of ["microcourse", "formal-courseware"] as const) expect(preparedToolDefinitions(surface).some((d) => d.catalogId === "place-value")).toBe(true);
    const source = scene(), frozen = freezeToolScene(source);
    source.payload.initial.left.ones.pop();
    expect(parseToolScene(frozen)).toMatchObject({ payload: { initial: { left: { ones: initial().left.ones } } } });
    expect(() => parseToolScene({ ...frozen, draftId: "private" })).toThrow();
    const page = addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), frozen);
    expect(coursewareCompositionPageSchema.parse(page)).toEqual(page);
  });
  it("roundtrips endpoints, paused motions and a full two-board history within the classroom budget on LAN HTTP", () => {
    vi.stubGlobal("crypto", { getRandomValues: (data: Uint8Array) => { for (let i = 0; i < data.length; i++) data[i] = Math.floor(Math.random() * 256); return data; } });
    expect(newId()).toMatch(/^[a-f0-9-]{36}$/);
    let state = placeValueSnapshot({ ...initial(), mode: "compare", left: createPlaceValueBoard(999, "ones"), right: createPlaceValueBoard(999, "ones") });
    for (let n = 0; n < 12; n++) state = planPlaceValue(state, "carry-one", 10_000 + n * 10_000)!;
    state = pausePlaceValue(state, 120_550);
    const update = { toolId: "place-value" as const, contentVersion: PLACE_VALUE_VERSION, state };
    const packet = createClassroomToolState("page", "doc", "one", update, toolSceneOriginHash(scene()));
    expect(parseClassroomToolState(JSON.parse(JSON.stringify(packet)))).toEqual(packet);
    expect(new TextEncoder().encode(JSON.stringify(packet)).length).toBeLessThan(512_000);
    const other = createClassroomToolState("page", "doc", "two", update, packet.originHash);
    expect(other.instanceId).not.toBe(packet.instanceId);
    expect(placeValueInitial(state)).not.toHaveProperty("motion");
    expect(placeValueInitial(state)).not.toHaveProperty("past");
    expect(parseClassroomToolState({ ...packet, state: { ...state, motion: { ...state.motion, after: createPlaceValueBoard(1) } } })).toBeNull();
  });
});
