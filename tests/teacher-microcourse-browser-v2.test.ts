import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
const migration = read("supabase", "migrations", "20260830000100_teacher_microcourse_academic_scenes.sql");

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
});
