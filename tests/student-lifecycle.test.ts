import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStudentLifecycleStage, STUDENT_LIFECYCLE_STAGES } from "@/features/school/student-lifecycle-contract";

describe("student lifecycle tags", () => {
  it("accepts exactly the four business milestones", () => {
    expect(STUDENT_LIFECYCLE_STAGES).toEqual([
      "awaiting_first_contact", "awaiting_assessment", "awaiting_enrollment", "awaiting_renewal",
    ]);
    for (const stage of STUDENT_LIFECYCLE_STAGES) expect(parseStudentLifecycleStage(stage)).toBe(stage);
    for (const transient of ["unassigned", "unreachable", "awaiting_parent", "awaiting_class", "", null]) {
      expect(() => parseStudentLifecycleStage(transient)).toThrow("INVALID_STUDENT_LIFECYCLE");
    }
  });

  it("replaces the rail and explanatory copy with one current tag", () => {
    const sheet = fs.readFileSync("src/features/school/Student360Sheet.tsx", "utf8");
    expect(sheet).toContain("data-student-lifecycle={snapshot.lifecycleStage}");
    expect(sheet).not.toContain("Student360PhaseRail");
    expect(sheet).not.toContain("student-360-description");
    expect(sheet).not.toContain('t("createProfile")');
    for (const locale of ["zh", "en"]) {
      const copy = JSON.parse(fs.readFileSync(`messages/${locale}.json`, "utf8")).school.student360;
      for (const stage of STUDENT_LIFECYCLE_STAGES) expect(copy[`lifecycle_${stage}`]).toBeTruthy();
      expect(copy.description).toBeUndefined();
      expect(copy.filter_business).toBe(locale === "zh" ? "入班前" : "Before joining class");
    }
  });

  it("computes milestones independently of timeline limits and checks enrollment before assessment/contact", () => {
    const sql = fs.readFileSync("supabase/migrations/20260906002200_student_profile_after_first_contact.sql", "utf8");
    const lifecycle = sql.slice(sql.indexOf("create or replace function public.get_student_lifecycle"));
    expect(lifecycle).not.toContain("record_state = 'current'");
    expect(lifecycle).not.toContain("limit 500");
    expect(lifecycle.indexOf("return 'awaiting_renewal'")).toBeLessThan(lifecycle.indexOf("return 'awaiting_enrollment'"));
    expect(lifecycle.indexOf("return 'awaiting_enrollment'")).toBeLessThan(lifecycle.indexOf("return 'awaiting_assessment'"));
    expect(lifecycle).toContain("correction.effective_patch ->> 'outcome'");
    expect(lifecycle).toContain("public.can_access_student(v_student_id, v_uid)");
    expect(lifecycle).toContain("SUBJECT_MISMATCH");
  });
});
