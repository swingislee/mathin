import type { PlanarState } from "../../src/features/tools/planar-kit/contract";
import { removeConstruction } from "../../src/features/tools/plane-construction/model";
import { AREA_LESSON_KINDS, lessonRecipe } from "../../src/features/tools/plane-paper-lessons/geometry";
import {
  addAreaLesson, areaLessonGroup, arrangeAreaLesson, changeFreePaper, createAreaLessonState, cutAreaLesson,
  dragAreaLesson, freePaperState, interpolateAreaLesson, releaseAreaLesson, setAreaLessonField,
  toggleAreaLessonFill, toggleAreaLessonLock,
} from "../../src/features/tools/plane-paper-lessons/model";

export function planeAreaLessonCases() {
  const cases: { label: string; accepted: boolean; scene: { toolId: string; contentVersion: string; payload: { title: string; initial: PlanarState } } }[] = [];
  const add = (label: string, initial: PlanarState, accepted = true, contentVersion = "plane-area-lesson-v3") => cases.push({ label, accepted, scene: { toolId: "plane-area", contentVersion, payload: { title: "Area dissection exploration", initial } } });
  const initial = createAreaLessonState(), empty = changeFreePaper(initial, removeConstruction);
  add("default-free-paper", initial); add("empty", empty);
  for (const kind of AREA_LESSON_KINDS) {
    let state = addAreaLesson(initial, kind); add(`kind-${kind}-source`, state);
    const required = lessonRecipe(areaLessonGroup(state)!).requiredCuts;
    for (let index = 0; index < required; index++) state = cutAreaLesson(state);
    add(`kind-${kind}-pieces`, state);
    const moved = arrangeAreaLesson(state, kind === 58 ? "two-squares" : "separate"); add(`kind-${kind}-independent-pieces`, moved);
    add(`kind-${kind}-released`, releaseAreaLesson(moved));
    add(`kind-${kind}-rotated`, setAreaLessonField(moved, "lessonAngle", 37));
  }
  for (const shear of [-420, -260, -180, 0, 75, 180, 260, 420]) {
    let state = setAreaLessonField(setAreaLessonField(addAreaLesson(initial, 14), "lessonBase", 180), "lessonShear", shear);
    add(`parallelogram-${shear}-source`, state);
    while (state !== cutAreaLesson(state)) state = cutAreaLesson(state);
    add(`parallelogram-${shear}-partitioned`, state); add(`parallelogram-${shear}-rectangle`, arrangeAreaLesson(state, "arrange"));
  }
  let notch = toggleAreaLessonFill(cutAreaLesson(addAreaLesson(initial, 17)));
  add("notch-filled-horizontal", notch); notch = setAreaLessonField(notch, "lessonAxis", 1); add("notch-filled-vertical", notch);
  add("notch-small-corner", setAreaLessonField(setAreaLessonField(notch, "lessonFraction", 0.01), "lessonNotch", 0.99));
  const equal = cutAreaLesson(addAreaLesson(initial, 46));
  add("equal-unlocked", toggleAreaLessonLock(equal)); add("unequal-cut", setAreaLessonField(toggleAreaLessonLock(equal), "lessonFraction", 0.62));
  const square = addAreaLesson(initial, 58);
  add("frame-moved-piece", dragAreaLesson(square, `lesson.${areaLessonGroup(square)!.id}.0`, { x: 0, y: 0 }, { x: -270, y: 30 }));
  let full = empty;
  for (let index = 0; index < 4; index++) full = addAreaLesson(full, 58);
  add("capacity-four-groups-sixteen-pieces", full);
  const reference = addAreaLesson(initial, 46), id = areaLessonGroup(reference)!.id;
  const invalid = (label: string, change: (state: PlanarState) => void, source = reference) => { const state = structuredClone(source); change(state); add(label, state, false); };
  invalid("unknown-root", (state) => { Object.assign(state, { area: 42 }); });
  invalid("unknown-free-param", (state) => { state.params.extra = 1; });
  invalid("unknown-lesson-param", (state) => { state.params.lessonComputedArea = 42; });
  invalid("unknown-point", (state) => { state.points.lessonResult = { x: 1, y: 2 }; });
  invalid("unknown-flag", (state) => { state.flags.lessonResult = true; });
  invalid("missing-global", (state) => { delete state.params.lessonPiece; });
  invalid("missing-group-field", (state) => { delete state.params[`lessonBase.${id}`]; });
  invalid("missing-pose", (state) => { delete state.points[`lessonOffset.${id}.0`]; });
  invalid("orphan-pose", (state) => { state.points[`lessonOffset.${id}.8`] = { x: 0, y: 0 }; });
  invalid("noncanonical-id", (state) => { state.params["lessonKind.01"] = 46; });
  invalid("next-id-collision", (state) => { state.params.lessonNextId = id; });
  invalid("missing-active-group", (state) => { state.params.lessonActive = 88888; });
  invalid("orphan-selected-piece", (state) => { state.params.lessonActive = -1; });
  invalid("missing-selected-piece", (state) => { state.params.lessonPiece = 1; });
  invalid("fractional-selected-piece", (state) => { state.params.lessonPiece = 0.2; });
  invalid("two-active-materials", (state) => { state.params.active = 0; });
  invalid("unsupported-kind", (state) => { state.params[`lessonKind.${id}`] = 18; });
  invalid("string-kind", (state) => { Object.assign(state.params, { [`lessonKind.${id}`]: "46" }); });
  invalid("null-base", (state) => { Object.assign(state.params, { [`lessonBase.${id}`]: null }); });
  invalid("negative-height", (state) => { state.params[`lessonHeight.${id}`] = -1; });
  invalid("undersized-base", (state) => { state.params[`lessonBase.${id}`] = 11; });
  invalid("excess-base", (state) => { state.params[`lessonBase.${id}`] = 701; });
  invalid("noncanonical-top", (state) => { state.params[`lessonTop.${id}`] = 20; });
  invalid("noncanonical-shear", (state) => { state.params[`lessonShear.${id}`] = 20; });
  invalid("noncanonical-notch", (state) => { state.params[`lessonNotch.${id}`] = 0.5; });
  invalid("noncanonical-axis", (state) => { state.params[`lessonAxis.${id}`] = 1; });
  invalid("noncanonical-fill", (state) => { state.params[`lessonFill.${id}`] = 1; });
  invalid("broken-equal-lock", (state) => { state.params[`lessonFraction.${id}`] = 0.4; });
  invalid("fractional-cut", (state) => { state.params[`lessonCuts.${id}`] = 0.5; });
  invalid("too-many-cuts", (state) => { state.params[`lessonCuts.${id}`] = 2; });
  invalid("zero-flip", (state) => { state.params[`lessonFlip.${id}`] = 0; });
  invalid("excess-angle", (state) => { state.params[`lessonAngle.${id}`] = 36001; });
  invalid("excess-piece-angle", (state) => { state.params[`lessonTurn.${id}.0`] = 36001; });
  invalid("excess-offset", (state) => { state.points[`lessonOffset.${id}.0`].x = 1601; });
  invalid("excess-origin", (state) => { state.points[`lessonOrigin.${id}`].x = 2001; });
  invalid("excess-real-piece-center", (state) => { state.points[`lessonOrigin.${id}`].x = 1999; });
  invalid("extra-point-coordinate", (state) => { Object.assign(state.points[`lessonOrigin.${id}`], { z: 0 }); });
  invalid("string-point-coordinate", (state) => { Object.assign(state.points[`lessonOffset.${id}.0`], { x: "0" }); });
  invalid("nonboolean-guides", (state) => { Object.assign(state.flags, { lessonGuides: 1 }); });
  invalid("forged-lesson-mark", (state) => { state.marks = [`lesson.${id}.0`]; });
  invalid("phase", (state) => { state.phase = 1; });
  const frame = interpolateAreaLesson(square, arrangeAreaLesson(square, "two-squares"), 0.5, false, true); add("presentation-frame", frame, false);
  add("v2-state-as-v3", freePaperState(initial), false); add("v3-state-as-v2", initial, false, "plane-area-lesson-v2");
  const title = structuredClone(cases[0]); title.label = "empty-title"; title.accepted = false; title.scene.payload.title = " "; cases.push(title);
  const extra = structuredClone(cases[0]); extra.label = "extra-envelope"; extra.accepted = false; Object.assign(extra.scene, { answer: 42 }); cases.push(extra);
  return cases;
}
