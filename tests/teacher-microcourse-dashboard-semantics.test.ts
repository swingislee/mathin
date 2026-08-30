import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("teacher microcourse Dashboard semantics", () => {
  it("has one composition authoring boundary and no whole-page legacy H5 writer", () => {
    const pageDoc = read("src", "features", "teacher-microcourses", "page-doc.ts");
    const editor = read("src", "features", "teacher-microcourses", "MicrocourseEditor.tsx");
    const actions = read("src", "features", "teacher-microcourses", "actions.ts");
    const migration = read("supabase", "migrations", "20260830000700_teacher_microcourse_editor_unification.sql");

    expect(pageDoc).toContain("teacherMicrocoursePageDocSchema = coursewareCompositionPageSchema");
    expect(editor).toContain("<CoursewareCompositionWorkbench");
    expect(editor).not.toContain("MicrocoursePageWorkbench");
    expect(actions).toContain('"save_teacher_courseware_composition_page"');
    expect(actions).not.toContain('"save_teacher_microcourse_page"');
    expect(actions).not.toContain("createTeacherH5PageAction");
    expect(actions).not.toContain("updateTeacherH5PageAction");
    expect(migration).toContain("NON_COMPOSITION_TEACHER_REVISION_REMAINS");
  });

  it("uses the Dashboard hierarchy for the browser, details, review queues and 766 configuration", () => {
    const targets = [
      read("src", "features", "school", "teaching-operations", "TeacherMicrocourseBrowser.tsx"),
      read("src", "features", "school", "teaching-operations", "TeacherMicrocourseMaintenanceWorkspace.tsx"),
      read("src", "features", "school", "teaching-operations", "TeacherMicrocourseSceneManager.tsx"),
      read("src", "features", "school", "teaching-operations", "TeacherMicrocourseDuplicateManager.tsx"),
      read("src", "features", "teacher-microcourses", "MicrocourseReviewQueue.tsx"),
      read("src", "features", "teacher-microcourses", "MicrocourseSessionWorkspaceQueue.tsx"),
    ];

    for (const source of targets) {
      expect(source).not.toContain("@/components/ui/card");
      expect(source).not.toContain("<Card");
      expect(source).not.toContain("border-y");
    }
    expect(targets[0]).toContain("<ObjectWorkspace");
    expect(targets[0]).toContain("<DashboardCommandPanel");
    expect(targets[1]).toContain("<DashboardSection");
    expect(targets[2]).toContain("selectedRoot");
    expect(targets[2]).toContain("selectedDimension");
    expect(targets.slice(1).every((source) => source.includes("<DashboardTableShell"))).toBe(true);
  });

  it("keeps browser preview reachable and removes neutral workspace tones", () => {
    const browser = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseBrowser.tsx");
    const preview = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseQuickPreview.tsx");
    const review = read("src", "features", "teacher-microcourses", "MicrocourseReviewPanel.tsx");
    const variant = read("src", "features", "teacher-microcourses", "MicrocourseVariantPreview.tsx");
    const settings = read("src", "features", "school", "teaching-operations", "TeacherMicrocourseSceneManager.tsx");

    expect(browser).toContain('className="size-9 shrink-0 p-0" aria-label={t("search")}');
    expect(browser).toContain("@5xl/page:grid-cols-[15rem_minmax(0,1fr)_20rem]");
    expect(browser).toContain("desktopPreviewRef.current?.getClientRects().length");
    expect(browser).toContain("model.courses.some((course) => course.id === selectedCourseIdCandidate)");
    expect(browser).not.toContain("bg-moon/10");
    expect(preview).not.toContain("bg-paper/40");
    expect(review).not.toContain("bg-moon/10");
    expect(variant).not.toContain("bg-moon/10");
    expect(settings).not.toContain("bg-paper/55");
    expect(settings).not.toContain("bg-paper/60");
  });
});
