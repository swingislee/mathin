import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4H course family detail contract", () => {
  it("scopes the family-detail RPC and grants it only to authenticated users", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260720000500_p4h_course_family_detail_scope.sql",
    );

    expect(migration).toContain("p_scope text default 'all'");
    expect(migration).toContain("assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')");
    expect(migration).toContain(
      "grant execute on function public.get_course_family_detail(uuid, uuid, text) to authenticated;",
    );
  });

  it("canonicalizes legacy variant links and keeps the product shell server-rendered", () => {
    const page = read("src", "app", "[locale]", "dashboard", "courses", "[id]", "page.tsx");

    expect(page).toContain("permanentRedirect");
    expect(page).toContain("TeachingPlanEditorLauncher");
    expect(page).toContain("LecturePreviewDialog");
    expect(page).toContain("loadLecturePreview");
    expect(page).not.toContain("CourseCrudPanel");
  });

  it("saves a complete teaching plan and archives lectures without a physical delete", () => {
    const editor = read(
      "src",
      "features",
      "school",
      "teaching-operations",
      "TeachingPlanEditor.tsx",
    );

    expect(editor).toContain("saveTeachingPlanAction");
    expect(editor).toContain("getLectureLifecycleImpactAction");
    expect(editor).toContain("archiveLectureAction");
    expect(editor).not.toContain(".delete(");
    expect(editor).not.toContain("updateLectureAction");
  });
});
