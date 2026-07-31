import { describe, expect, it } from "vitest";
import {
  coursewareEditorStateFromFrozenSnapshot,
  healOverlay,
  type CoursewareTemplatePage,
  type OverlaySlot,
} from "@/features/school/courseware-overlay";

const TEMPLATE_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOM_ID = "10000000-0000-4000-8000-000000000002";

describe("courseware overlay template identity", () => {
  const template: CoursewareTemplatePage[] = [{
    id: TEMPLATE_ID,
    type: "board",
    title: "Official template title",
  }];

  it("normalizes legacy full-page copies back to immutable template refs", () => {
    const legacyOverlay: OverlaySlot[] = [{
      page: {
        id: TEMPLATE_ID,
        type: "board",
        title: "Teacher-renamed title",
      },
    }];

    expect(healOverlay(template, legacyOverlay)).toEqual([{ ref: TEMPLATE_ID }]);
  });

  it("keeps teacher-inserted pages editable", () => {
    const customPage: OverlaySlot = {
      page: {
        id: CUSTOM_ID,
        type: "board",
        title: "Teacher board",
      },
    };

    expect(healOverlay(template, [customPage])).toEqual([
      { ref: TEMPLATE_ID },
      customPage,
    ]);
  });

  it("treats a frozen default-only snapshot as immutable refs", () => {
    expect(coursewareEditorStateFromFrozenSnapshot(template, [])).toEqual({
      template,
      overlay: [{ ref: TEMPLATE_ID }],
    });
  });

  it("preserves only explicit frozen overlay pages as teacher-inserted pages", () => {
    const customPage: CoursewareTemplatePage = {
      id: CUSTOM_ID,
      type: "board",
      title: "Teacher board",
    };
    const frozenPages = [...template, customPage];

    expect(coursewareEditorStateFromFrozenSnapshot(frozenPages, [
      { ref: TEMPLATE_ID },
      { page: customPage },
    ])).toEqual({
      template,
      overlay: [{ ref: TEMPLATE_ID }, { page: customPage }],
    });
  });
});
