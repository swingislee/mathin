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

  it("uses the formal course picker while keeping activity-specific lecture binding in context", () => {
    const migration = read("supabase", "migrations", "20260904000280_public_class_teaching_flow.sql");
    const workspace = read("src", "features", "school", "PublicClassWorkspace.tsx");
    const preparation = read("src", "features", "school", "PublicClassTeachingPreparation.tsx");
    const coursePicker = read("src", "features", "school", "teaching-operations", "CoursePicker.tsx");
    const editorPage = read("src", "app", "[locale]", "dashboard", "activities", "[activityId]", "segments", "[segmentId]", "microcourse", "page.tsx");

    expect(migration).toContain("microcourse_course_id");
    expect(migration).toContain("microcourse_lecture_id");
    expect(migration).toContain("link_public_class_segment_microcourse");
    expect(migration).toContain("create_public_class_microcourse_project");
    expect(migration).not.toContain("insert into public.classrooms");
    expect(preparation).toContain("CoursePicker");
    expect(preparation).toContain("catalog={catalog}");
    expect(coursePicker).toContain("catalog?: readonly ClassBuildCourseDetail[]");
    expect(workspace).not.toContain("MicrocourseDialog");
    expect(workspace).not.toContain("searchMicrocourse");
    expect(preparation).toContain("MicrocourseWorkspaceButton");
    expect(preparation).not.toContain("CreateMicrocourseDialog");
    expect(editorPage).toContain("MicrocourseEditor");
    expect(editorPage).toContain("MicrocourseStartPanel");
    expect(editorPage).toContain("saveCoursewareAndReturn");
    expect(workspace).not.toContain("/dashboard/sessions/");
  });

  it("adapts public-class persistence into the exact formal preparation components", () => {
    const migration = read("supabase", "migrations", "20260904000410_public_class_shared_teaching_workspace.sql");
    const preparation = read("src", "features", "school", "PublicClassTeachingPreparation.tsx");
    const preparationData = read("src", "features", "school", "public-class-preparation.ts");
    const formalFlow = read("src", "features", "school", "SessionPreparationFlow.tsx");
    const formalLessonPlan = read("src", "features", "school", "SessionLessonPlanEditor.tsx");
    const startPanel = read("src", "features", "teacher-microcourses", "MicrocourseStartPanel.tsx");

    expect(migration).toContain("create table public.public_class_segment_preparations");
    expect(migration).toContain("save_public_class_preparation_artifacts");
    expect(migration).toContain("save_public_class_lesson_plan");
    expect(migration).toContain("create_public_class_microcourse_draft");
    expect(preparationData).toContain("getPublicClassPreparations");
    expect(formalFlow).toContain("export function TeachingPreparationFlow");
    expect(formalFlow).toContain("export function SessionPreparationFlow");
    expect(formalLessonPlan).toContain("export function TeachingLessonPlanEditor");
    expect(formalLessonPlan).toContain("export function SessionLessonPlanEditor");
    expect(preparation).toContain("<TeachingPreparationFlow");
    expect(preparation).toContain("<TeachingLessonPlanWorkspace");
    expect(preparation).toContain("previewHeaderLeading={previewHeaderLeading}");
    expect(preparation).not.toContain("teachingPreparationTitle");
    expect(preparation).not.toContain("teachingPreparationHint");
    expect(startPanel).toContain('kind: "session"');
    expect(startPanel).toContain('kind: "public-class"');
    expect(startPanel).toContain("createTeacherMicrocourseAction");
    expect(startPanel).toContain("createPublicClassMicrocourseProjectAction");
  });

  it("runs the whole public class once while keeping agenda blocks internal", () => {
    const migration = read("supabase", "migrations", "20260904000290_public_class_run_continuity.sql");
    const workspace = read("src", "features", "school", "PublicClassWorkspace.tsx");
    const preparation = read("src", "features", "school", "PublicClassTeachingPreparation.tsx");
    const teaching = read("src", "features", "school", "PublicClassRunShell.tsx");
    const livePage = read("src", "app", "[locale]", "activity", "[activityId]", "live", "page.tsx");
    const legacyLivePage = read("src", "app", "[locale]", "activity", "[activityId]", "segment", "[segmentId]", "live", "page.tsx");

    expect(migration).toContain("start_public_class_run");
    expect(migration).toContain("end_public_class_run");
    expect(migration).toContain("public.start_public_class_segment_teaching");
    expect(migration).toContain("public.end_public_class_segment_teaching");
    expect(migration).toContain("kind in ('trial_lesson', 'parent_talk')");
    expect(migration).not.toContain("insert into public.class_sessions");
    expect(workspace).toContain("StageNavigation");
    expect(workspace).not.toContain("ObjectTabs");
    expect(workspace).toContain('value: "pre"');
    expect(workspace).toContain('value: "live"');
    expect(workspace).toContain('value: "post"');
    expect(workspace).not.toContain("<StatusStrip");
    expect(workspace).not.toContain("programMapTitle");
    expect(workspace).not.toContain("SegmentFlowStep");
    expect(preparation).toContain("CoursewareOverlayEditor");
    expect(preparation).toContain("TeachingPreparationSurface");
    expect(preparation).toContain("data-shared-formal-preparation-surface");
    expect(preparation).not.toContain("CoursewareWorkbench");
    expect(preparation).not.toContain("StagePreview");
    expect(preparation).toContain("savePublicClassTeachingCheckpointsAction");
    expect(teaching).toContain("startPublicClassRunAction");
    expect(teaching).toContain("endPublicClassRunAction");
    expect(teaching).toContain("CoursewareWorkbench");
    expect(teaching).toContain("PublicClassRosterView");
    expect(livePage).toContain("Promise.all(presentationSegments.map");
    expect(legacyLivePage).toContain("activity/${activityId}/live");
  });

  it("keeps teacher courseware preparation separate from support materials", () => {
    const migration = read("supabase", "migrations", "20260904000300_public_class_teaching_preparation.sql");
    const workspace = read("src", "features", "school", "PublicClassWorkspace.tsx");
    const preparation = read("src", "features", "school", "PublicClassTeachingPreparation.tsx");
    const formalPreparation = read("src", "features", "school", "SessionPrepPanel.tsx");
    const formalPostwork = read("src", "features", "school", "SessionPostworkPanel.tsx");
    const sharedPreparation = read("src", "features", "school", "TeachingPreparationSurface.tsx");
    const sharedPostwork = read("src", "features", "school", "TeachingPostworkSurface.tsx");
    const sharedCourseware = read("src", "features", "school", "CoursewareOverlayEditor.tsx");

    expect(migration).toContain("create table public.public_class_teaching_checkpoints");
    expect(migration).toContain("replace_public_class_teaching_checkpoints");
    expect(migration).not.toContain("insert into public.class_sessions");
    expect(workspace).toContain("OnsitePreparationView");
    expect(workspace).toContain("PrintView");
    expect(preparation).toContain("teachingCheckpointPageIds");
    expect(preparation).toContain("CoursewareOverlayEditor");
    expect(formalPreparation).toContain("CoursewareOverlayEditor");
    expect(preparation).toContain("TeachingPreparationSurface");
    expect(formalPreparation).toContain("TeachingPreparationSurface");
    expect(workspace).toContain("TeachingPostworkStatus");
    expect(workspace).toContain("TeachingPostworkSection");
    expect(formalPostwork).toContain("TeachingPostworkStatus");
    expect(formalPostwork).toContain("TeachingPostworkSection");
    expect(sharedPreparation).toContain("SessionPrepSplit");
    expect(sharedPostwork).toContain("data-shared-teaching-postwork-section");
    expect(sharedCourseware).toContain("saveLearningChecksOverride");
    expect(sharedCourseware).toContain("learningChecksReadOnly");
  });

  it("keeps activity logistics in the activity row and teaching inside the workbench", () => {
    const manager = read("src", "features", "school", "ActivitiesManager.tsx");
    const workspace = read("src", "features", "school", "PublicClassWorkspace.tsx");

    expect(manager).toContain("?view=onsite");
    expect(manager).toContain("openActivityPreparation");
    expect(manager).toContain("?view=teaching");
    expect(workspace).not.toContain("ObjectTabs");
    expect(workspace).not.toContain("objectTabTeaching");
    expect(workspace).not.toContain("objectTabLogistics");
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
    const printContract = read("src", "features", "school", "public-class-print-contract.ts");
    const page = read("src", "app", "[locale]", "dashboard", "activities", "[activityId]", "print", "page.tsx");

    expect(printContract).toContain('["signin", "badge", "desk"]');
    expect(page).toContain('from "@/features/school/public-class-print-contract"');
    expect(page).not.toMatch(/PUBLIC_CLASS_PRINT_KINDS[\s\S]*from "@\/features\/school\/PublicClassPrintView"/);
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
