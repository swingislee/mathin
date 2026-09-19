import { describe, expect, it } from "vitest";
import { classWorkHref, communicationEntryMode, currentWorkEntryHref, workEntryHref } from "@/features/school/work-entry-contract";
import { studentStageHref, type StudentStageRow } from "@/features/school/student-stage-contract";

describe("work entry context", () => {
  it("renders stored notification and work-item destinations using current routes", () => {
    expect(currentWorkEntryHref("/zh/dashboard/followups/enrollments?student=a#seat")).toBe("/zh/dashboard/classes?student=a&view=arrange#seat");
    expect(currentWorkEntryHref("/dashboard/teaching?view=progress&classroom=a")).toBe("/dashboard/classes?view=progress&classroom=a");
    expect(currentWorkEntryHref("/dashboard/teaching/assignments/a")).toBe("/dashboard/classes/assignments/a");
    expect(currentWorkEntryHref("/dashboard/coordination?focus=approval:a")).toBe("/dashboard?focus=approval%3Aa&view=work");
    expect(currentWorkEntryHref("/dashboard/followups/assessments/a/reports/b")).toBe("/dashboard/assessments/a/reports/b");
    expect(currentWorkEntryHref("/dashboard/children?child=a#leave")).toBe("/dashboard/children?child=a#leave");
    expect(currentWorkEntryHref("https://example.com/dashboard/teaching")).toBe("https://example.com/dashboard/teaching");
  });
  it("retains class, teacher and period while clearing view-specific paging and fields", () => {
    const href = classWorkHref("records", { classroom: "class-a", teacher: "teacher-a", term: "term-a", page: "3", contactPage: "2", fields: "old" });
    const query = new URL(href, "http://test.invalid").searchParams;
    expect(Object.fromEntries(query)).toEqual({ classroom: "class-a", teacher: "teacher-a", term: "term-a", view: "records", period: "term" });
    expect(classWorkHref("arrange", { classroom: "class-a", session: "lesson-a" })).not.toContain("session=");
  });

  it("keeps the student's existing route default and scopes communication pagination to communication", () => {
    const filters = { stage: "awaiting_renewal", scope: "mine", q: "", detail: "", page: 2, pageSize: 50 } as const;
    expect(studentStageHref(filters)).toMatch(/^\/dashboard\/students\?/);
    expect(studentStageHref(filters, { page: 3 }, "/dashboard/communication")).toContain("/dashboard/communication?");
    expect(studentStageHref(filters, { page: 3 }, "/dashboard/communication")).toContain("page=3");
    expect(workEntryHref("/dashboard/classes", { q: ["甲", "乙"] })).toContain("q=%E7%94%B2&q=%E4%B9%99");
  });

  it("opens the stage-appropriate form while preserving write and contact restrictions", () => {
    const row = { canWrite: true, canContact: true, studentId: "student-a" } as StudentStageRow;
    expect(communicationEntryMode({ ...row, stage: "awaiting_first_contact" })).toBe("contact");
    expect(communicationEntryMode({ ...row, stage: "awaiting_assessment" })).toBe("invitation");
    expect(communicationEntryMode({ ...row, stage: "awaiting_enrollment" })).toBe("enrollment");
    expect(communicationEntryMode({ ...row, stage: "awaiting_renewal" })).toBe("note");
    expect(communicationEntryMode({ ...row, stage: "former_student" })).toBe("note");
    expect(communicationEntryMode({ ...row, stage: "awaiting_assessment", canContact: false })).toBe("note");
    expect(communicationEntryMode({ ...row, stage: "awaiting_enrollment", canWrite: false })).toBe("note");
  });
});
