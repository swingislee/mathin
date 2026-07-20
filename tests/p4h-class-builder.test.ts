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
  });
});
