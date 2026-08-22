import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4H CoursePicker and class-builder contract", () => {
  it("keeps course discovery server-bounded and does not preload every course lecture", () => {
    const page = read("src", "app", "[locale]", "dashboard", "classes", "new", "page.tsx");
    const picker = read("src", "features", "school", "teaching-operations", "CoursePicker.tsx");
    const migration = read("supabase", "migrations", "20260720000800_p4h_class_builder.sql");

    expect(page).not.toContain("listEnabledCoursesWithLectures");
    expect(picker).toContain("setTimeout");
    expect(picker).toContain("250");
    expect(picker).toContain("Command");
    expect(picker).toContain("Popover");
    expect(migration).toContain("bounded_limit integer := least(greatest(coalesce(p_limit, 30), 1), 30)");
    expect(migration).toContain("lecture_match.name");
  });

  it("starts with no course or lead teacher and clears per-lecture overrides on a variant switch", () => {
    const wizard = read("src", "features", "school", "ClassBuildWizard.tsx");

    expect(wizard).toContain('useState<ClassBuildCourseDetail | null>(null)');
    expect(wizard).toContain('useState("")');
    expect(wizard).toContain("setOverrides({})");
    expect(wizard).toContain("overridesCleared");
    expect(wizard).toContain("schoolTermId");
    expect(wizard).toContain("activateNow");
  });

  it("validates availability and creates the correct staff responsibilities inside the controlled RPC", () => {
    const migration = read("supabase", "migrations", "20260720000800_p4h_class_builder.sql");
    const actions = read("src", "features", "school", "actions", "classes.ts");

    expect(migration).toContain("course_candidate.status = 'enabled'");
    expect(migration).toContain("course_candidate.trashed_at is null");
    expect(migration).toContain("course_candidate.purpose = p_purpose");
    expect(migration).toContain("family_candidate.status = 'enabled'");
    expect(migration).toContain("'primary_teacher'");
    expect(migration).toContain("'learning_support'");
    expect(migration).not.toContain("values (cid, p_learning_support_id, 'teacher')");
    expect(migration).toContain("case when p_activate then 'active' else 'planning' end");
    expect(actions).toContain('authorizedClient("class.create")');
    expect(actions).toContain('rpc(supabase)("create_class"');
    expect(actions).toContain(".bind(supabase)");
  });

  it("treats incomplete courseware as an activation warning while retaining structural guards", () => {
    const wizard = read("src", "features", "school", "ClassBuildWizard.tsx");
    const migration = read("supabase", "migrations", "20260822000100_r1_live_incomplete_course_activation.sql");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(wizard).toContain('(purpose === "test" || course !== null)');
    expect(wizard).not.toContain('(purpose === "test" || isReady)');
    expect(wizard).toContain('t("productionActivationWarning")');
    expect(zh).toContain('"productionActivationWarning"');
    expect(en).toContain('"productionActivationWarning"');

    expect(migration).toContain("p_course_id is null or active_lecture_count = 0");
    expect(migration).not.toContain("active_lecture_count <> released_lecture_count");
    expect(migration).not.toContain("lecture_row.current_release_id is null");
    expect(migration).toContain("session_row.lecture_id is null");
    expect(migration).toContain("lecture_row.status <> 'active'");
  });

  it("loads the versioned course seed after the catalog-version migration in CI replay", () => {
    const replay = read("scripts", "ci-rebuild-db.mjs");

    expect(replay).toContain('const versionedCourseSeed = path.join(root, "supabase", "seed", "courses.seed.sql")');
    expect(replay).toContain('const catalogVersionMigration = "20260803000300_p6_course_catalog_versions.sql"');
    expect(replay).toContain("migrations.slice(familyMigrationIndex, catalogVersionMigrationIndex + 1)");
    expect(replay).toContain("versionedCourseSeed,");
    expect(replay).toContain("migrations.slice(catalogVersionMigrationIndex + 1)");
  });
});
