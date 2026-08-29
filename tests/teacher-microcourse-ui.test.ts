import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
const lifecycleMigration = read("supabase", "migrations", "20260826000400_teacher_microcourse_lifecycle.sql");
const readModelsMigration = read("supabase", "migrations", "20260826000500_teacher_microcourse_ui_read_models.sql");
const runtimeFixesMigration = read("supabase", "migrations", "20260826000600_teacher_microcourse_runtime_fixes.sql");
const lectureSourceMigration = read("supabase", "migrations", "20260827000100_teacher_microcourse_lecture_source_picker.sql");
const gameContractMigration = read("supabase", "migrations", "20260827000300_courseware_game_page_contract.sql");
const gameSourceMigration = read("supabase", "migrations", "20260827000400_teacher_microcourse_game_source_adapter.sql");
const catalogPickerMigration = read("supabase", "migrations", "20260827000600_teacher_microcourse_course_catalog_picker.sql");
const catalogAccessMigration = read("supabase", "migrations", "20260827000700_teacher_microcourse_course_catalog_access.sql");

describe("DEV-TMC-1 teacher microcourse product surfaces", () => {
  it("keeps authoring behind the development flag, author capability, and a free session", () => {
    const sessionWorkspace = read("src", "features", "school", "SessionWorkspaceBody.tsx");
    const route = read("src", "app", "[locale]", "dashboard", "sessions", "[sessionId]", "microcourse", "page.tsx");

    expect(sessionWorkspace).toContain('isFeatureEnabled("teaching.teacher_microcourses_v1")');
    expect(sessionWorkspace).toContain('has("courseware.microcourse.author")');
    expect(sessionWorkspace).toContain('viewerPerms.has("courseware.review")');
    expect(sessionWorkspace).toContain("detail.lectureId === null");
    expect(route).toContain('requirePerm(locale, "courseware.microcourse.author")');
    expect(route).toContain("session.lectureId !== null");
    expect(route).toContain("variants.length === 0 && !session.canCreate");
    expect(route).toContain("getTeacherMicrocourseSessionContext(sessionId)");
    expect(route).toContain("<Suspense");
  });

  it("supports independent teacher/research proposals and freezes the teacher selection", () => {
    const variantMigration = read("supabase", "migrations", "20260828000100_teacher_microcourse_variants.sql");
    const runtimeMigration = read("supabase", "migrations", "20260828000110_teacher_microcourse_variant_runtime.sql");
    const switcher = read("src", "features", "teacher-microcourses", "MicrocourseVariantSwitcher.tsx");
    const preview = read("src", "features", "teacher-microcourses", "MicrocourseVariantPreview.tsx");
    const classroomActions = read("src", "features", "classroom", "actions.ts");
    const reviewRoute = read("src", "app", "[locale]", "dashboard", "courseware", "review", "page.tsx");

    expect(variantMigration).toContain("create_teacher_microcourse_variant");
    expect(variantMigration).toContain("fork_teacher_microcourse_variant");
    expect(variantMigration).toContain("select_teacher_microcourse_variant");
    expect(variantMigration).toContain("microcourse.author_id = p_uid");
    expect(variantMigration).toContain("public.is_session_teacher(p_session_id, uid)");
    expect(variantMigration).toContain("where role.key = 'research'");
    expect(runtimeMigration).toContain("freeze_selected_teacher_microcourse_source_session");
    expect(runtimeMigration).toContain("'microcourseDraft'");
    expect(runtimeMigration).toContain("'docId', page_row.id");
    expect(classroomActions).toContain('"freeze_selected_teacher_microcourse_source_session"');
    expect(switcher).toContain("forkTeacherMicrocourseVariantAction");
    expect(switcher).toContain("selectTeacherMicrocourseVariantAction");
    expect(switcher).toContain('data-testid="microcourse-variant-switcher"');
    expect(preview).toContain('data-testid="microcourse-variant-preview"');
    expect(reviewRoute).toContain("listTeacherMicrocourseSessionWorkspaces");
  });

  it("exposes composition, registered games and H5 while preserving source provenance", () => {
    const editor = read("src", "features", "teacher-microcourses", "MicrocourseEditor.tsx");
    const picker = read("src", "features", "teacher-microcourses", "MicrocourseSourcePicker.tsx");
    const liveShell = read("src", "features", "classroom", "live", "LiveShell.tsx");
    const contentMigration = read("supabase", "migrations", "20260826000300_teacher_microcourse_content.sql");
    const actions = read("src", "features", "teacher-microcourses", "actions.ts");
    const manifest = read("src", "features", "games", "courseware", "registry.ts");
    const gridEditor = read("src", "features", "games", "courseware", "GamePageGridEditor.tsx");
    const gameEditor = read("src", "features", "games", "courseware", "GamePageEditor.tsx");
    const gameStage = read("src", "features", "games", "courseware", "GamePageStage.tsx");

    expect(editor).toContain("createTeacherCompositionPageAction");
    expect(editor).toContain("createTeacherGamePageAction");
    expect(editor).toContain("gameCoursewareContractsForSurface");
    expect(editor).toContain("<GamePageEditor");
    expect(editor).toContain("<GamePageGridEditor");
    expect(editor).toContain("createTeacherH5PageAction");
    expect(editor).toContain("uploadTeacherMicrocourseImageAction");
    expect(actions).toContain('"create_teacher_microcourse_game_page"');
    expect(actions).toContain('"save_teacher_microcourse_game_page"');
    expect(actions).toContain('gameCoursewareContractsForSurface("microcourse")');
    expect(manifest).toContain('gameId: "sudoku"');
    expect(manifest).toContain('authoringSurfaces: ["microcourse"]');
    expect(gridEditor).toContain("updateGamePageGridPlacement");
    expect(gridEditor).toContain("MoveDiagonal2");
    expect(gameEditor).toContain("applyGamePageGridTemplate");
    expect(gameEditor).not.toContain('type="number"');
    expect(gameStage).toContain("resolveGamePageGridLayout");
    expect(picker).toContain("createTeacherCompositionPagesFromLectureAction");
    expect(picker).toContain("<CoursePicker");
    expect(picker).toContain('fixedCourseKind="curriculum"');
    expect(picker).toContain('accessContext="microcourse-source"');
    expect(picker).not.toContain("StagePreview");
    expect(picker).toContain("sourceReleaseId: selected.releaseId");
    expect(picker).toContain("sourceLectureId: selected.lectureId");
    expect(contentMigration).toContain("source_release_id");
    expect(contentMigration).toContain("source_revision_id");
    expect(contentMigration).toContain("course_row.course_kind = 'curriculum'");
    expect(readModelsMigration).toContain("coalesce(track_head.current_release_id, lecture_row.current_release_id)");
    expect(lectureSourceMigration).toContain("search_teacher_microcourse_source_lectures");
    expect(lectureSourceMigration).toContain("create_teacher_microcourse_composition_pages_from_lecture");
    expect(lectureSourceMigration).toContain("order by source_item.position");
    expect(gameContractMigration).toContain("cw_game_revision_validations");
    expect(gameContractMigration).toContain("GAME_PAGE_NOT_PUBLISHABLE");
    expect(gameSourceMigration).toContain("cw_teacher_microcourse_source_revision_is_supported");
    expect(gameSourceMigration).not.toMatch(
      /source_revision\.doc_version\s+in\s*\([^)]*sudoku[\s\S]*/,
    );
    expect(catalogPickerMigration).toContain("list_teacher_microcourse_source_lectures");
    expect(catalogPickerMigration).toContain("family_row.purpose = 'production'");
    expect(catalogPickerMigration).not.toContain("preview_doc");
    expect(catalogAccessMigration).toContain("public.has_perm(uid, 'class.create')");
    expect(catalogAccessMigration).toContain("public.has_perm(uid, 'courseware.microcourse.author')");
    expect(catalogAccessMigration).toContain("p_course_kind = 'curriculum'");
    expect(runtimeFixesMigration).toContain("'type', 'doc'");
    expect(liveShell).toContain("session.lectureId || docPageKey");
  });

  it("keeps intermediate-review H5 private and only promotes the final frozen snapshot", () => {
    const actions = read("src", "features", "teacher-microcourses", "actions.ts");
    const review = read("src", "features", "teacher-microcourses", "MicrocourseReviewPanel.tsx");

    expect(readModelsMigration).toContain("'finalApproval', cycle_row.review_round_no >= coalesce(required_rounds, 1)");
    expect(actions).toContain("plan.finalApproval ? plan.artifacts : []");
    expect(actions).toContain("cw-h5-drafts");
    expect(actions).toContain("cw-h5");
    expect(actions).toContain('contentType: "text/html"');
    expect(actions).not.toContain('contentType: "text/html; charset=utf-8"');
    expect(review).toContain('t("immutableSnapshotHint")');
    expect(lifecycleMigration).toContain("teacher_microcourse_review_snapshots");
    expect(lifecycleMigration).toContain("snapshot_row.h5_hashes");
  });

  it("routes generic lecture review links into the immutable microcourse review workspace", () => {
    const lectureLoader = read("src", "features", "school", "curriculum", "load-lecture-workspace-page.ts");
    const lectureRoute = read("src", "app", "[locale]", "dashboard", "courseware", "lectures", "[lectureId]", "page.tsx");
    const data = read("src", "features", "teacher-microcourses", "data.ts");

    expect(lectureLoader).toContain("isTeacherMicrocourseReviewCycle(activeReviewCycleId)");
    expect(lectureRoute).toContain("microcourseReviewCycleId");
    expect(lectureRoute).toContain("/dashboard/courseware/review/microcourses/");
    expect(data).toContain('from("teacher_microcourse_review_snapshots")');
  });

  it("projects free classes as multi-lecture courses and proposals as lecture releases", () => {
    const actions = read("src", "features", "school", "actions", "classes.ts");
    const picker = read("src", "features", "school", "teaching-operations", "CoursePicker.tsx");
    const types = read("src", "features", "school", "teaching-operations", "course-picker-types.ts");
    const classSeriesMigration = read("supabase", "migrations", "20260829000500_teacher_microcourse_class_series.sql");
    const classRootMigration = read("supabase", "migrations", "20260829000600_teacher_microcourse_class_root.sql");

    for (const argument of ["p_course_kind", "p_author_id", "p_primary_topic_slug", "p_keyword"]) {
      expect(actions).toContain(argument);
    }
    expect(actions).toContain("listClassBuildMicrocourseTopicsAction");
    expect(picker).toContain("listClassBuildMicrocourseTopicsAction");
    expect(types).toContain("courseSeason: number | null");
    expect(lifecycleMigration).toContain("microcourse_row.published_metadata_revision_id is not null");
    expect(lifecycleMigration).toContain("microcourse_row.withdrawn_at is null");
    expect(classSeriesMigration).toContain("source_classroom_id uuid");
    expect(classRootMigration).toContain("teacher_microcourse_class_courses");
    expect(classRootMigration).toContain("teacher_microcourse_class_lectures");
    expect(classRootMigration).toContain("teacher_microcourse_catalog_releases");
    expect(classRootMigration).toContain("distinct immutable releases of that lecture");
    expect(classRootMigration).toContain("catalog_lecture_id, 'native-16x9'");
    expect(classRootMigration).toContain("public.teacher_microcourse_course_is_publishable");
    expect(classRootMigration).toContain("drop index if exists public.teacher_microcourses_course_session_series_idx");
    expect(classSeriesMigration).not.toContain("counts.lecture_count = 1");
    expect(classSeriesMigration).not.toContain("MICROCOURSE_REQUIRES_ONE_LECTURE");
  });

  it("keeps optional microcourse seasons readable in the shared course-family library", () => {
    const detail = read("src", "features", "school", "teaching-operations", "course-family-detail.ts");
    const queries = read("src", "features", "school", "teaching-operations", "course-queries.ts");
    const matrix = read("src", "features", "school", "teaching-operations", "VariantMatrix.tsx");

    expect(detail.match(/courseSeason: courseSeasonSchema\.nullable\(\)/g)).toHaveLength(2);
    expect(detail.match(/courseSeason: CourseSeason \| null/g)).toHaveLength(2);
    expect(queries).toContain("rawCourseSeason === null ? null");
    expect(matrix).toContain('variant.courseSeason === null');
    expect(matrix).toContain('t("courseSeasonUnspecified")');
  });

  it("maintains matching Chinese and English teacher-microcourse UI keys", () => {
    const zh = JSON.parse(read("messages", "zh.json")) as { teacherMicrocourses: Record<string, unknown> };
    const en = JSON.parse(read("messages", "en.json")) as { teacherMicrocourses: Record<string, unknown> };
    expect(Object.keys(zh.teacherMicrocourses).sort()).toEqual(Object.keys(en.teacherMicrocourses).sort());
  });
});
