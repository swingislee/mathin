import { describe, expect, it } from "vitest";
import { constructionArea, constructionObject, constructionObjects, worldVertices } from "@/features/tools/plane-construction/model";
import { isValidPaperState } from "@/features/tools/plane-paper/validation";
import {
  addAreaLesson, alternateAreaLessonBase, areaLessonGroup, areaLessonGroups, areaLessonMeasures, arrangeAreaLesson,
  changeFreePaper, createAreaLessonGeometry, createAreaLessonState, cutAreaLesson, dragAreaLesson, duplicateAreaLesson,
  freePaperState, interpolateAreaLesson, interpolateAreaLessonTransform, isValidAreaLessonState, releaseAreaLesson, removeAreaLesson, resetAreaLesson,
  setAreaLessonField, startAreaLesson, tapAreaLesson, toggleAreaLessonFill, toggleAreaLessonLock, transformAreaLessonPiece,
} from "@/features/tools/plane-paper-lessons/model";
import { AREA_LESSON_KINDS, groupWorld, lessonRecipe, pieceWorld, type AreaLessonGroup, type AreaLessonKind } from "@/features/tools/plane-paper-lessons/geometry";
import { removeConstruction } from "@/features/tools/plane-construction/model";
import type { PlanarState } from "@/features/tools/planar-kit/contract";

const valid = (state: PlanarState) => { expect(isValidAreaLessonState(state)).toBe(true); return state; };
const create = (kind: AreaLessonKind) => valid(addAreaLesson(createAreaLessonState(), kind));
const group = (state: PlanarState) => areaLessonGroup(state)!;
const area = (state: PlanarState) => areaLessonMeasures(group(state));
const polygonArea = (points: readonly { x: number; y: number }[]) => constructionArea(points);
const allPieces = (value: AreaLessonGroup) => lessonRecipe(value).pieces.map((piece, index) => pieceWorld(value, piece, index));

describe("area classroom lesson materials", () => {
  it("keeps free paper, all six mutable lesson kinds and their source geometry in one scene", () => {
    const initial = valid(createAreaLessonState()), original = constructionObjects(initial);
    for (const kind of AREA_LESSON_KINDS) {
      const state = create(kind);
      expect(constructionObjects(state)).toEqual(original);
      expect(group(state).kind).toBe(kind);
      expect(isValidPaperState(freePaperState(state))).toBe(true);
      expect(state.flags.lessonValues).toBe(false); expect(state.flags.lessonGuides).toBe(false);
      expect(isValidPaperState(state)).toBe(false);
    }
  });

  it("attaches the chosen actual parallelogram, preserves every unrelated object, and can change the base", () => {
    const initial = createAreaLessonState(), original = constructionObject(initial)!;
    const attached = valid(startAreaLesson(initial, 14));
    expect(constructionObjects(attached)).toHaveLength(0);
    expect(polygonArea(lessonRecipe(group(attached)).source)).toBeCloseTo(polygonArea(worldVertices(original)), 7);
    const alternate = valid(alternateAreaLessonBase(attached));
    expect(group(alternate).base).not.toBeCloseTo(group(attached).base);
    expect(area(alternate).source).toBeCloseTo(area(attached).source, 7);
    expect(alternateAreaLessonBase(cutAreaLesson(attached))).toEqual(cutAreaLesson(attached));
  });

  it.each([-420, -260, -180, 0, 75, 180, 260, 420])("cuts and reassembles shear %s without changing area or inventing missing strips", (shear: number) => {
    let state = setAreaLessonField(setAreaLessonField(create(14), "lessonBase", 180), "lessonShear", shear);
    valid(state); const source = area(state).source, required = lessonRecipe(group(state)).requiredCuts;
    for (let index = 0; index < required; index++) {
      const before = state; state = valid(cutAreaLesson(state));
      expect(state).not.toBe(before); expect(area(state).total).toBeCloseTo(source, 7);
      const frame = interpolateAreaLesson(before, state, 0.4, true);
      expect(isValidAreaLessonState(frame)).toBe(false);
      expect(group(frame).cuts).toBe(group(before).cuts);
    }
    state = valid(arrangeAreaLesson(state, "arrange"));
    for (const points of allPieces(group(state))) {
      expect(polygonArea(points)).toBeGreaterThan(1);
      const local = points.map((point) => ({ x: point.x - group(state).origin.x, y: point.y - group(state).origin.y }));
      expect(Math.min(...local.map((point) => point.x))).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.max(...local.map((point) => point.x))).toBeLessThanOrEqual(group(state).base + 1e-6);
    }
    expect(area(state).total).toBeCloseTo(source, 7);
    expect(cutAreaLesson(state)).toBe(state);
  });

  it("makes the explicitly approved strongly sheared two-cut process available on real material", () => {
    const initial = createAreaLessonState();
    const custom = createAreaLessonGeometry(initial, "polygon", [{ x: 170, y: 410 }, { x: 350, y: 410 }, { x: 610, y: 230 }, { x: 430, y: 230 }])!;
    let state = valid(startAreaLesson(custom, 14));
    expect(lessonRecipe(group(state)).requiredCuts).toBe(2);
    state = valid(cutAreaLesson(state)); expect(group(state).poses).toHaveLength(2);
    const remaining = `lesson.${group(state).id}.1`;
    state = valid(dragAreaLesson(state, remaining, { x: 0, y: 0 }, { x: 37, y: -29 }));
    const pose = group(state).poses[1]; state = valid(cutAreaLesson(state));
    expect(group(state).poses[1]).toEqual(pose); expect(group(state).poses[2]).toEqual(pose);
    expect(area(state).total).toBeCloseTo(180 * 180, 7);
  });

  it.each([15, 16] as const)("copies and half-turns the current %s paper, including rigid intermediate frames", (kind: 15 | 16) => {
    const initial = create(kind), one = area(initial).source;
    const copied = valid(cutAreaLesson(initial)); expect(group(copied).poses).toHaveLength(2);
    const target = valid(arrangeAreaLesson(copied, "arrange"));
    expect(group(target).poses[1].angle).toBe(180);
    expect(area(target).total).toBeCloseTo(one * 2, 7);
    expect(area(target).frame).toBeCloseTo(one * 2, 7);
    for (const progress of [0.1, 0.5, 0.9]) {
      const frame = interpolateAreaLesson(copied, target, progress);
      allPieces(group(frame)).forEach((piece) => expect(polygonArea(piece)).toBeCloseTo(one, 6));
      expect(isValidAreaLessonState(frame)).toBe(false);
    }
  });

  it("keeps the notched original separate from its complement and offers both exact divisions", () => {
    let state = create(17), original = area(state).source;
    state = valid(cutAreaLesson(state)); expect(area(state).total).toBeCloseTo(original, 7);
    state = valid(toggleAreaLessonFill(state));
    expect(area(state).total).toBeCloseTo(area(state).frame, 7);
    expect(area(state).source + area(state).added).toBeCloseTo(area(state).frame, 7);
    state = valid(setAreaLessonField(state, "lessonAxis", 1));
    expect(area(state).source).toBeCloseTo(original, 7);
    expect(area(state).total).toBeCloseTo(area(state).frame, 7);
    const id = group(state).id;
    state = valid(dragAreaLesson(state, `lesson-notch.${id}`, { x: 0, y: 0 }, { x: -20, y: 30 }));
    expect(area(state).source).not.toBeCloseTo(original);
    expect(area(state).source + area(state).added).toBeCloseTo(area(state).frame, 7);
    original = area(state).source;
    state = valid(toggleAreaLessonFill(state)); expect(area(state).total).toBeCloseTo(original, 7);
  });

  it("constructs one triangle and two noncongruent trapezoids of equal area, then honestly releases the cut", () => {
    let state = valid(cutAreaLesson(create(46)));
    const source = area(state).source;
    expect(area(state).areas).toHaveLength(3);
    expect(lessonRecipe(group(state)).pieces.map((piece) => piece.points.length)).toEqual([3, 4, 4]);
    area(state).areas.forEach((value) => expect(value).toBeCloseTo(source / 3, 7));
    expect(dragAreaLesson(state, `lesson-cut.${group(state).id}`, { x: 0, y: 0 }, { x: 30, y: 0 })).toBe(state);
    state = valid(toggleAreaLessonLock(state));
    state = valid(dragAreaLesson(state, `lesson-cut.${group(state).id}`, { x: 0, y: 0 }, { x: 30, y: 0 }));
    expect(area(state).areas[0]).not.toBeCloseTo(area(state).areas[1]);
    expect(area(state).total).toBeCloseTo(source, 7);
    state = valid(toggleAreaLessonLock(state));
    area(state).areas.forEach((value) => expect(value).toBeCloseTo(source / 3, 7));
  });

  it("rearranges the same four triangles inside the same frame and reports actual uncovered area after a free move", () => {
    const initial = create(58), before = allPieces(group(initial)), expected = group(initial).base ** 2 + group(initial).height ** 2;
    expect(area(initial).remaining).toBeCloseTo(expected, 7);
    const target = valid(arrangeAreaLesson(initial, "two-squares"));
    expect(lessonRecipe(group(target)).frame).toEqual(lessonRecipe(group(initial)).frame);
    expect(area(target).remaining).toBeCloseTo(expected, 7);
    for (const progress of [0.2, 0.55, 0.85]) {
      const frame = interpolateAreaLesson(initial, target, progress, false, true);
      allPieces(group(frame)).forEach((points, index) => {
        expect(polygonArea(points)).toBeCloseTo(polygonArea(before[index]), 7);
        for (let side = 0; side < 3; side++) expect(Math.hypot(points[side].x - points[(side + 1) % 3].x, points[side].y - points[(side + 1) % 3].y))
          .toBeCloseTo(Math.hypot(before[index][side].x - before[index][(side + 1) % 3].x, before[index][side].y - before[index][(side + 1) % 3].y), 7);
      });
    }
    const moved = valid(dragAreaLesson(target, `lesson.${group(target).id}.0`, { x: 0, y: 0 }, { x: -250, y: 0 }));
    expect(area(moved).remaining).toBeGreaterThan(expected);
    expect(area(moved).total).toBeCloseTo(area(initial).total, 7);
  });

  it("supports independent teacher poses, a chosen world pivot and release back to ordinary cuttable pieces", () => {
    let state = valid(cutAreaLesson(create(15)));
    state = tapAreaLesson(state, `lesson.${group(state).id}.1`);
    state = valid(setAreaLessonField(state, "lessonPieceAngle", 37));
    state = valid(setAreaLessonField(state, "lessonPieceX", 570));
    state = valid(setAreaLessonField(state, "pivotX", 200));
    state = valid(setAreaLessonField(state, "pivotY", 220));
    state = valid(setAreaLessonField(state, "turn", 73));
    const before = allPieces(group(state));
    const source = state, target = valid(transformAreaLessonPiece(state, "rotate")), pivot = source.points.pivot;
    for (const progress of [0.2, 0.5, 0.8]) {
      const frame = interpolateAreaLessonTransform(source, target, progress, "rotate"), points = allPieces(group(frame));
      points[1].forEach((point, index) => expect(Math.hypot(point.x - pivot.x, point.y - pivot.y)).toBeCloseTo(Math.hypot(before[1][index].x - pivot.x, before[1][index].y - pivot.y), 7));
      expect(points[0]).toEqual(before[0]); expect(isValidAreaLessonState(frame)).toBe(false);
    }
    state = target;
    expect(allPieces(group(state))[0]).toEqual(before[0]);
    const expected = allPieces(group(state)), others = constructionObjects(state).length;
    state = valid(releaseAreaLesson(state));
    expect(areaLessonGroups(state)).toHaveLength(0);
    expect(constructionObjects(state)).toHaveLength(others + 2);
    const released = constructionObjects(state).slice(-2).map(worldVertices);
    released.forEach((points, index) => points.forEach((point, j) => { expect(point.x).toBeCloseTo(expected[index][j].x, 7); expect(point.y).toBeCloseTo(expected[index][j].y, 7); }));
  });

  it("can keep several groups and free cuts together, with atomic budgets and local deletion", () => {
    let state = create(58); const first = group(state);
    state = valid(addAreaLesson(state, 46));
    const second = group(state); state = valid(cutAreaLesson(state));
    expect(areaLessonGroup(state, first.id)).toEqual(first);
    state = valid(duplicateAreaLesson(state));
    expect(areaLessonGroups(state)).toHaveLength(3);
    state = valid(removeAreaLesson(state));
    expect(areaLessonGroup(state, second.id)).not.toBeNull();
    const free = changeFreePaper(state, removeConstruction); valid(free);
    expect(areaLessonGroups(free)).toHaveLength(2);
    let capacity = create(58);
    while (true) { const next = addAreaLesson(capacity, 58); if (next === capacity) break; capacity = valid(next); }
    expect(areaLessonGroups(capacity)).toHaveLength(3);
    expect(addAreaLesson(capacity, 58)).toBe(capacity);
  });

  it("rejects forged relations, unknown keys, partial cuts and impossible geometry", () => {
    const state = create(46), id = group(state).id;
    for (const invalid of [
      { ...state, params: { ...state.params, surprise: 1 } },
      { ...state, params: { ...state.params, lessonSurprise: 1 } },
      { ...state, params: { ...state.params, lessonNextId: id } },
      { ...state, params: { ...state.params, lessonPiece: 2 } },
      { ...state, params: { ...state.params, [`lessonFraction.${id}`]: 0.4 } },
      { ...state, params: { ...state.params, [`lessonCuts.${id}`]: 0.5 } },
      { ...state, params: { ...state.params, [`lessonBase.${id}`]: 0 } },
      { ...state, points: { ...state.points, [`lessonOffset.${id}.0`]: { x: 9999, y: 0 } } },
      { ...state, flags: { ...state.flags, lessonValues: 1 } },
      { ...state, marks: ["lesson.1.0"] },
    ]) expect(isValidAreaLessonState(invalid as PlanarState)).toBe(false);
    expect(isValidAreaLessonState({ ...state, sceneId: "14-create" })).toBe(false);
    expect(isValidAreaLessonState({ ...freePaperState(state), sceneId: "14-lessons" })).toBe(false);
    expect(resetAreaLesson(valid(cutAreaLesson(state))).params[`lessonCuts.${id}`]).toBe(0);
  });

  it("classifies the actual right-angle and notched polygons after rotation or reflection", () => {
    for (const kind of [17, 46, 58] as const) {
      let state = create(kind); const sample = group(state);
      state = setAreaLessonField(state, "lessonAngle", 29);
      const polygon = lessonRecipe(group(state)).source.map((point) => groupWorld(group(state), point));
      const drawn = createAreaLessonGeometry(createAreaLessonState(), "polygon", polygon)!;
      const attached = valid(startAreaLesson(drawn, kind));
      expect(group(attached).kind).toBe(kind);
      expect(area(attached).source).toBeCloseTo(constructionArea(lessonRecipe(sample).source), 6);
    }
  });
});
