import { afterEach, describe, expect, it, vi } from "vitest";
import { boardTotal, boardUnits, createDefaultPlaceValueInitial, createPlaceValueBoard, PLACE_VALUE_VERSION, placeValueBoardSchema, placeValueInitial, placeValueSnapshot, placeValueSnapshotSchema, validPlaceValueChange, type PlaceValueChange } from "@/features/tools/place-value/contract";
import { changePlaceValueBoard, historyPlaceValue, pausePlaceValue, PLACE_VALUE_CAMERA_TARGET, placeValueCarry, placeValueFrame, placeValueLayout, placeValueNotation, placeValuePendingCarry, placeValuePose, placeValueProgress, planPlaceValue, planPlaceValueCount, resumePlaceValue } from "@/features/tools/place-value/model";
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
  ...value.rotations.flatMap(({ local, pivot, angle, axis }) => local.map((cube) => axis === "x"
    ? { ...cube, x: cube.x + pivot.x, y: cube.y * Math.cos(angle) - cube.z * Math.sin(angle) + pivot.y, z: cube.y * Math.sin(angle) + cube.z * Math.cos(angle) + pivot.z }
    : { ...cube, x: cube.x * Math.cos(angle) + cube.z * Math.sin(angle) + pivot.x, y: cube.y + pivot.y, z: -cube.x * Math.sin(angle) + cube.z * Math.cos(angle) + pivot.z })),
].sort((a, b) => a.id - b.id);
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function expectRigid(units: ReturnType<typeof positions>, ids: number[]) {
  const rod = ids.map((id) => units.find((p) => p.id === id)!);
  expect(distance(rod[0], rod.at(-1)!)).toBeCloseTo(ids.length - 1, 9);
  for (let index = 1; index < rod.length; index++) expect(distance(rod[index - 1], rod[index])).toBeCloseTo(1, 9);
}

describe("place-value counting and grouping", () => {
  it("rejects new counting and edits until the entire 99 + 1 carry chain finishes", () => {
    let state = planPlaceValue(placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(99) }), "add", 1000)!;
    expect(placeValuePendingCarry(state, "left")).toBe("carry-one");
    for (const action of ["add", "remove", "unpack-ten", "carry-ten"] as const) expect(planPlaceValue(state, action, 2000)).toBeNull();
    for (const place of ["ones", "tens", "hundreds"] as const) expect(planPlaceValueCount(state, "left", place, 1, 2000)).toBeNull();
    state = planPlaceValue(state, "carry-one", 2000)!;
    expect(placeValuePendingCarry(state, "left")).toBe("carry-ten");
    expect(planPlaceValue(state, "carry-ten", 3000)).toBeNull();
    expect(planPlaceValueCount(state, "left", "ones", 1, 5000)).toBeNull();
    state = planPlaceValue(state, "carry-ten", 5000)!;
    expect(planPlaceValue(state, "add", 6000)).toBeNull();
    expect(planPlaceValue(state, "add", 13000)!.left.ones).toHaveLength(1);
  });
  it("protects full tens created by their own plus button and retains independent comparison numbers", () => {
    const source = placeValueSnapshot({ ...initial(), mode: "compare", left: createPlaceValueBoard(99), right: createPlaceValueBoard(23) });
    let state = planPlaceValueCount(source, "left", "tens", 10, 1000)!;
    expect(placeValuePendingCarry(state, "left")).toBe("carry-ten");
    expect(planPlaceValueCount(state, "left", "tens", 11, 2000)).toBeNull();
    expect(planPlaceValueCount(state, "left", "ones", 8, 2000)).toBeNull();
    state = planPlaceValueCount(state, "right", "ones", 4, 2000)!;
    expect(boardTotal(state.right)).toBe(24);
    expect(placeValuePendingCarry(state, "left")).toBe("carry-ten");
    expect(planPlaceValueCount(state, "left", "ones", 8, 3000)).toBeNull();
  });
  it("preserves deliberate unpacking for 100 → 99 instead of forcing an immediate carry back", () => {
    let state = placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(100) });
    state = planPlaceValue(state, "unpack-hundred", 1000)!;
    expect(placeValuePendingCarry(state, "left")).toBeNull();
    state = planPlaceValue(state, "unpack-ten", 9000)!;
    expect(placeValuePendingCarry(state, "left")).toBeNull();
    state = planPlaceValue(state, "remove", 12000)!;
    expect(boardTotal(state.left)).toBe(99);
    expect(placeValuePendingCarry(state, "left")).toBeNull();
    state = planPlaceValue(state, "add", 13000)!;
    expect(placeValuePendingCarry(state, "left")).toBe("carry-one");
  });
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
  it("faces the opposite end forward after five rods or chains without recoloring or reordering members", () => {
    for (const place of ["tens", "hundreds"] as const) {
      const board = createPlaceValueBoard(place === "tens" ? 90 : 900), cubes = placeValueLayout(board);
      expect(cubes.filter((p) => p.z === 0).map((p) => p.id % 2)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1]);
      for (const [index, group] of board[place].entries()) {
        const ids = group.flat(), front = cubes.find((p) => p.y === index + .5 && p.z === 0)!;
        expect(front.id).toBe(index < 5 ? ids[0] : ids.at(-1));
        expectRigid(cubes, ids);
        expect(cubes.filter((p) => p.y === index + .5).map((p) => p.id)).toEqual(ids);
      }
      expect(cubes.map((p) => p.id).sort((a, b) => a - b)).toEqual(boardUnits(board).sort((a, b) => a - b));
    }
    const pending = placeValueLayout(createPlaceValueBoard(120, "tens"));
    expect(pending.filter((p) => p.z === 0).map((p) => p.id % 2)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0]);
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
  it.each([10, 20, 60, 100])("rotates the new ten at %i in the correct direction without teleport or disappearance", (value) => {
    const before = changePlaceValueBoard(createPlaceValueBoard(value - 1), "add")!;
    const motion: PlaceValueChange = { side: "left", kind: "carry-one", before, after: changePlaceValueBoard(before, "carry-one")! };
    expect(placeValuePose(motion, 0).cubes).toEqual(placeValueLayout(motion.before));
    for (const t of [.001, .25, .5, .75, .999]) {
      const pose = placeValuePose(motion, t), units = positions(pose);
      expect(units).toHaveLength(value); expect(new Set(units.map((p) => p.id)).size).toBe(value);
      expectRigid(units, motion.after.tens.at(-1)!);
      expect(pose.rotations[0].axis).toBe("x");
      expect(Math.sign(pose.rotations[0].angle)).toBe(value <= 50 ? -1 : 1);
    }
    const end = positions(placeValuePose(motion, 1));
    expect(end).toEqual(placeValueLayout(motion.after).sort((a, b) => a.id - b.id));
    for (const t of [.000001, .999999]) {
      const close = positions(placeValuePose(motion, t)), exact = positions(placeValuePose(motion, t < .5 ? 0 : 1));
      close.forEach((p, i) => expect(Math.hypot(p.x - exact[i].x, p.y - exact[i].y, p.z - exact[i].z)).toBeLessThan(.001));
    }
  });
  it.each([100, 600])("joins rods with visible rigid turns into the %i chain, and unpack retraces the process", (value) => {
    const grouped = createPlaceValueBoard(value), before = { ...grouped, hundreds: grouped.hundreds.slice(0, -1), tens: grouped.hundreds.at(-1)! };
    const motion: PlaceValueChange = { side: "left", kind: "carry-ten", before, after: changePlaceValueBoard(before, "carry-ten")! };
    const from = placeValueLayout(motion.before), end = placeValuePose(motion, 1).cubes;
    expect(Math.max(...end.map((p) => p.z)) - Math.min(...end.map((p) => p.z))).toBe(99);
    const front = end.find((p) => p.z === 0 && p.y === value / 100 - .5)!;
    expect(front.id % 2).toBe(value === 100 ? 0 : 1);
    let turned = false;
    for (const progress of [.05, .35, .75, .95]) {
      const rendered = placeValuePose(motion, progress), pose = positions(rendered);
      expect(pose).toHaveLength(value);
      expect(new Set(pose.map((p) => p.id)).size).toBe(value);
      if (rendered.rotations.length) { turned = true; expect(rendered.rotations[0].axis).toBe("y"); }
      const movingGroups = motion.before.tens.filter((group) => group.some((id) => {
        const p = pose.find((p) => p.id === id)!, a = from.find((p) => p.id === id)!, b = end.find((p) => p.id === id)!;
        return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) > .001 && Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) > .001;
      }));
      expect(movingGroups).toHaveLength(1);
      for (const group of motion.before.tens) expectRigid(pose, group);
      const reverse: PlaceValueChange = { ...motion, kind: "unpack-hundred", before: motion.after, after: motion.before };
      positions(placeValuePose(reverse, 1 - progress)).forEach((p, i) => {
        expect(p.id).toBe(pose[i].id);
        for (const axis of ["x", "y", "z"] as const) expect(p[axis]).toBeCloseTo(pose[i][axis], 9);
      });
    }
    expect(turned).toBe(true);
    for (const progress of [.000001, .999999]) {
      const near = positions(placeValuePose(motion, progress)), exact = positions(placeValuePose(motion, progress < .5 ? 0 : 1));
      near.forEach((p, index) => expect(distance(p, exact[index])).toBeLessThan(.001));
    }
  });
  it.each(["tens", "hundreds"] as const)("turns surviving %s rigidly when a middle unpack crosses the five-group boundary", (place) => {
    const before = createPlaceValueBoard(place === "tens" ? 70 : 700), selected = before[place][2].flat()[0];
    const kind = place === "tens" ? "unpack-ten" : "unpack-hundred";
    const motion: PlaceValueChange = { side: "left", kind, before, after: changePlaceValueBoard(before, kind, selected)! };
    const shifted = before[place][5].flat();
    for (const progress of [.001, .25, .5, .75, .999]) {
      const pose = placeValuePose(motion, progress), units = positions(pose);
      expect(units).toHaveLength(boardTotal(before));
      expect(new Set(units.map((p) => p.id)).size).toBe(boardTotal(before));
      expectRigid(units, shifted);
      expect(pose.rotations.some((r) => r.axis === "y" && r.ids[0] === shifted[0])).toBe(true);
    }
    expect(positions(placeValuePose(motion, 1))).toEqual(placeValueLayout(motion.after).sort((a, b) => a.id - b.id));
    const snapshot = placeValueSnapshot({ ...initial(), left: before, selection: { side: "left", unit: selected } });
    const changed = planPlaceValue(snapshot, kind, 1000)!;
    expect(historyPlaceValue(changed, "undo", 20000)!.left).toEqual(before);
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
  it.each([60, 600])("replays the reversed placement at %i from a paused classroom snapshot", (value) => {
    let state = placeValueSnapshot({ ...initial(), left: createPlaceValueBoard(value - 1) });
    state = planPlaceValue(state, "add", 1000)!;
    state = planPlaceValue(state, "carry-one", 2000)!;
    if (value === 600) state = planPlaceValue(state, "carry-ten", 10000)!;
    state = pausePlaceValue(state, state.motion!.startedAt + state.motion!.durationMs * .65);
    const packet = createClassroomToolState("page", "doc", "reversed-placement", { toolId: "place-value", contentVersion: PLACE_VALUE_VERSION, state }, toolSceneOriginHash(scene()));
    const restored = parseClassroomToolState(JSON.parse(JSON.stringify(packet)))!;
    expect(restored).toEqual(packet);
    const replay = placeValueSnapshotSchema.parse(restored.state);
    expect(placeValuePose(replay.motion!, replay.motion!.progress)).toEqual(placeValuePose(state.motion!, .65));
    expect(placeValueLayout(replay.left)).toEqual(placeValueLayout(state.left));
  });
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
