import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClassSchema } from "../src/features/school/actions/class-build-schema";

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
    expect(wizard).toContain("if (learningSupportId === value)");
    expect(wizard).toContain('setLearningSupportId("")');
    expect(wizard).toContain("primaryTeacherRequired");
    expect(wizard).toContain("aria-invalid");
  });

  it("validates availability and creates the correct staff responsibilities inside the controlled RPC", () => {
    const migration = read("supabase", "migrations", "20260720000800_p4h_class_builder.sql");
    const enrollmentMigration = read("supabase", "migrations", "20260711000100_p4c_permission_correction.sql");
    const transitionMigration = read("supabase", "migrations", "20260822000300_r1_live_enrollment_status_transition.sql");
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

    const baseInput = {
      name: "R1 class",
      courseId: null,
      capacity: null,
      room: "",
      primaryTeacherId: "11111111-1111-4111-8111-111111111111",
      schoolTermId: "22222222-2222-4222-8222-222222222222",
      purpose: "test" as const,
      activateNow: false,
      sessions: [],
    };
    expect(buildClassSchema.parse({ ...baseInput, learningSupportId: "" }).learningSupportId).toBeNull();
    expect(buildClassSchema.safeParse({ ...baseInput, learningSupportId: baseInput.primaryTeacherId }).success).toBe(false);

    expect(enrollmentMigration).toContain("if cur_status in ('lead', 'trialing') then");
    expect(enrollmentMigration).toContain("update public.students set status = 'enrolled'");
    expect(transitionMigration).toContain("old.status='lead' and new.status in ('trialing','enrolled','invalid')");
    expect(transitionMigration).toContain("old.status='trialing' and new.status in ('lead','enrolled','invalid')");
    expect(transitionMigration).not.toContain("old.status='enrolled' and new.status in ('lead'");
  });

  it("keeps activation an operator choice while retaining create-time structural guards", () => {
    const wizard = read("src", "features", "school", "ClassBuildWizard.tsx");
    const migration = read("supabase", "migrations", "20260822000200_r1_live_operational_gate_simplification.sql");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(wizard).not.toContain("canActivateNow");
    expect(wizard).toContain('checked={activateNow}');
    expect(wizard).toContain('t("productionActivationWarning")');
    expect(zh).toContain('"productionActivationWarning"');
    expect(en).toContain('"productionActivationWarning"');
    expect(zh).toContain('"learningSupportCleared"');
    expect(en).toContain('"learningSupportCleared"');

    expect(migration).not.toContain("CLASSROOM_PREP_INCOMPLETE");
    expect(migration).not.toContain("active_lecture_count");
    expect(migration).not.toContain("active_lecture_count <> released_lecture_count");
    expect(migration).not.toContain("lecture_row.current_release_id is null");
    expect(migration).toContain("course_candidate.status = 'enabled'");
    expect(migration).toContain("and course_id = p_course_id");
    expect(migration).toContain("and status = 'active'");
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
