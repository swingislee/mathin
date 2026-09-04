import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("DEV-SCHOOL-OPS-1 public-class workbench", () => {
  it("models a public class as an activity with segments instead of a temporary classroom", () => {
    const migration = read("supabase", "migrations", "20260904000240_public_class_event_workbench.sql");

    expect(migration).toContain("create table public.public_class_segments");
    expect(migration).toContain("'trial_lesson', 'group_assessment', 'parent_talk'");
    expect(migration).toContain("create table public.public_class_classroom_links");
    expect(migration).toContain("link_public_classroom");
    expect(migration).not.toContain("insert into public.classrooms");
    expect(migration).not.toContain("class_session_id");
  });

  it("links activity segments directly to the existing microcourse catalog", () => {
    const migration = read("supabase", "migrations", "20260904000240_public_class_event_workbench.sql");
    const workspace = read("src", "features", "school", "PublicClassWorkspace.tsx");

    expect(migration).toContain("microcourse_course_id");
    expect(migration).toContain("microcourse_lecture_id");
    expect(migration).toContain("link_public_class_segment_microcourse");
    expect(migration).toContain("family.slug = 'teacher-microcourses'");
    expect(workspace).toContain("openMicrocourseSystem");
    expect(workspace).toContain("/dashboard/courses/");
    expect(workspace).not.toContain("/dashboard/sessions/");
  });

  it("keeps one roster with role-aware records for every segment", () => {
    const migration = read("supabase", "migrations", "20260904000240_public_class_event_workbench.sql");
    const workspace = read("src", "features", "school", "PublicClassWorkspace.tsx");

    expect(migration).toContain("create table public.public_class_participant_records");
    expect(migration).toContain("learning_observation");
    expect(migration).toContain("assessment_summary");
    expect(migration).toContain("parent_feedback");
    expect(migration).toContain("recommendation");
    expect(workspace).toContain("ParticipantRows");
    expect(workspace).toContain("presence_${value}");
    expect(workspace).toContain("sharedRecordHint");
  });

  it("offers printable sign-in sheets, chest badges, and desk cards from the same roster", () => {
    const print = read("src", "features", "school", "PublicClassPrintView.tsx");
    const page = read("src", "app", "[locale]", "dashboard", "activities", "[activityId]", "print", "page.tsx");

    expect(print).toContain('["signin", "badge", "desk"]');
    expect(print).toContain("window.print()");
    expect(print).toContain("public-class-print-root");
    expect(page).toContain("getPublicClassWorkbench");
    expect(fs.existsSync(path.join(root, "public", "illustrations", "public-class-print-background-v1.png"))).toBe(true);
  });

  it("exposes class-to-activity navigation while leaving enrollment explicit", () => {
    const classPage = read("src", "app", "[locale]", "dashboard", "classes", "[classId]", "page.tsx");
    const panel = read("src", "features", "school", "PublicClassSourcePanel.tsx");
    const migration = read("supabase", "migrations", "20260904000240_public_class_event_workbench.sql");

    expect(classPage).toContain("listPublicClassesForClassroom");
    expect(classPage).toContain("PublicClassSourcePanel");
    expect(panel).toContain("?view=conversion");
    expect(migration).toContain("registration.student_id is not null");
    expect(migration).not.toContain("insert into public.enrollments");
  });
});
