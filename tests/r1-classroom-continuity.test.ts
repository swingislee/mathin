import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLearningSeatSlots,
  LEARNING_SEAT_COLUMNS,
  LEARNING_SEAT_ROWS,
  learningCheckIdAfterPageChange,
  learningCheckIdForPage,
  learningResultKey,
  learningSeatAssignments,
  learningUncheckedStudentIds,
  moveLearningStudentToSeat,
  type LearningCheckStatus,
} from "../src/features/school/session-learning-contract";
import { resolveCourseware } from "../src/features/school/courseware-overlay";
import { buildRehearsalLearningSetup } from "../src/features/classroom/live/rehearsal-learning";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const continuityMigration = read("supabase/migrations/20260729000400_r1_classroom_continuity.sql");
const publicationMigration = read("supabase/migrations/20260730000100_r1_session_learning_publications.sql");
const learningCheckFlagMigration = read("supabase/migrations/20260730000400_r1_courseware_page_learning_check_flags.sql");
const learningCheckConfigurationMigration = read("supabase/migrations/20260730000600_r1_session_learning_check_configuration.sql");
const learningCheckMarkFixMigration = read("supabase/migrations/20260730000700_r1_fix_learning_check_mark.sql");
const prepArtifactMigration = read("supabase/migrations/20260730000300_r1_session_preparation_artifacts.sql");
const prepReviewMigration = read("supabase/migrations/20260730000500_r1_session_preparation_review.sql");
const operationalGateMigration = read("supabase/migrations/20260822000200_r1_live_operational_gate_simplification.sql");
const prepUnlockMigration = read("supabase/migrations/20260731000500_r1_preparation_archive_unlock.sql");
const prepUnlockNarrowingMigration = read("supabase/migrations/20260731000800_r1_narrow_preparation_archive_unlock.sql");
const learningSeatOrderMigration = read("supabase/migrations/20260731001000_r1_learning_check_seat_order.sql");
const learningSeatLayoutMigration = read("supabase/migrations/20260731001200_r1_learning_check_seat_layout.sql");
const learningFillBulkMigration = read("supabase/migrations/20260825000700_classroom_learning_fill_bulk.sql");

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
    // doc 27 §3 D3：固定轨道换成可拖拽分栏。原来的 minmax(24rem,30rem) 是硬下限 384px，
    // 与课件目录的 272px 串联后，1280 视口下 4:3 舞台只剩约 180×135px。
    expect(prep).toContain("SessionPrepSplit");
    expect(prep).not.toContain("SessionLearningCheckEditor");
  });

  it("keeps the frozen preparation archive visible from the exact session courseware snapshot", () => {
    const prep = read("src/features/school/SessionPrepPanel.tsx");
    const prepFlow = read("src/features/school/SessionPreparationFlow.tsx");
    const overlayEditor = read("src/features/school/CoursewareOverlayEditor.tsx");
    const classes = read("src/features/school/classes.ts");
    expect(prep).toContain("canViewPrepArchive");
    expect(prep).toContain("prepArchiveFrozenTitle");
    expect(prep).toContain("coursewareEditorStateFromFrozenSnapshot(detail.courseware, detail.coursewareOverlay)");
    expect(prep).toContain("template={editorTemplate}");
    expect(prep).toContain("initialOverlay={editorOverlay}");
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
    expect(prep).toContain("reviewerReadOnly={!regularPreparationEditing}");
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
    expect(overlayEditor).toContain("SUDOKU_BOX_ELIMINATION_SEED");
    expect(overlayEditor).toContain("usingSudokuTeachingPreset");
    expect(overlayEditor).toContain('t("sudokuBoxEliminationTitle")');
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

  it("keeps preparation artifacts and reviews as visible quality signals, not completion gates", () => {
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
    expect(operationalGateMigration).toContain("create or replace function public.assert_session_preparation_complete");
    expect(operationalGateMigration).not.toContain("PREP_ARTIFACTS_REQUIRED");
    expect(operationalGateMigration).not.toContain("PREP_REVIEW_REQUIRED");
    expect(operationalGateMigration).not.toContain("LEARNING_CHECKS_REQUIRED");
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
    // doc 27 §3 D3：目录与预览的固定轨道换成可拖拽分栏，方向按容器实宽决定。
    expect(sharedPreview).toContain("ResizablePanelGroup");
    expect(sharedPreview).toContain("useSplitOrientation");
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

  it("keeps attendance and preload visible without blocking a formal class start", () => {
    const livePage = read("src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx");
    const liveShell = read("src/features/classroom/live/LiveShell.tsx");
    const actions = read("src/features/classroom/actions.ts");
    expect(livePage).toContain("getAttendanceDrawerData");
    expect(livePage).toContain("attendanceSuggested");
    expect(livePage).toContain("initialAttendanceComplete");
    expect(livePage).toContain("attendanceInLearningPanel");
    expect(livePage).toContain("initialAttendanceRows=");
    expect(liveShell).not.toContain("attendanceRequired && !attendanceComplete");
    expect(liveShell).toContain("attendanceSuggested");
    expect(liveShell).toContain("AttendanceDrawer");
    expect(liveShell).toContain("disabled={starting}");
    expect(liveShell).not.toContain("disabled={!assetsReady");
    expect(actions).not.toContain('throw new Error("ATTENDANCE_REQUIRED")');
    expect(actions).not.toContain('throw new Error("COURSEWARE_TRACK_UNPUBLISHED")');
  });

  it("resolves free-session overlay pages for teacher rehearsal before the snapshot freezes", () => {
    const livePage = read("src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx");
    const gamePage = {
      id: "11111111-1111-4111-8111-111111111111",
      type: "game" as const,
      title: "宫区块摈除",
      gameId: "sudoku",
      difficulty: "hard" as const,
      seed: "teaching-box-elimination-01",
    };

    expect(resolveCourseware([], [{ page: gamePage }])).toEqual([gamePage]);
    expect(livePage).toContain('classroom.myRole === "teacher" && !session.coursewareFrozenAt');
    expect(livePage).toContain("session.lectureId ? await getSessionCoursewareTemplate(sessionId) : []");
    expect(livePage).toContain("courseware: resolveCourseware(template");
    expect(livePage).not.toContain("session.lectureId && !session.coursewareFrozenAt");
    expect(livePage).not.toContain("if (template.length > 0)");
  });

  it("ships a teacher page list, protected student media, and one-touch learning checks with atomic completion", () => {
    const liveShell = read("src/features/classroom/live/LiveShell.tsx");
    const controlMenus = read("src/features/classroom/live/ClassroomControlMenus.tsx");
    const video = read("src/features/classroom/live/VideoStage.tsx");
    const panel = read("src/features/school/SessionLearningCheckPanel.tsx");
    const fillRail = read("src/features/school/LearningFillRail.tsx");
    const statusIcons = read("src/features/school/LearningCheckStatusIcon.tsx");
    const learningSetup = read("src/features/school/session-learning.ts");
    const learningActions = read("src/features/school/session-learning-actions.ts");
    const attendanceActions = read("src/features/school/actions/attendance.ts");
    const attendanceAmendment = attendanceActions.slice(
      attendanceActions.indexOf("export async function amendAttendanceStatusAction"),
      attendanceActions.indexOf("export async function getSessionChangeOptionsAction"),
    );
    expect(liveShell).toContain("<ClassroomPageControls");
    expect(controlMenus).toContain("ListOrdered");
    expect(controlMenus).toContain('t("pageList")');
    expect(liveShell).toContain("activePageDocId={activePageDocId}");
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
    expect(panel).toContain("<LearningFillRail");
    expect(panel).toContain("learningUncheckedStudentIds");
    expect(panel).not.toContain("batchMode");
    expect(panel).not.toContain("studentSelection");
    expect(panel).toContain("data-learning-check-toolbar");
    expect(panel).toContain("data-learning-check-strip");
    expect(panel).toContain("data-ipad-roster-grid");
    expect(panel).toContain("z-[80] flex h-dvh max-h-none");
    expect(LEARNING_SEAT_COLUMNS).toBe(4);
    expect(LEARNING_SEAT_ROWS).toBe(5);
    expect(panel).toContain("data-learning-seat-columns={LEARNING_SEAT_COLUMNS}");
    expect(panel).toContain("repeat(${LEARNING_SEAT_COLUMNS}");
    expect(panel).not.toContain("grid-cols-5");
    expect(panel).toContain("data-learning-seat-index");
    expect(panel).toContain("data-learning-empty-seat");
    expect(panel).toContain('data-learning-seat-layer="background"');
    expect(panel).toContain('data-learning-seat-layer="student"');
    expect(panel).toContain("gridColumnStart: (seatPosition % LEARNING_SEAT_COLUMNS) + 1");
    expect(panel).toContain("gridRowStart: Math.floor(seatPosition / LEARNING_SEAT_COLUMNS) + 1");
    expect(panel).toContain("auto-rows-[minmax(0,1fr)] overflow-y-hidden");
    expect(panel).toContain("auto-rows-[minmax(7.75rem,1fr)] overflow-y-auto pr-1");
    expect(panel).toContain("overflow-y-auto pr-1");
    expect(panel).toContain("Armchair");
    expect(panel).toContain("GripVertical");
    expect(panel).toContain("AttendanceStatusLight");
    expect(panel).toContain("ATTENDANCE_STATUS_LED");
    expect(panel).not.toContain("Lightbulb");
    expect(statusIcons).toContain("BulbCheckIcon");
    expect(statusIcons).toContain("TracePenIcon");
    expect(statusIcons).toContain('strokeDasharray="2 2"');
    expect(panel).toContain("amendAttendanceStatusAction");
    expect(attendanceAmendment).toContain('authorizedClient("attendance.mark")');
    expect(attendanceAmendment).not.toContain("session_completion_tasks");
    expect(panel).toContain("seatEditMode");
    expect(panel).toContain("stableSeatStudents.map");
    expect(panel).toContain("dragStartSeatSlotsRef.current");
    expect(panel).toContain("setDragOffset");
    expect(panel).not.toContain("learningStatusShort_");
    expect(panel).toContain('t("learningStatus_" + status)');
    expect(fillRail).toContain('data-learning-fill-width="112"');
    expect(fillRail).toContain('t("learningStatus_" + status)');
    expect(panel).toContain("data-learning-current-status={status}");
    expect(panel).toContain('status === "unchecked" ? "bg-line/80" : statusStyle.dot');
    expect(panel).toContain("auto-rows-[2.75rem]");
    expect(panel).toContain("h-11 min-h-0");
    expect(panel).toContain("flex-col overflow-hidden rounded-xl");
    expect(panel).toContain("saveClassroomStudentSeatLayoutAction");
    expect(panel).toContain("learningCheckIdForPage");
    expect(panel).toContain("onSummaryChange");
    expect(panel).toContain("onSeatOrderChange?.(learningSeatAssignments(next))");
    expect(panel).toContain("data-learning-persistence");
    expect(learningActions).toContain('rpc("save_classroom_student_seat_layout"');
    expect(learningActions).toContain('rpc("mark_session_learning_checks"');
    expect(learningActions).not.toContain("Promise.all(value.studentIds.map");
    expect(learningSetup).toContain("getSessionRoster(sessionId)");
    expect(learningSetup).toContain("rosterState.entries.map");
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
    expect(learningFillBulkMigration).toContain("create or replace function public.mark_session_learning_checks");
    expect(learningFillBulkMigration).toContain("distinct_count <> submitted_count");
    expect(learningFillBulkMigration).toContain("result_row.student_id = any(p_student_ids)");
    expect(learningFillBulkMigration).toContain("from unnest(p_student_ids) submitted(student_id)");
  });

  it("fills only unchecked, assessable students", () => {
    const students = [
      { id: "student-1", name: "One", seatPosition: 0 },
      { id: "student-2", name: "Two", seatPosition: 1 },
      { id: "student-3", name: "Three", seatPosition: 2 },
    ];
    const results = new Map<string, LearningCheckStatus>([
      [learningResultKey("check-1", "student-1"), "independent"],
    ]);

    expect(learningUncheckedStudentIds(
      students,
      "check-1",
      results,
      new Set(["student-3"]),
    )).toEqual(["student-2"]);
  });

  it("creates a local rehearsal learning setup from the on-air roster without inventing database writes", () => {
    const setup = buildRehearsalLearningSetup({
      persisted: null,
      pages: [
        { id: "page-1", type: "doc", docId: "doc-1", title: "例题一" },
        { id: "page-2", type: "video", path: "lesson.mp4", title: "视频" },
      ],
      roster: [
        { studentId: "student-1", userId: null, name: "学生一", seatPosition: 3 },
        { studentId: "student-2", userId: "user-2", name: "学生二", seatPosition: 0 },
      ],
      fallbackTitle: "课堂观察",
    });

    expect(setup.checks).toEqual([{
      id: "rehearsal-learning:doc-1",
      position: 0,
      title: "例题一",
      sourcePageId: "doc-1",
    }]);
    expect(setup.students).toEqual([
      { id: "student-1", name: "学生一", seatPosition: 3 },
      { id: "student-2", name: "学生二", seatPosition: 0 },
    ]);
    expect(setup.results).toEqual([]);
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

  it("prioritizes 4:3 courseware and gives M4b its right stack and full-width control row", () => {
    const liveShell = read("src/features/classroom/live/LiveShell.tsx");
    const toolbar = read("src/features/whiteboard/Toolbar.tsx");
    const rosterGrid = read("src/features/classroom/live/ClassroomRosterGrid.tsx");
    const panels = read("src/features/classroom/live/LivePanels.tsx");
    const controlBar = read("src/features/classroom/live/TeacherClassroomControlBar.tsx");
    const controlMenus = read("src/features/classroom/live/ClassroomControlMenus.tsx");
    expect(liveShell).toContain("teacherLayoutV2");
    expect(liveShell).toContain("grid-cols-[minmax(0,1fr)_clamp(22rem,31vw,36rem)]");
    expect(liveShell).toContain("100cqh * 4 / 3");
    expect(liveShell).toContain("<ClassroomCourseInfoBar");
    expect(liveShell).toContain("<ClassroomRosterGrid");
    expect(liveShell).toContain("data-side-board-viewport");
    expect(liveShell).toContain("sideZoom * 100");
    expect(liveShell).toContain("lastPoint[1] * viewport.scrollHeight");
    expect(liveShell).toContain('myRole === "student" && !showAllStudents');
    expect(liveShell).toContain('t("showClassmates")');
    expect(liveShell).toContain("sideCollapsed && rosterCollapsed");
    expect(liveShell).toContain("5.25rem");
    expect(liveShell).toContain("lg:justify-end");
    expect(liveShell).toContain("transition-[width] duration-200");
    expect(liveShell).toContain("<ClassroomToolsMenu");
    expect(controlMenus).toContain('t("moreClassroomTools")');
    expect(rosterGrid).toContain("data-roster-column-count={LEARNING_SEAT_COLUMNS}");
    expect(rosterGrid).toContain("repeat(${LEARNING_SEAT_COLUMNS}");
    expect(panels).toContain("LEARNING_CHECK_STATUS_STYLE[learningStatus].card");
    expect(panels).not.toContain("learningStatusShort_");
    expect(rosterGrid).toContain("overflow-y-auto");
    expect(controlBar).toContain('data-classroom-control-bar="full-width"');
    expect(controlBar).toContain('data-classroom-control-surface="flat-rail"');
    expect(controlBar).toContain('data-classroom-control-background="translucent"');
    expect(controlBar).toContain("border-t border-line/70");
    expect(controlBar).toContain("bg-paper/75");
    expect(controlBar).not.toContain("rounded-2xl");
    expect(controlBar).not.toContain("shadow-lg");
    expect(controlBar).toContain("overflow-y-hidden");
    expect(controlBar).toContain("[scrollbar-width:none]");
    expect(controlBar).toContain('data-classroom-control-zone="pages"');
    expect(controlBar).toContain('data-classroom-control-zone="utility"');
    expect(controlMenus).toContain("data-classroom-rail-button");
    expect(controlMenus).toContain("pageListPosition");
    expect(toolbar).toContain("largeTargets?: boolean");
    expect(toolbar).toContain('variant?: "floating" | "rail"');
    expect(toolbar).not.toContain("compact?: boolean");
    expect(liveShell).toContain('variant="rail"');
    expect(liveShell).toContain('triggerVariant="rail"');
    expect(liveShell).not.toContain('appearance="rail"');
    expect(liveShell).toContain("attendanceRows={initialAttendanceRows}");
    expect(liveShell).toContain("attendanceIntegrated");
    expect(liveShell).toContain("utilityControls={(");
    expect(liveShell).toContain("activeLearningSummary");
    expect(liveShell).toContain("activeLearningSeatPositions.get(student.studentId)");
    expect(liveShell).not.toContain('activeArea === "side" ? t("boardSide") : t("boardMain")');
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
