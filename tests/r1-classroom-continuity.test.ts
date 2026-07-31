import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLearningSeatSlots,
  learningCheckIdAfterPageChange,
  learningCheckIdForPage,
  learningSeatAssignments,
  moveLearningStudentToSeat,
} from "../src/features/school/session-learning-contract";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const continuityMigration = read("supabase/migrations/20260729000400_r1_classroom_continuity.sql");
const publicationMigration = read("supabase/migrations/20260730000100_r1_session_learning_publications.sql");
const learningCheckFlagMigration = read("supabase/migrations/20260730000400_r1_courseware_page_learning_check_flags.sql");
const learningCheckConfigurationMigration = read("supabase/migrations/20260730000600_r1_session_learning_check_configuration.sql");
const learningCheckMarkFixMigration = read("supabase/migrations/20260730000700_r1_fix_learning_check_mark.sql");
const prepArtifactMigration = read("supabase/migrations/20260730000300_r1_session_preparation_artifacts.sql");
const prepReviewMigration = read("supabase/migrations/20260730000500_r1_session_preparation_review.sql");
const prepUnlockMigration = read("supabase/migrations/20260731000500_r1_preparation_archive_unlock.sql");
const prepUnlockNarrowingMigration = read("supabase/migrations/20260731000800_r1_narrow_preparation_archive_unlock.sql");
const learningSeatOrderMigration = read("supabase/migrations/20260731001000_r1_learning_check_seat_order.sql");
const learningSeatLayoutMigration = read("supabase/migrations/20260731001200_r1_learning_check_seat_layout.sql");

describe("R1 classroom continuity contracts", () => {
  it("bridges active enrollments and claimed student accounts into live classroom membership", () => {
    expect(continuityMigration).toContain("sync_enrollment_classroom_member");
    expect(continuityMigration).toContain("enrollments_sync_classroom_member");
    expect(continuityMigration).toContain("sync_student_account_classroom_members");
    expect(continuityMigration).toContain("insert into public.classroom_members(classroom_id, user_id, role)");
    expect(continuityMigration).toContain("where enrollment_row.status = 'active'");
  });

  it("uses one canonical staff session workspace with operational prep flow and no decision rail", () => {
    const legacyPage = read("src/app/[locale]/classroom/[classId]/session/[sessionId]/page.tsx");
    const workspace = read("src/features/school/SessionWorkspaceBody.tsx");
    const prep = read("src/features/school/SessionPrepPanel.tsx");
    expect(legacyPage).toContain("/dashboard/sessions/");
    expect(legacyPage).toContain("redirect(");
    expect(legacyPage).not.toContain("CoursewareEditor");
    expect(workspace).toContain("SessionPrepCopyAction");
    expect(workspace).toContain("SessionPrepCompleteAction");
    expect(workspace.indexOf('t("rehearse")')).toBeLessThan(workspace.indexOf("<SessionPrepCompleteAction"));
    expect(workspace).not.toContain("SessionWorkspaceRail");
    expect(prep).toContain("SessionPrepAutostart");
    expect(prep).toContain("SessionPreparationFlow");
    expect(prep).not.toContain("SessionPreparationArtifactsForm");
    expect(prep).not.toContain("SessionTrackOverrideSelect");
    expect(prep).toContain("xl:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)]");
    expect(prep).not.toContain("SessionLearningCheckEditor");
  });

  it("keeps the frozen preparation archive visible from the exact session courseware snapshot", () => {
    const prep = read("src/features/school/SessionPrepPanel.tsx");
    const prepFlow = read("src/features/school/SessionPreparationFlow.tsx");
    const overlayEditor = read("src/features/school/CoursewareOverlayEditor.tsx");
    const classes = read("src/features/school/classes.ts");
    expect(prep).toContain("canViewPrepArchive");
    expect(prep).toContain("prepArchiveFrozenTitle");
    expect(prep).toContain("detail.courseware.map((page) => ({ page }))");
    expect(prep).toContain("readOnly={preparationWorkflowReadOnly}");
    expect(prep).not.toContain('t("overlayFrozen")');
    expect(prepFlow).toContain("readOnly?: boolean");
    expect(prepFlow).toContain('t("prepArchiveReadOnly")');
    expect(overlayEditor).toContain("readOnly?: boolean");
    expect(overlayEditor).toContain('ts("coursewareArchivePageRailTitle")');
    expect(classes).toContain("courseware_frozen_at,courseware,courseware_overlay");
  });

  it("temporarily amends the current session snapshot and post-class archive without mutating the formal release", () => {
    const prep = read("src/features/school/SessionPrepPanel.tsx");
    const overlayEditor = read("src/features/school/CoursewareOverlayEditor.tsx");
    const coursewareAction = read("src/features/school/actions/courseware.ts");
    expect(prep).toContain('isFeatureEnabled("teaching.preparation_archive_edit")');
    expect(prep).toContain("canEditPreparationArchive");
    expect(prep).toContain("canAmendSessionArchive");
    expect(prep).toContain("readOnly={preparationWorkflowReadOnly}");
    expect(prep).toContain("learningChecksLocked={!canAmendSessionArchive}");
    expect(prep).toContain("readOnly={!canAmendSessionArchive}");
    expect(prep).toContain("structureReadOnly={!canEditSessionCourseware}");
    expect(prep).not.toContain("openCoursewareWorkspace");
    expect(overlayEditor).toContain("structureReadOnly = readOnly");
    expect(overlayEditor).toContain("prepArchiveUnlockedCoursewareHint");
    expect(coursewareAction).toContain('rpc("amend_session_courseware_snapshot"');
    expect(prepUnlockMigration).toContain("replace_session_learning_checks");
    expect(prepUnlockMigration).toContain("save_courseware_annotation");
    expect(prepUnlockMigration).toContain("and not public.is_feature_enabled('teaching.preparation_archive_edit')");
    expect(prepUnlockNarrowingMigration).toContain("guard_locked_session_preparation_artifact");
    expect(prepUnlockNarrowingMigration).toContain("save_session_lesson_plan");
    expect(prepUnlockNarrowingMigration).toContain("set_session_preparation_reviewer");
    expect(prepUnlockNarrowingMigration).toContain("withdraw_session_lesson_plan");
    expect(prepUnlockNarrowingMigration).toContain("amend_session_courseware_snapshot");
    expect(prepUnlockNarrowingMigration).toContain("courseware = p_courseware");
    expect(prepUnlockNarrowingMigration).toContain("session.courseware.snapshot.amended");
    expect(prepUnlockNarrowingMigration).not.toContain("replace_session_learning_checks");
    expect(prepUnlockNarrowingMigration).not.toContain("save_courseware_annotation");
  });

  it("binds learning-check defaults to published courseware page identity instead of reusable title templates", () => {
    const studio = read("src/features/courseware-studio/CoursewarePageEditor.tsx");
    const prep = read("src/features/school/SessionPrepPanel.tsx");
    expect(learningCheckFlagMigration).toContain("create table if not exists public.cw_page_learning_check_flags");
    expect(learningCheckFlagMigration).toContain("set_cw_page_learning_check_flag");
    expect(learningCheckFlagMigration).toContain("'learningCheckEnabled',rows.learning_check_enabled");
    expect(learningCheckFlagMigration).toContain("source_page_doc_id uuid references public.cw_page_docs(id)");
    expect(studio).toContain('t("learningCheckPageFlagTitle")');
    expect(studio).toContain('t("learningCheckEnabled")');
    expect(studio).not.toContain("teachingRole");
    expect(prep).toContain("getSessionCoursewareLearningCheckPages");
    const overlayEditor = read("src/features/school/CoursewareOverlayEditor.tsx");
    expect(overlayEditor).toContain("toggleLearningCheck");
    expect(overlayEditor).toContain("learningCheckSaveQueue");
    expect(overlayEditor).toContain("learningChecksConfigured");
    expect(overlayEditor).toContain("BadgeCheck");
    expect(overlayEditor).toContain("CoursewarePreviewWorkspace");
    expect(overlayEditor).toContain('railWidth="wide"');
    expect(overlayEditor).toContain("restoreLearningCheckDefaults");
    expect(overlayEditor).toContain("undoRestoreLearningCheckDefaults");
    const sharedPreview = read("src/features/courseware-preview/CoursewarePreviewWorkspace.tsx");
    expect(sharedPreview).toContain("data-courseware-page-rail");
    expect(sharedPreview).toContain("data-courseware-preview-stage");
    expect(sharedPreview).toContain("ResizeObserver");
    expect(sharedPreview).toContain('railWidth?: "standard" | "wide"');
    expect(read("src/features/school/curriculum/LectureCoursewarePreview.tsx")).toContain("CoursewarePreviewWorkspace");
    expect(read("src/features/school/SessionWorkspaceBody.tsx")).toContain('scroll={stage === "pre" ? "none" : "auto"}');
    expect(overlayEditor).not.toContain("learningCheckAddCustom");
    expect(learningCheckConfigurationMigration).toContain("learning_checks_configured_at");
    expect(learningCheckConfigurationMigration).toContain("coalesce(learning_checks_configured_at,now())");
  });

  it("auto-submits each preparation artifact for review and gates completion on approvals", () => {
    const prepFlow = read("src/features/school/SessionPreparationFlow.tsx");
    const reviewPage = read("src/app/[locale]/dashboard/courseware/preparation-review/page.tsx");
    expect(prepArtifactMigration).toContain("create table if not exists public.session_preparation_artifacts");
    expect(prepArtifactMigration).toContain("solution_files");
    expect(prepArtifactMigration).toContain("lesson_plan_files");
    expect(prepArtifactMigration).toContain("rehearsal_video_url");
    expect(prepArtifactMigration).toContain("LEARNING_CHECKS_REQUIRED");
    expect(prepReviewMigration).toContain("create table public.session_preparation_reviews");
    expect(prepReviewMigration).toContain("notify_session_preparation_reviewers");
    expect(prepReviewMigration).toContain("session.preparation.submitted");
    expect(prepReviewMigration).toContain("review_session_preparation_artifact");
    expect(prepReviewMigration).toContain("PREP_REVIEW_REQUIRED");
    expect(prepFlow).toContain("saveQueue");
    expect(prepFlow).toContain("latest.current = next");
    expect(prepFlow).not.toContain('type="submit"');
    expect(reviewPage).toContain("listSessionPreparationReviews");
  });

  it("keeps the preparation canvas fixed while resolving H5 entries through the shared preview workspace", () => {
    const workspace = read("src/features/school/SessionWorkspaceBody.tsx");
    const sessionAssets = read("src/features/classroom/courseware/session-assets.ts");
    const prep = read("src/features/school/SessionPrepPanel.tsx");
    const sharedPreview = read("src/features/courseware-preview/CoursewarePreviewWorkspace.tsx");
    expect(workspace).toContain('scroll={stage === "pre" ? "none" : "auto"}');
    expect(sessionAssets).toContain("getSessionH5BindingUrls");
    expect(sessionAssets).toContain("buildH5EntryUrl");
    expect(prep).toContain("getSessionH5BindingUrls");
    expect(sharedPreview).toContain("grid h-full min-h-0");
    expect(sharedPreview).toContain("overflow-y-auto");
    expect(sharedPreview).toContain('aria-keyshortcuts="ArrowLeft PageUp"');
    expect(sharedPreview).toContain('aria-keyshortcuts="ArrowRight PageDown Space"');
    const docStage = read("src/features/courseware-doc/DocStage.tsx");
    expect(docStage).toContain("data-board-band");
    expect(docStage).toContain('className="bg-card"');
    const lecturePreview = read("src/features/school/curriculum/LectureCoursewarePreview.tsx");
    const lecturePanel = read("src/features/school/curriculum/LecturePreviewPanel.tsx");
    expect(lecturePreview).toContain("fillAvailable");
    expect(lecturePreview).not.toContain("PreviewKeyboardNavigation");
    expect(lecturePanel).toContain("flex-1 overflow-hidden bg-paper");
    expect(lecturePanel).not.toContain("flex-1 overflow-y-auto bg-paper");
  });

  it("makes attendance the first persisted gate before a formal class starts", () => {
    const livePage = read("src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx");
    const liveShell = read("src/features/classroom/live/LiveShell.tsx");
    const actions = read("src/features/classroom/actions.ts");
    expect(livePage).toContain("getAttendanceDrawerData");
    expect(livePage).toContain("initialAttendanceComplete");
    expect(liveShell).toContain("attendanceRequired && !attendanceComplete");
    expect(liveShell).toContain("AttendanceDrawer");
    expect(actions).toContain('throw new Error("ATTENDANCE_REQUIRED")');
  });

  it("ships a teacher page list, protected student media, and one-touch or batch learning checks", () => {
    const liveShell = read("src/features/classroom/live/LiveShell.tsx");
    const video = read("src/features/classroom/live/VideoStage.tsx");
    const panel = read("src/features/school/SessionLearningCheckPanel.tsx");
    const learningSetup = read("src/features/school/session-learning.ts");
    const learningActions = read("src/features/school/session-learning-actions.ts");
    expect(liveShell).toContain("PanelsTopLeft");
    expect(liveShell).toContain('t("pageList")');
    expect(liveShell).toContain('page?.type === "doc"');
    expect(video).toContain("pointer-events-none");
    expect(liveShell).toContain("prioritizeDocObjectHashes");
    expect(liveShell).toContain("takePrioritizedDocObjectHash");
    expect(liveShell).toContain("Math.min(4, queue.length)");
    expect(liveShell).toContain('t("assetLoading")');
    expect(continuityMigration).toContain("create table public.session_learning_checks");
    expect(continuityMigration).toContain("create table public.session_learning_check_results");
    expect(continuityMigration).toContain("mark_session_learning_check");
    expect(panel).toContain("LEARNING_CHECK_STATUSES.map");
    expect(panel).toContain("mark([student.id], candidate)");
    expect(panel).toContain("selectedStudentIds");
    expect(panel).toContain("data-learning-check-toolbar");
    expect(panel).toContain("data-learning-check-strip");
    expect(panel).toContain("data-ipad-roster-grid");
    expect(panel).toContain("grid-cols-4");
    expect(panel).toContain("min-[900px]:grid-cols-5");
    expect(panel).toContain("auto-rows-[minmax(8.5rem,1fr)]");
    expect(panel).toContain("data-learning-seat-index");
    expect(panel).toContain("data-learning-empty-seat");
    expect(panel).toContain("Armchair");
    expect(panel).toContain("GripVertical");
    expect(panel).toContain("learningStatusShort_");
    expect(panel).toContain("min-h-11");
    expect(panel).toContain("saveClassroomStudentSeatLayoutAction");
    expect(panel).toContain("learningCheckIdForPage");
    expect(learningActions).toContain('rpc("save_classroom_student_seat_layout"');
    expect(learningSetup).toContain('.from("classroom_student_seat_order")');
    expect(learningSetup).toContain("seatPositionByStudentId");
    expect(learningSeatOrderMigration).toContain("create table public.classroom_student_seat_order");
    expect(learningSeatOrderMigration).toContain("save_classroom_student_seat_order");
    expect(learningSeatOrderMigration).toContain("ROSTER_CHANGED");
    expect(learningSeatOrderMigration).toContain("classroom.student_seat_order.updated");
    expect(learningSeatOrderMigration).toContain("is_session_teacher");
    expect(learningSeatLayoutMigration).toContain("save_classroom_student_seat_layout");
    expect(learningSeatLayoutMigration).toContain("p_positions integer[]");
    expect(learningSeatLayoutMigration).toContain("submitted_count <> distinct_position_count");
    expect(learningSeatLayoutMigration).toContain("seatCapacity', 20");
    expect(learningSeatLayoutMigration).toContain("revoke execute on function public.save_classroom_student_seat_order");
    expect(liveShell).toContain("activePageDocId");
    expect(liveShell).not.toContain("operateCourseware");
    expect(learningCheckMarkFixMigration).toContain("v_classroom_id");
    expect(learningCheckMarkFixMigration).toContain("enrollment_row.classroom_id = v_classroom_id");
  });

  it("builds a stable 20-seat plan and moves students through occupied or empty seats", () => {
    const students = [
      { id: "student-a", name: "A", seatPosition: 0 },
      { id: "student-b", name: "B", seatPosition: 3 },
      { id: "student-c", name: "C", seatPosition: null },
    ];
    const slots = buildLearningSeatSlots(students);
    expect(slots).toHaveLength(20);
    expect(slots.map((student) => student?.id ?? null).slice(0, 5))
      .toEqual(["student-a", "student-c", null, "student-b", null]);

    const movedToEmptySeat = moveLearningStudentToSeat(slots, "student-a", 2);
    expect(movedToEmptySeat[0]).toBeNull();
    expect(movedToEmptySeat[2]?.id).toBe("student-a");
    expect(slots[0]?.id).toBe("student-a");

    const swapped = moveLearningStudentToSeat(movedToEmptySeat, "student-a", 3);
    expect(swapped[2]?.id).toBe("student-b");
    expect(swapped[3]?.id).toBe("student-a");
    expect(learningSeatAssignments(swapped)).toEqual([
      { studentId: "student-c", position: 1 },
      { studentId: "student-b", position: 2 },
      { studentId: "student-a", position: 3 },
    ]);
  });

  it("maps the shared live page identity to a learning check without overriding manual-only legacy items", () => {
    const checks = [
      { id: "check-1", position: 0, title: "例题", sourcePageId: "page-1" },
      { id: "check-2", position: 1, title: "旧检查项", sourcePageId: null },
    ];
    expect(learningCheckIdForPage(checks, "page-1")).toBe("check-1");
    expect(learningCheckIdForPage(checks, "page-2")).toBeNull();
    expect(learningCheckIdForPage(checks, null)).toBeNull();
  });

  it("keeps the current learning check when the shared live page has no configured check", () => {
    const checks = [
      { id: "check-1", position: 0, title: "例题一", sourcePageId: "page-1" },
      { id: "check-2", position: 1, title: "例题二", sourcePageId: "page-3" },
    ];
    expect(learningCheckIdAfterPageChange(checks, "check-1", "page-3")).toBe("check-2");
    expect(learningCheckIdAfterPageChange(checks, "check-2", "page-4")).toBe("check-2");
    expect(learningCheckIdAfterPageChange(checks, "check-2", null)).toBe("check-2");
    expect(learningCheckIdAfterPageChange(checks, null, "page-4")).toBe("check-1");
  });

  it("prioritizes 4:3 courseware and keeps both collapsible teacher docks on the right", () => {
    const liveShell = read("src/features/classroom/live/LiveShell.tsx");
    const toolbar = read("src/features/whiteboard/Toolbar.tsx");
    expect(liveShell).toContain("flex-col gap-2 overflow-y-auto xl:flex-row");
    expect(liveShell).toContain("data-side-board-viewport");
    expect(liveShell).toContain("sideZoom * 100");
    expect(liveShell).toContain("lastPoint[1] * viewport.scrollHeight");
    expect(liveShell).toContain('myRole === "student" && !showAllStudents');
    expect(liveShell).toContain('t("showClassmates")');
    expect(liveShell).toContain("sideCollapsed && rosterCollapsed");
    expect(liveShell).toContain("5.25rem");
    expect(liveShell).toContain("xl:justify-end");
    expect(liveShell).toContain("transition-[width] duration-200");
    expect(liveShell).toContain('t("moreClassroomTools")');
    expect(liveShell).not.toContain("compact");
    expect(toolbar).not.toContain("compact?: boolean");
  });

  it("publishes knowledge summary, assignment, and video as three independent tasks", () => {
    const postwork = read("src/features/school/SessionPostworkPanel.tsx");
    expect(publicationMigration).toContain("publish_session_assignment");
    expect(publicationMigration).toContain("publish_session_video_task");
    expect(publicationMigration).toContain("knowledge_summary.published");
    expect(postwork).toContain("SessionFamilyBriefPanel");
    expect(postwork).toContain("SessionAssignmentPublisher");
    expect(postwork).toContain("SessionVideoTaskPublisher");
  });

  it("reports attendance and learning checks while preserving uncaptured digital metrics", () => {
    const report = read("src/features/classroom/report.ts");
    const reportPage = read("src/app/[locale]/classroom/[classId]/session/[sessionId]/report/page.tsx");
    expect(report).toContain("hasHandEvents");
    expect(report).toContain("hasQuizEvents");
    expect(reportPage).toContain('t("notCaptured")');
    expect(reportPage).toContain("report.learningChecks");
    expect(reportPage).toContain("attendanceStatus");
  });
});
