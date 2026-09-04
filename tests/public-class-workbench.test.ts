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

  it("lets a segment select or author reusable microcourse content in context", () => {
    const migration = read("supabase", "migrations", "20260904000280_public_class_teaching_flow.sql");
    const workspace = read("src", "features", "school", "PublicClassWorkspace.tsx");
    const editorPage = read("src", "app", "[locale]", "dashboard", "activities", "[activityId]", "segments", "[segmentId]", "microcourse", "page.tsx");

    expect(migration).toContain("microcourse_course_id");
    expect(migration).toContain("microcourse_lecture_id");
    expect(migration).toContain("link_public_class_segment_microcourse");
    expect(migration).toContain("create_public_class_microcourse_project");
    expect(migration).not.toContain("insert into public.classrooms");
    expect(workspace).toContain("chooseExistingCourseware");
    expect(workspace).toContain("createCoursewareHere");
    expect(workspace).toContain("disabled={!option.ready}");
    expect(editorPage).toContain("MicrocourseEditor");
    expect(editorPage).toContain("saveCoursewareAndReturn");
    expect(workspace).not.toContain("/dashboard/sessions/");
  });

  it("runs the whole public class once while keeping agenda blocks internal", () => {
    const migration = read("supabase", "migrations", "20260904000290_public_class_run_continuity.sql");
    const workspace = read("src", "features", "school", "PublicClassWorkspace.tsx");
    const teaching = read("src", "features", "school", "PublicClassRunShell.tsx");
    const livePage = read("src", "app", "[locale]", "activity", "[activityId]", "live", "page.tsx");
    const legacyLivePage = read("src", "app", "[locale]", "activity", "[activityId]", "segment", "[segmentId]", "live", "page.tsx");

    expect(migration).toContain("start_public_class_run");
    expect(migration).toContain("end_public_class_run");
    expect(migration).toContain("public.start_public_class_segment_teaching");
    expect(migration).toContain("public.end_public_class_segment_teaching");
    expect(migration).toContain("kind in ('trial_lesson', 'parent_talk')");
    expect(migration).not.toContain("insert into public.class_sessions");
    expect(workspace).toContain('value: "prepare"');
    expect(workspace).toContain('value: "live"');
    expect(workspace).toContain('value: "review"');
    expect(workspace).toContain("splitAfterLesson");
    expect(workspace).not.toContain("SegmentFlowStep");
    expect(teaching).toContain("startPublicClassRunAction");
    expect(teaching).toContain("endPublicClassRunAction");
    expect(teaching).toContain("CoursewareWorkbench");
    expect(teaching).toContain("PublicClassRosterView");
    expect(livePage).toContain("Promise.all(presentationSegments.map");
    expect(legacyLivePage).toContain("activity/${activityId}/live");
  });

  it("reuses the secured location read model instead of filtering protected room columns", () => {
    const data = read("src", "features", "school", "public-class.ts");

    expect(data).toContain("listActiveRoomOptionsV2()");
    expect(data).not.toContain('.eq("status", "active").order("name"');
  });

  it("keeps route constants on the server side of the React Server Components boundary", () => {
    const page = read("src", "app", "[locale]", "dashboard", "activities", "[activityId]", "page.tsx");
    const data = read("src", "features", "school", "public-class.ts");

    expect(data).toContain("export const PUBLIC_CLASS_VIEWS");
    expect(page).toContain('from "@/features/school/public-class"');
    expect(page).not.toMatch(/PUBLIC_CLASS_VIEWS[\s\S]*from "@\/features\/school\/PublicClassWorkspace"/);
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
    expect(panel).toContain("?view=review");
    expect(migration).toContain("registration.student_id is not null");
    expect(migration).not.toContain("insert into public.enrollments");
  });
});
