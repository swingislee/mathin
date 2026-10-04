import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanarState } from "@/features/tools/planar-kit/contract";
import type { PlanarDrawingApi } from "@/features/tools/planar-kit/types";
import { constructionObjects } from "@/features/tools/plane-construction/model";
import { AREA_LESSON_KINDS, lessonRecipe } from "@/features/tools/plane-paper-lessons/geometry";
import { addAreaLesson, areaLessonGroup, areaLessonGroups, createAreaLessonState, cutAreaLesson, freePaperState, isValidAreaLessonState, setAreaLessonField } from "@/features/tools/plane-paper-lessons/model";
import { planeAreaLessonScene as definition } from "@/features/tools/plane-paper-lessons/scenes";
import { planeAreaLessonCases } from "./fixtures/plane-area-lessons-cases";

const actions = [...definition.actions!, ...definition.operations!.flatMap((operation) => operation.actions ?? [])];
const action = (id: string) => actions.find((entry) => entry.id === id)!;
const target = (state: PlanarState) => areaLessonGroup(state) ? `lesson.${state.params.lessonActive}.${state.params.lessonPiece}` : `object.${state.params.active}`;
const context = (state: PlanarState) => ({ selected: target(state) });
const api = (state: PlanarState, operation?: string, locale = "zh"): PlanarDrawingApi => ({
  ...context(state), locale, operation, editable: true,
  bind: (value, label) => ({ role: "button", tabIndex: 0, "aria-label": label ?? value, "aria-pressed": value === target(state), "aria-disabled": false }),
});
const draw = (state: PlanarState, operation?: string, locale?: string) => renderToStaticMarkup(createElement("svg", null, definition.draw(state, api(state, operation, locale))));

describe("area lessons through the shared scene interface", () => {
  it("keeps the free-paper workflow and exposes six operations with editable material groups", () => {
    const initial = definition.create(); expect(isValidAreaLessonState(initial)).toBe(true);
    expect(definition.construction!.tools.map((tool) => tool.id)).toEqual(["rectangle", "polygon", "cut-line"]);
    for (const kind of AREA_LESSON_KINDS) {
      const material = definition.materials!.find((entry) => entry.id === `lesson-material-${kind}`)!;
      const state = material.add(initial), group = areaLessonGroup(state)!;
      expect(group.kind).toBe(kind); expect(constructionObjects(state)).toEqual(constructionObjects(initial));
      expect(definition.operations!.find((operation) => operation.id === `lesson-${kind}`)?.fields?.length).toBeGreaterThanOrEqual(2);
      const html = draw(state); expect(html).toContain(`data-area-lesson-kind="${kind}"`);
      expect(html).not.toContain("data-area-lesson-values="); expect(html).not.toContain("data-area-lesson-source="); expect(html).not.toContain("data-area-lesson-cut-line=");
      const shown = action("lesson-values").run(state, context(state));
      expect(shown.params.lessonActive).toBe(group.id); expect(draw(shown)).toContain("data-area-lesson-values=");
      expect(definition.contextActions!(shown, target(shown))?.items).toContainEqual({ kind: "operation", id: `lesson-${kind}` });
    }
  });

  it("acts on a selected real paper and retains unrelated paper and classroom groups", () => {
    const initial = addAreaLesson(createAreaLessonState(), 58), old = areaLessonGroups(initial);
    const paper = definition.construction!.create(initial, "polygon", [{ x: 100, y: 470 }, { x: 280, y: 470 }, { x: 370, y: 590 }, { x: 190, y: 590 }])!;
    expect(isValidAreaLessonState(paper)).toBe(true);
    const started = action("lesson-14-start").run(paper, context(paper));
    expect(areaLessonGroups(started)).toHaveLength(2); expect(areaLessonGroups(started)[0]).toEqual(old[0]);
    expect(constructionObjects(started)).toHaveLength(constructionObjects(initial).length);
    const duplicated = action("construction-duplicate").run(started, context(started)); expect(areaLessonGroups(duplicated)).toHaveLength(3);
    const removed = action("construction-remove").run(duplicated, context(duplicated)); expect(areaLessonGroups(removed)).toEqual(areaLessonGroups(started));
  });

  it("requires every actual altitude cut before a strongly sheared paper can be reassembled", () => {
    let state = setAreaLessonField(setAreaLessonField(addAreaLesson(createAreaLessonState(), 14), "lessonBase", 180), "lessonShear", 260);
    const cut = action("lesson-14-cut"), arrange = action("lesson-14-arrange");
    expect(arrange.disabled!(state, context(state))).toBe(true);
    for (let index = 0; index < 2; index++) {
      const after = cut.run(state, context(state)), frame = cut.interpolate!(state, after, 0.5);
      expect(definition.isExact!(frame)).toBe(false); expect(areaLessonGroup(frame)!.cuts).toBe(index);
      expect(draw(frame, "lesson-14")).toContain("data-area-lesson-cut-line="); state = after;
    }
    expect(arrange.disabled!(state, context(state))).toBe(false);
    const after = arrange.run(state, context(state)); expect(definition.isExact!(after)).toBe(true);
    expect(areaLessonGroup(after)!.poses).toHaveLength(3);
    expect(draw(after, "lesson-14", "en")).toContain("Move the whole group and its frame");
  });

  it("keeps selected lesson focus through common controls and interpolates around the chosen world pivot", () => {
    let state = cutAreaLesson(addAreaLesson(createAreaLessonState(), 15));
    state = definition.tap!(state, `lesson.${state.params.lessonActive}.1`);
    state = action("construction-names").run(state, context(state)); expect(state.params.lessonPiece).toBe(1);
    state = definition.setField!(state, "pivotX", 310); state = definition.setField!(state, "pivotY", 330); state = definition.setField!(state, "turn", 63);
    const rotate = action("construction-rotate"), endpoint = rotate.run(state, context(state));
    expect(endpoint).not.toEqual(state); expect(definition.isExact!(rotate.interpolate!(state, endpoint, 0.5))).toBe(false);
    expect(definition.isExact!(endpoint)).toBe(true); expect(action("construction-reflect").disabled!(state, context(state))).toBe(true);
    const released = action("lesson-release").run(endpoint, context(endpoint));
    expect(areaLessonGroups(released)).toHaveLength(0); expect(constructionObjects(released)).toHaveLength(3);
    expect(action("construction-reflect").disabled!(released, context(released))).toBe(false);
    const reflection = action("construction-reflect"), reflected = reflection.run(released, context(released));
    const projection = reflection.interpolate!(released, reflected, 0.5); expect(definition.isExact!(projection)).toBe(false);
    expect(draw(projection)).toContain("data-construction-object=");
  });

  it("uses one length unit for exact fields, pieces and areas, and only exposes the unlocked cut handle", () => {
    let state = addAreaLesson(createAreaLessonState(), 46);
    state = definition.setField!(state, "lessonBase", 9); state = definition.setField!(state, "lessonHeight", 6);
    expect(areaLessonGroup(state)!.base).toBe(270); expect(areaLessonGroup(state)!.height).toBe(180);
    expect(draw(state, "lesson-46")).not.toContain(`data-area-lesson-handle="lesson-cut.`);
    state = action("lesson-46-cut").run(state, context(state)); state = action("lesson-values").run(state, context(state));
    expect(draw(state)).toContain("原图 54 u²"); expect(draw(state).match(/18 u²/g)).toHaveLength(3);
    state = action("lesson-46-lock").run(state, context(state)); expect(draw(state, "lesson-46")).toContain(`data-area-lesson-handle="lesson-cut.`);
    state = definition.setField!(state, "lessonFraction", 60); expect(areaLessonGroup(state)!.fraction).toBe(0.6);
    expect(lessonRecipe(areaLessonGroup(state)!).pieces).toHaveLength(3); expect(draw(state)).not.toContain("18 u²");
  });

  it("matches state fixture acceptance without changing historical free-paper states", () => {
    for (const fixture of planeAreaLessonCases()) {
      if (["v3-state-as-v2", "empty-title", "extra-envelope"].includes(fixture.label)) continue;
      expect(isValidAreaLessonState(fixture.scene.payload.initial), fixture.label).toBe(fixture.accepted);
    }
    const initial = createAreaLessonState(); expect(freePaperState(initial).sceneId).toBe("14-create");
    expect(definition.isExact!({ ...initial, sceneId: "14-create" })).toBe(false);
    expect(definition.selectionAfterChange!(initial, addAreaLesson(initial, 58), `object.${initial.params.active}`)).toBe("lesson.1.0");
  });
});
