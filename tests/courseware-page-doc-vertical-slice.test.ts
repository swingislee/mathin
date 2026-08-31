import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isPageDocVerticalSliceSample,
  PAGE_DOC_VERTICAL_SLICE_MODE,
  PAGE_DOC_VERTICAL_SLICE_SAMPLE,
} from "../src/features/courseware-studio/page-doc-vertical-slice";

describe("courseware PageDoc Step 3 vertical slice", () => {
  it("opens write mode only for the explicit local E-series sample", () => {
    expect(isPageDocVerticalSliceSample({
      mode: PAGE_DOC_VERTICAL_SLICE_MODE,
      lectureId: PAGE_DOC_VERTICAL_SLICE_SAMPLE.lectureId,
      pageDocId: PAGE_DOC_VERTICAL_SLICE_SAMPLE.pageDocId,
      pageNo: PAGE_DOC_VERTICAL_SLICE_SAMPLE.pageNo,
    })).toBe(true);

    for (const changed of [
      { mode: undefined },
      { lectureId: "8b7ca0d4-7ca2-4fb8-82dd-9ad0099c0e71" },
      { pageDocId: "8b7ca0d4-7ca2-4fb8-82dd-9ad0099c0e71" },
      { pageNo: PAGE_DOC_VERTICAL_SLICE_SAMPLE.pageNo + 1 },
    ]) {
      expect(isPageDocVerticalSliceSample({
        mode: PAGE_DOC_VERTICAL_SLICE_MODE,
        lectureId: PAGE_DOC_VERTICAL_SLICE_SAMPLE.lectureId,
        pageDocId: PAGE_DOC_VERTICAL_SLICE_SAMPLE.pageDocId,
        pageNo: PAGE_DOC_VERTICAL_SLICE_SAMPLE.pageNo,
        ...changed,
      })).toBe(false);
    }
  });

  it("uses the existing draft revision action without exposing later-step writes", () => {
    const editor = readFileSync("src/features/courseware-studio/PageDocVerticalSliceEditor.tsx", "utf8");
    const actions = readFileSync("src/features/courseware-studio/actions.ts", "utf8");

    expect(editor).toContain("saveCoursewareDraftAction");
    expect(editor).toContain("data-content-changed");
    expect(editor).toContain("data-layout-changed");
    expect(editor).not.toContain("replaceCoursewarePageImageAction");
    expect(editor).not.toContain("publishCoursewareReleaseAction");
    expect(actions).toMatch(/authorizedClient\("courseware\.page\.edit"\)[\s\S]*save_cw_track_page_draft/);
  });
});
