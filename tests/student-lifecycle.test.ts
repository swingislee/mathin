import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStudentLifecycleStage, STUDENT_LIFECYCLE_ROADMAP, STUDENT_LIFECYCLE_STAGES } from "@/features/school/student-lifecycle-contract";

describe("student lifecycle tags", () => {
  it("accepts exactly the four original business stages", () => {
    expect(STUDENT_LIFECYCLE_STAGES).toEqual([
      "awaiting_first_contact", "awaiting_assessment", "awaiting_enrollment", "awaiting_renewal",
    ]);
    for (const stage of STUDENT_LIFECYCLE_STAGES) expect(parseStudentLifecycleStage(stage)).toBe(stage);
    for (const transient of ["unassigned", "unreachable", "awaiting_parent", "awaiting_class", "", null]) {
      expect(() => parseStudentLifecycleStage(transient)).toThrow("INVALID_STUDENT_LIFECYCLE");
    }
  });

  it("places five process tables around the original four stage states", () => {
    expect(STUDENT_LIFECYCLE_ROADMAP).toEqual([
      { table: "leads", stage: "awaiting_first_contact" },
      { table: "communication", stage: "awaiting_assessment" },
      { table: "assessments", stage: "awaiting_enrollment" },
      { table: "enrollments", stage: "awaiting_renewal" },
      { table: "renewals", stage: null },
    ]);
    expect(STUDENT_LIFECYCLE_ROADMAP.flatMap(({ stage }) => stage ? [stage] : []))
      .toEqual(STUDENT_LIFECYCLE_STAGES);
  });

  it("separates process labels from circular stage nodes and highlights the current position", () => {
    const sheet = fs.readFileSync("src/features/school/Student360Sheet.tsx", "utf8");
    expect(sheet).toContain("data-student-lifecycle={snapshot.lifecycleStage}");
    expect(sheet).toContain("Student360LifecycleRail");
    expect(sheet).toContain("STUDENT_LIFECYCLE_ROADMAP.map(({ table, stage }, index)");
    expect(sheet).toContain('grid-cols-5 grid-rows-[auto_auto] gap-y-2');
    expect(sheet).not.toContain("grid-rows-[auto_2rem_auto]");
    expect(sheet).toContain('"absolute inset-x-0 top-1/2 h-px"');
    expect(sheet).toContain("data-student-lifecycle-process={table}");
    expect(sheet).toContain("data-student-lifecycle-stage={stage}");
    expect(sheet).toContain("data-student-lifecycle-connector");
    expect(sheet).toContain("data-student-lifecycle-continuation");
    expect(sheet).toContain('aria-current={current ? "step" : undefined}');
    expect(sheet).not.toContain("LIFECYCLE_ICONS");
    expect(sheet).not.toContain("grid-cols-7");
    expect(sheet).not.toContain("Student360PhaseRail");
    expect(sheet).not.toContain("student-360-description");
    expect(sheet).not.toContain('t("createProfile")');
  });

  it("marks earlier nodes and processes in warm tones while keeping the current node green", () => {
    const sheet = fs.readFileSync("src/features/school/Student360Sheet.tsx", "utf8");
    expect(sheet).toContain('data-journey-state={traversed ? "passed" : "future"}');
    expect(sheet).toContain('data-journey-state={current ? "current" : previous ? "passed" : "future"}');
    expect(sheet).toContain('traversed ? "bg-crater/80" : "bg-line"');
    expect(sheet).toContain('bg-moon/40');
    expect(sheet).toContain('bg-moon/60');
    expect(sheet).toContain('current ? "border-leaf-deep"');
    expect(sheet).toContain('size-2 rounded-full bg-leaf-deep');
  });

  it("keeps the original pending-stage meaning instead of substituting completed outcomes", () => {
    for (const locale of ["zh", "en"]) {
      const school = JSON.parse(fs.readFileSync(`messages/${locale}.json`, "utf8")).school;
      const copy = school.student360;
      expect(STUDENT_LIFECYCLE_STAGES.map((stage) => copy[`lifecycle_${stage}`])).toEqual(locale === "zh"
        ? ["待首联", "待测评", "待报名", "待续费"]
        : ["Awaiting first contact", "Awaiting assessment", "Awaiting enrollment", "Awaiting renewal"]);
      for (const { table } of STUDENT_LIFECYCLE_ROADMAP) expect(school.followupWorkspace[table]).toBeTruthy();
      expect(school.followupWorkspace.enrollments).toBe(locale === "zh" ? "分班" : "Class placement");
      expect(school.courseEnrollments.title).toBe(locale === "zh" ? "分班" : "Class placement");
      for (const stage of STUDENT_LIFECYCLE_STAGES) expect(copy[`milestone_${stage}`]).toBeUndefined();
      expect(copy.lifecycleProcess).toContain("{table}");
      expect(copy.lifecycleCurrent).toBeTruthy();
      expect(copy.lifecyclePassed).toBeTruthy();
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
