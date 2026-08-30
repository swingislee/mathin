import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
const migration = read("supabase", "migrations", "20260830000100_teacher_microcourse_academic_scenes.sql");
const scopeMigration = read("supabase", "migrations", "20260830000200_teacher_microcourse_course_scopes.sql");
const previewMigration = read("supabase", "migrations", "20260830000300_teacher_microcourse_quick_previews.sql");
const maintenanceMigration = read("supabase", "migrations", "20260830000400_teacher_microcourse_maintenance.sql");
const rolloutMigration = read("supabase", "migrations", "20260830000500_teacher_microcourse_rollout.sql");
const compositionUpgradeMigration = read("supabase", "migrations", "20260830000600_teacher_microcourse_sudoku_composition_upgrade.sql");

describe("DEV-TMC-4 teacher microcourse browser v2", () => {
  it("defines the fixed 19-item 766 dictionary and subject-scoped scene tree", () => {
    const dictionarySeed = migration.slice(
      migration.indexOf("insert into public.teacher_microcourse_framework_items"),
      migration.indexOf("create or replace function public.school_permission_keys"),
    );
    const frameworkRows = dictionarySeed.match(/\('[a-z_]+', '(?:seven_step|six_support|six_guarantee)',/g) ?? [];
    expect(frameworkRows).toHaveLength(19);
    expect(migration).toContain("teacher_microcourse_subject_managers");
    expect(migration).toContain("subject_microcourse_scene_roots");
    expect(migration).toContain("subject_microcourse_scenes_active_name_unique");
    expect(migration).toContain("teacher_microcourse.scenes.moved");
    expect(migration).toContain("teacher_microcourse.scene.updated");
  });

  it("keeps scene, scope, maintenance and default selection permissions explicit", () => {
    const permissions = read("src", "features", "school", "permissions.ts");
    for (const key of [
      "subject.microcourse.scene.manage",
      "subject.microcourse.scope.manage",
      "subject.microcourse.maintainer.assign",
      "subject.microcourse.course.create",
      "subject.microcourse.branch.create",
      "subject.microcourse.commit.create",
      "subject.microcourse.default.select",
    ]) {
      expect(permissions).toContain(`\"${key}\"`);
      expect(migration).toContain(`'${key}'`);
    }
    expect(migration).toContain("can_manage_teacher_microcourse_subject");
    expect(migration).toContain("teacher_microcourse_subject_managers manager");
  });

  it("exposes a Suspense-ready settings route with validated server actions", () => {
    const route = read("src", "app", "[locale]", "dashboard", "courses", "[courseFamilyId]", "microcourse-settings", "page.tsx");
    const actions = read("src", "features", "school", "actions", "teacher-microcourse-scenes.ts");
    const manager = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseSceneManager.tsx");
    expect(route).toContain("<Suspense");
    expect(route).toContain('requirePerm(locale, "course.view")');
    expect(actions).toContain("parse(");
    expect(actions).toContain('authorizedClient("subject.microcourse.scene.manage")');
    expect(actions).toContain('authorizedClient("organization.profile.manage")');
    expect(manager).toContain("draggable={configuration.canManageScenes}");
    expect(manager).toContain("selectedScenes");
    expect(manager).toContain("<Checkbox");
    expect(manager).toContain("<Table");
    expect(manager).not.toContain("<Card");
    expect(manager).not.toMatch(/<input\b/);
    expect(manager).not.toContain("window.confirm");
  });

  it("maintains matching Chinese and English browser namespaces", () => {
    const zh = JSON.parse(read("messages", "zh.json")) as { school: { teacherMicrocourseBrowser: Record<string, unknown> } };
    const en = JSON.parse(read("messages", "en.json")) as { school: { teacherMicrocourseBrowser: Record<string, unknown> } };
    expect(Object.keys(zh.school.teacherMicrocourseBrowser).sort())
      .toEqual(Object.keys(en.school.teacherMicrocourseBrowser).sort());
  });

  it("models many-to-many scenes and universal applicability without a primary scene", () => {
    const editor = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseScopeEditor.tsx");
    expect(scopeMigration).toContain("teacher_microcourse_course_scenes");
    expect(scopeMigration).toContain("teacher_microcourse_course_grades");
    expect(scopeMigration).toContain("teacher_microcourse_course_terms");
    expect(scopeMigration).toContain("teacher_microcourse_course_class_systems");
    expect(scopeMigration).toContain("teacher_microcourse_course_class_types");
    expect(scopeMigration).toContain("There is deliberately no primary scene");
    expect(scopeMigration).toContain("Zero rows in an applicability dimension means universal");
    expect(scopeMigration).toContain("scope_origin text not null default 'manual'");
    expect(scopeMigration).toContain("'legacy_source'");
    expect(scopeMigration).toContain("set_teacher_microcourse_course_scopes");
    expect(editor).toContain("multiSceneHint");
    expect(editor).toContain("universalWhenEmpty");
    expect(editor).toContain("classSystemIds");
    expect(editor).toContain("classTypeIds");
    expect(editor).not.toMatch(/<input\b/);
  });

  it("delivers the scene-first three-column browser with URL state and current-default previews", () => {
    const route = read("src", "app", "[locale]", "dashboard", "courses", "[courseFamilyId]", "page.tsx");
    const browser = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseBrowser.tsx");
    const table = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseTable.tsx");
    const preview = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseQuickPreview.tsx");
    const model = read("src", "features", "school", "teaching-operations", "teacher-microcourse-browser.ts");

    expect(route).toContain("listTeacherMicrocourseBrowserCatalog");
    expect(route).not.toContain("getTeacherMicrocourseQuickPreview");
    expect(route).toContain("previews: []");
    expect(route).toContain('isFeatureEnabled("teaching.teacher_microcourse_browser_v2")');
    expect(browser).toContain("@5xl/page:grid-cols-[15rem_minmax(0,1fr)_20rem]");
    expect(browser).toContain("desktopPreviewRef.current?.getClientRects().length");
    expect(browser).toContain("<ObjectWorkspace");
    expect(browser).toContain("<DashboardCommandPanel");
    expect(browser).not.toContain("<Card");
    expect(browser).toContain("localStorage");
    expect(browser).toContain("nodePreferenceKey");
    expect(browser).toContain("coursePreferenceKey");
    expect(browser).toContain("searchAll");
    expect(browser).toContain("mobilePreviewOpen");
    expect(browser).toContain("setPreviewLoad({ courseId, status: \"loading\" })");
    expect(browser).toContain("initialCourse?.previewLoaded");
    expect(browser).toContain("requestPreview(courseId)");
    expect(browser).toContain("prefetched?.promise ?? loadPreview(courseId, controller.signal)");
    expect(table).toContain("<Table");
    expect(table).toContain('event.key !== "ArrowDown"');
    expect(table).toContain('onClick={() => onSelect(course.id)}');
    expect(table).toContain('onClick={(event) => event.stopPropagation()}');
    expect(table).toContain("event.stopPropagation(); onSelect(course.id);");
    expect(table).toContain("onMouseLeave={() => onCancelPrefetch(course.id)}");
    expect(preview).toContain("data-teacher-microcourse-quick-preview");
    expect(preview).toContain('loadState === "loading"');
    expect(preview).toContain('loadState === "error"');
    expect(preview).toContain('t("retryPreview")');
    expect(model).toContain("PAGE_SIZE = 30");
    expect(model).toContain("parseTeacherMicrocourseBrowserQuery");
    expect(model).toContain("buildTeacherMicrocourseBrowserModel");
    expect(browser).not.toContain("data-microcourse-coverage-matrix");
  });

  it("uses lightweight immutable preview keys and keeps a teacher's own drafts visible", () => {
    expect(previewMigration).toContain("can_read_teacher_microcourse_catalog_course");
    expect(previewMigration).toContain("root.created_by = p_uid");
    expect(previewMigration).toContain("branch.author_id = p_uid");
    expect(previewMigration).toContain("list_teacher_microcourse_browser_catalog");
    expect(previewMigration).toContain("list_teacher_microcourse_browser_scopes");
    expect(previewMigration).toContain("list_teacher_microcourse_quick_previews");
    expect(previewMigration).toContain("lecture.current_release_id::text");
    expect(previewMigration).not.toContain("preview_doc");
  });

  it("upgrades every standalone teacher Sudoku page into the generic composition contract", () => {
    expect(compositionUpgradeMigration).toContain("courseware-composition-v1");
    expect(compositionUpgradeMigration).toContain("sudoku-authored-v2");
    expect(compositionUpgradeMigration).toContain("LEGACY_TEACHER_SUDOKU_REMAINS");
    expect(compositionUpgradeMigration).toContain("STANDALONE_TEACHER_SUDOKU_REMAINS");
    expect(compositionUpgradeMigration).toContain("disable trigger cw_page_revisions_set_document_metadata");
    expect(compositionUpgradeMigration).toContain("enable trigger cw_page_revisions_set_document_metadata");
  });

  it("normalizes course identity, reuses duplicate names, and creates courses without preset lectures", () => {
    const actions = read("src", "features", "school", "actions", "teacher-microcourse-maintenance.ts");
    const createDialog = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseCreateCourseDialog.tsx");
    expect(maintenanceMigration).toContain("normalize_teacher_microcourse_course_name");
    expect(maintenanceMigration).toContain("normalize(coalesce(p_title, ''), NFKC)");
    expect(maintenanceMigration).toContain("teacher_microcourse_catalog_courses_canonical_name_idx");
    expect(maintenanceMigration).toContain("duplicate_of_course_id");
    expect(maintenanceMigration).toContain("'created', false, 'courseId', existing_course_id");
    expect(maintenanceMigration).toContain("create_teacher_microcourse_catalog_course");
    expect(maintenanceMigration).toContain("add_teacher_microcourse_catalog_lecture");
    expect(actions).toContain("parse(");
    expect(actions).toContain('authorizedClient("subject.microcourse.course.create")');
    expect(createDialog).toContain("noPresetLecturesHint");
    expect(createDialog).toContain("duplicateCourseHint");
    expect(createDialog).not.toMatch(/<input\b/);
  });

  it("models maintenance directions, immutable published commits, and audited default history", () => {
    const workspace = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseMaintenanceWorkspace.tsx");
    const detailRoute = read("src", "app", "[locale]", "dashboard", "courses", "[courseFamilyId]", "microcourses", "[courseId]", "page.tsx");
    expect(maintenanceMigration).toContain("teacher_microcourse_maintenance_branches");
    expect(maintenanceMigration).toContain("teacher_microcourse_branch_collaborators");
    expect(maintenanceMigration).toContain("teacher_microcourse_course_commits");
    expect(maintenanceMigration).toContain("teacher_microcourse_course_defaults");
    expect(maintenanceMigration).toContain("teacher_microcourse_default_history");
    expect(maintenanceMigration).toContain("TEACHER_MICROCOURSE_COMMIT_IMMUTABLE");
    expect(maintenanceMigration).toContain("ALL_LECTURES_REQUIRE_PUBLISHED_RELEASES");
    expect(maintenanceMigration).toContain("first published commit");
    expect(maintenanceMigration).toContain("frozen classroom snapshots are unchanged");
    expect(workspace).toContain("commitTeacherMicrocourseMaintenanceBranchAction");
    expect(workspace).toContain("selectTeacherMicrocourseDefaultCommitAction");
    expect(workspace).toContain("historyLinearHint");
    expect(workspace).not.toContain("<Card");
    expect(workspace).not.toMatch(/<input\b/);
    expect(detailRoute).toContain("<Suspense");
    expect(detailRoute).toContain("getTeacherMicrocourseCatalogCourse");
    expect(detailRoute).toContain('section="branches"');
    expect(detailRoute).toContain('section="history"');
    expect(detailRoute).not.toContain("<Card");
  });

  it("bounds preview reads and client caching to the selected or prefetched course", () => {
    const browser = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseBrowser.tsx");
    const api = read("src", "app", "api", "teacher-microcourses", "[courseId]", "quick-preview", "route.ts");
    expect(rolloutMigration).toContain("get_teacher_microcourse_quick_preview");
    expect(rolloutMigration).toContain("if uid is null or not public.can_read_teacher_microcourse_catalog_course(p_course_id, uid)");
    expect(rolloutMigration).toContain("teacher_microcourse_catalog_courses_family_updated_idx");
    expect(browser).toContain("new Map<string, TeacherMicrocourseQuickPreviewData>");
    expect(browser).toContain("previewCache.current.size > 20");
    expect(browser).toContain("new AbortController()");
    expect(browser).toContain("prefetchTimers.current.delete(courseId)");
    expect(browser).toContain("for (const request of prefetchRequests.current.values()) request.controller.abort()");
    expect(browser).toContain("}, 120)");
    expect(api).toContain('supabase.rpc("get_teacher_microcourse_quick_preview"');
    expect(api).not.toContain("auth.getUser()");
    expect(api).toContain('\"Cache-Control\": \"private, no-store\"');
  });

  it("exposes classification maintenance beside the selected course instead of hiding it in bulk controls", () => {
    const browser = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseBrowser.tsx");
    const preview = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseQuickPreview.tsx");
    expect(browser).toContain("openScopeEditor([selectedCourseId])");
    expect(browser).toContain("scopeCourseIds");
    expect(preview).toContain('t("addClassification")');
    expect(preview).toContain('t("editClassification")');
  });

  it("supports subject-managed branch ownership and non-destructive duplicate governance", () => {
    const workspace = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseMaintenanceWorkspace.tsx");
    const duplicateManager = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseDuplicateManager.tsx");
    const dbAssertions = read("supabase", "tests", "teacher_microcourse_browser_v2_assertions.sql");
    expect(rolloutMigration).toContain("set_teacher_microcourse_branch_members");
    expect(rolloutMigration).toContain("MAINTAINER_HAS_BRANCH");
    expect(rolloutMigration).toContain("list_teacher_microcourse_duplicate_report");
    expect(rolloutMigration).toContain("select_teacher_microcourse_duplicate_canonical");
    expect(rolloutMigration).toContain("Non-destructive duplicate reconciliation");
    expect(workspace).toContain("setTeacherMicrocourseBranchMembersAction");
    expect(workspace).toContain("searchHistory");
    expect(duplicateManager).toContain("selectTeacherMicrocourseDuplicateCanonicalAction");
    expect(duplicateManager).not.toContain("<Card");
    expect(dbAssertions).toContain("NON_DESTRUCTIVE_CANONICAL_SWITCH_FAILED");
    expect(dbAssertions).toContain("rollback;");
  });
});
