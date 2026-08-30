import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
const migration = read("supabase", "migrations", "20260830000100_teacher_microcourse_academic_scenes.sql");
const scopeMigration = read("supabase", "migrations", "20260830000200_teacher_microcourse_course_scopes.sql");
const previewMigration = read("supabase", "migrations", "20260830000300_teacher_microcourse_quick_previews.sql");

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
    expect(route).toContain("listTeacherMicrocourseQuickPreviews");
    expect(browser).toContain("@6xl/page:grid-cols-[18rem_minmax(0,1fr)_22rem]");
    expect(browser).toContain("localStorage");
    expect(browser).toContain("searchAll");
    expect(browser).toContain("mobilePreviewOpen");
    expect(table).toContain("<Table");
    expect(preview).toContain("data-teacher-microcourse-quick-preview");
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
});
