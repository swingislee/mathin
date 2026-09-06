import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nextAssessmentWorkbenchRowId } from "@/features/school/assessment-workbench-contract";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("school support quick entry", () => {
  it("advances only within the current visible assessment list", () => {
    expect(nextAssessmentWorkbenchRowId(["a", "b", "c"], "a")).toBe("b");
    expect(nextAssessmentWorkbenchRowId(["a", "b", "c"], "b")).toBe("c");
    expect(nextAssessmentWorkbenchRowId(["a", "b", "c"], "c")).toBeNull();
    expect(nextAssessmentWorkbenchRowId(["a", "c"], "b")).toBeNull();
  });

  it("uses the existing student follow-up fact for an independent note", () => {
    const entry = read("src", "features", "school", "QuickFollowUpEntry.tsx");
    expect(entry).toContain("addStudentFollowUp");
    expect(entry).toContain('kind: "note"');
    expect(entry).toContain("nextFollowUpAt: null");
    expect(entry).toContain("statusAfter: null");
    expect(entry).toContain("onSaveAndNext");
    expect(entry).toContain("STUDENT_360_REFRESH_EVENT");
  });

  it("keeps the latest situation visible in both assessment and student rows", () => {
    const assessmentData = read("src", "features", "school", "assessment-workbench-data.ts");
    const assessment = read("src", "features", "school", "AssessmentUnifiedWorkbench.tsx");
    const students = read("src", "features", "school", "StudentsTable.tsx");
    expect(assessmentData).toContain('"student_follow_ups"');
    expect(assessmentData).toContain("latestFollowUps");
    expect(assessment).toContain("data-current-situation");
    expect(assessment).toContain("<QuickFollowUpEntry");
    expect(students).toContain("<FollowupInlineDetails");
    expect(students).toContain("<QuickFollowUpEntry");
    expect(students).toContain("lastFollowUpContent");
  });

  it("keeps bilingual copy for a note that does not create a task", () => {
    const zh = JSON.parse(read("messages", "zh.json")) as { school: { quickFollowUp: Record<string, string> } };
    const en = JSON.parse(read("messages", "en.json")) as { school: { quickFollowUp: Record<string, string> } };
    for (const key of ["title", "placeholder", "independentHint", "save", "saveAndNext", "saved", "saveFailed"]) {
      expect(zh.school.quickFollowUp[key]).toBeTruthy();
      expect(en.school.quickFollowUp[key]).toBeTruthy();
    }
  });
});
