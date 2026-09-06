import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStudentLifecycleStage, STUDENT_LIFECYCLE_ROADMAP, STUDENT_LIFECYCLE_STAGES } from "@/features/school/student-lifecycle-contract";

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

  it("places five process tables around four milestones with renewal as a continuation", () => {
    expect(STUDENT_LIFECYCLE_ROADMAP).toEqual([
      { table: "leads", milestone: "awaiting_first_contact" },
      { table: "communication", milestone: "awaiting_assessment" },
      { table: "assessments", milestone: "awaiting_enrollment" },
      { table: "enrollments", milestone: "awaiting_renewal" },
      { table: "renewals", milestone: null },
    ]);
    expect(STUDENT_LIFECYCLE_ROADMAP.flatMap(({ milestone }) => milestone ? [milestone] : []))
      .toEqual(STUDENT_LIFECYCLE_STAGES);
  });

  it("separates process labels from circular milestones and highlights the current position", () => {
    const sheet = fs.readFileSync("src/features/school/Student360Sheet.tsx", "utf8");
    expect(sheet).toContain("data-student-lifecycle={snapshot.lifecycleStage}");
    expect(sheet).toContain("Student360LifecycleRail");
    expect(sheet).toContain("STUDENT_LIFECYCLE_ROADMAP.map(({ table, milestone }, index)");
    expect(sheet).toContain('grid-cols-5 grid-rows-[auto_2rem_auto]');
    expect(sheet).toContain("data-student-lifecycle-process={table}");
    expect(sheet).toContain("data-student-lifecycle-milestone={milestone}");
    expect(sheet).toContain("data-student-lifecycle-connector");
    expect(sheet).toContain("data-student-lifecycle-continuation");
    expect(sheet).toContain('aria-current={current ? "step" : undefined}');
    expect(sheet).not.toContain("LIFECYCLE_ICONS");
    expect(sheet).not.toContain("grid-cols-7");
    expect(sheet).not.toContain("Student360PhaseRail");
    expect(sheet).not.toContain("student-360-description");
    expect(sheet).not.toContain('t("createProfile")');
  });

  it("names reached milestones instead of pending actions and reuses the five table names", () => {
    for (const locale of ["zh", "en"]) {
      const school = JSON.parse(fs.readFileSync(`messages/${locale}.json`, "utf8")).school;
      const copy = school.student360;
      expect(STUDENT_LIFECYCLE_STAGES.map((stage) => copy[`milestone_${stage}`])).toEqual(locale === "zh"
        ? ["线索入池", "建立联系", "完成测评", "确认报名"]
        : ["Lead added", "Contact made", "Assessed", "Enrolled"]);
      for (const { table } of STUDENT_LIFECYCLE_ROADMAP) expect(school.followupWorkspace[table]).toBeTruthy();
      for (const stage of STUDENT_LIFECYCLE_STAGES) expect(copy[`lifecycle_${stage}`]).toBeUndefined();
      expect(copy.lifecycleProcess).toContain("{table}");
      expect(copy.lifecycleCurrent).toBeTruthy();
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
