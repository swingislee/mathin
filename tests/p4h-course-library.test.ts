import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterSchoolNav } from "@/features/school/nav";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4H course library contract", () => {
  it("keeps course reading separate from the production workbench and asset-library navigation", () => {
    const teacherNav = filterSchoolNav(new Set(["course.view"]));
    expect(teacherNav.map((item) => item.href)).toContain("/dashboard/courses");
    expect(teacherNav.map((item) => item.href)).not.toContain("/dashboard/courseware");
    expect(teacherNav.map((item) => item.href)).not.toContain("/dashboard/courseware/assets");

    const editorNav = filterSchoolNav(new Set(["courseware.page.edit"]));
    expect(editorNav.map((item) => item.href)).toContain("/dashboard/courseware");
  });

  it("uses one paged RPC result instead of per-family impact requests", () => {
    const query = read("src", "features", "school", "teaching-operations", "course-queries.ts");
    const migration = read("supabase", "migrations", "20260720000400_p4h_course_library_query.sql");
    expect(query).toContain('rpc("list_course_families"');
    expect(query).not.toContain('rpc("get_course_family_impact"');
    expect(migration).toContain("v_variant_status");
    expect(migration).toContain("v_readiness");
    expect(migration).toContain("limit 20 offset");
  });

  it("keeps operating-term controls on scheduling and validates them with schedule.manage", () => {
    const coursePage = read("src", "app", "[locale]", "dashboard", "courses", "page.tsx");
    const schedulePage = read("src", "app", "[locale]", "dashboard", "schedule", "page.tsx");
    const actions = read("src", "features", "school", "actions", "courses.ts");
    expect(coursePage).not.toContain("TermManager");
    expect(coursePage).not.toContain("listSchoolTerms");
    expect(schedulePage).toContain("TermManager");
    expect(actions.match(/authorizedClient\("schedule\.manage"\)/g)).toHaveLength(2);
  });
});
