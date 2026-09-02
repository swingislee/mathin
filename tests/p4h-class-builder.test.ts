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
    expect(wizard).toContain("createdRedirecting");
    expect(wizard).toContain("router.replace(href)");
    expect(wizard).toContain("window.location.assign(localizedHref)");
  });

  it("gives free classes the shared weekly auto-schedule and per-session time controls", () => {
    const wizard = read("src", "features", "school", "ClassBuildWizard.tsx");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(wizard).toContain('const scheduleSlots = useMemo(() => mode === "course"');
    expect(wizard).toContain("freeSessions.map((session, index)");
    expect(wizard).toContain("getClassScheduleCalendarAction(startDate, scheduleSlots.length)");
    expect(wizard).toContain("preview.length === scheduleSlots.length");
    expect(wizard).toContain("!scheduleInputsValid || weekdays.size === 0");
    expect(wizard).toContain('lectureId: mode === "course" ? item.lectureId : null');
    expect(wizard).toContain("updateScheduleOverride(item.lectureId, value, item.scheduledAt)");
    expect(wizard).toContain("removeFreeSession(item.lectureId)");
    expect(zh).toContain("新增课次会按顺序自动排期");
    expect(en).toContain("new sessions are scheduled in sequence");
  });

  it("lets a course class trim, reorder, restore, and then batch or individually schedule lectures", () => {
    const wizard = read("src", "features", "school", "ClassBuildWizard.tsx");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(wizard).toContain("useState<ClassBuildLecture[]>([])");
    expect(wizard).toContain("moveCourseSession");
    expect(wizard).toContain("removeCourseSession");
    expect(wizard).toContain("restoreCourseSessions");
    expect(wizard).toContain("courseSessionsAreDefault");
    expect(wizard).toContain("resetScheduleOverride");
    expect(wizard).toContain("resetAllScheduleOverrides");
    expect(wizard).toContain('t("batchScheduleTitle")');
    expect(wizard).toContain('t("restoreDefaultLectures")');
    expect(zh).toContain('"restoreDefaultLectures": "恢复默认课节"');
    expect(en).toContain('"restoreDefaultLectures": "Restore default lectures"');

    const courseInput = {
      name: "Tailored course class",
      courseId: "11111111-1111-4111-8111-111111111111",
      capacity: null,
      roomId: null,
      primaryTeacherId: "22222222-2222-4222-8222-222222222222",
      learningSupportId: null,
      schoolTermId: "33333333-3333-4333-8333-333333333333",
      purpose: "production" as const,
      offeringType: "long_term_formal" as const,
      activateNow: false,
      sessions: [{
        lectureId: "44444444-4444-4444-8444-444444444444",
        no: 7,
        name: "Only the selected lecture",
        scheduledAt: "2026-09-12T11:00:00.000Z",
        durationMin: 90,
      }],
    };
    expect(buildClassSchema.parse(courseInput).sessions).toHaveLength(1);
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
    expect(actions).toContain('rpc(supabase)("create_class_v2"');
    expect(actions).toContain(".bind(supabase)");

    const baseInput = {
      name: "R1 class",
      courseId: null,
      capacity: null,
      roomId: null,
      primaryTeacherId: "11111111-1111-4111-8111-111111111111",
      schoolTermId: "22222222-2222-4222-8222-222222222222",
      purpose: "test" as const,
      offeringType: "short_term_topic" as const,
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

  it("keeps data purpose separate from the long-term or short-term class offering", () => {
    const migration = read("supabase", "migrations", "20260828000210_classroom_offering_and_activity_kind.sql");
    const wizard = read("src", "features", "school", "ClassBuildWizard.tsx");
    const actions = read("src", "features", "school", "actions", "classes.ts");
    const list = read("src", "features", "school", "ClassroomList.tsx");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(migration).toContain("add column if not exists offering_type text not null default 'long_term_formal'");
    expect(migration).toContain("check (offering_type in ('long_term_formal', 'short_term_topic'))");
    expect(migration).toContain("'offeringType', p_offering_type");
    expect(wizard).toContain('useState<ClassroomOfferingType>("long_term_formal")');
    expect(wizard).toContain('setOfferingType("short_term_topic")');
    expect(actions).toContain("p_offering_type: value.offeringType");
    expect(list).toContain("classroom.offeringType");
    expect(zh).toContain('"offering_short_term_topic": "短期专题课"');
    expect(en).toContain('"offering_short_term_topic": "Short-term topic class"');

    const baseInput = {
      name: "Topic class",
      courseId: null,
      capacity: null,
      roomId: null,
      primaryTeacherId: "11111111-1111-4111-8111-111111111111",
      learningSupportId: null,
      schoolTermId: "22222222-2222-4222-8222-222222222222",
      purpose: "production" as const,
      offeringType: "short_term_topic" as const,
      activateNow: false,
      sessions: [],
    };
    expect(buildClassSchema.parse(baseInput).offeringType).toBe("short_term_topic");
    expect(buildClassSchema.safeParse({ ...baseInput, offeringType: "public_class" }).success).toBe(false);
  });

  it("models public classes as explicit one-off activities", () => {
    const migration = read("supabase", "migrations", "20260828000210_classroom_offering_and_activity_kind.sql");
    const activityKinds = read("src", "features", "school", "activity-kinds.ts");
    const manager = read("src", "features", "school", "ActivitiesManager.tsx");
    const activityActions = read("src", "features", "school", "activity-actions.ts");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(migration).toContain("'trial_class', 'public_class', 'assessment_1v1'");
    expect(activityKinds).toContain('"public_class"');
    expect(manager).toContain('t("creationBoundary")');
    expect(manager).toContain("kindHint_");
    expect(manager).toContain("<Textarea");
    expect(manager).not.toContain("<textarea");
    expect(activityActions).toContain("activityInputSchema");
    expect(activityActions).toContain("parse(activityInputSchema, input)");
    expect(zh).toContain('"kind_public_class": "公开课"');
    expect(en).toContain('"kind_public_class": "Public class"');
  });
});
