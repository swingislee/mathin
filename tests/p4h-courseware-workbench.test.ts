import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4H/P4I-12 courseware workbench contract", () => {
  it("uses a bounded lecture-task RPC instead of the retired course directory query", () => {
    const migration = read("supabase", "migrations", "20260720000600_p4h_courseware_task_queue.sql");
    const data = read("src", "features", "courseware-studio", "data.ts");
    const queue = read("src", "features", "courseware-studio", "CoursewareTaskQueue.tsx");

    expect(migration).toContain("create function public.list_courseware_tasks");
    expect(migration).toContain("normalized_tab not in ('incomplete', 'recent', 'publish')");
    expect(migration).toContain("bounded_limit integer := least(greatest(coalesce(p_limit, 60), 1), 100)");
    expect(data).toContain('rpc("list_courseware_tasks"');
    expect(data).not.toContain("loadCoursewareCourses");
    expect(queue).toContain("/dashboard/courseware/lectures/");
  });

  it("Studio 壳层是脱离 Dashboard 的独立编辑路由（P4I-12）", () => {
    const layout = read("src", "app", "[locale]", "studio", "layout.tsx");
    const page = read("src", "app", "[locale]", "studio", "courseware", "[lectureId]", "page.tsx");
    const editor = read("src", "features", "courseware-studio", "CoursewarePageEditor.tsx");

    expect(layout).not.toContain("DashboardShell");
    expect(layout).not.toContain("@/components/site-header");
    expect(page).toContain("loadCoursewareWorkbenchContext");
    expect(page).toContain("loadCoursewareStudioPage");
    expect(page).toContain('requirePerm(locale, "courseware.page.edit")');
    expect(editor).toContain("FullScreenToolShell");
    expect(editor).toContain("StageViewport");
    expect(editor).toContain("submitCoursewareReviewAction");
    expect(editor).toContain("publishCoursewareReleaseAction");
    expect(editor).toContain("rollbackCoursewareReleaseAction");
    expect(editor).not.toContain("<h1");
    expect(editor).toContain("beforeunload");
  });

  it("retires the four P4H-era redirect shells and keeps the canonical lecture workspace", () => {
    const root = process.cwd();
    for (const segments of [
      ["src", "app", "[locale]", "dashboard", "courseware", "[courseId]", "page.tsx"],
      ["src", "app", "[locale]", "dashboard", "courseware", "[courseId]", "[lectureId]", "page.tsx"],
      ["src", "app", "[locale]", "dashboard", "courseware", "[courseId]", "[lectureId]", "[pageId]", "page.tsx"],
      ["src", "app", "[locale]", "dashboard", "courses", "[id]", "lectures", "[lectureId]", "page.tsx"],
    ]) {
      expect(fs.existsSync(path.join(root, ...segments))).toBe(false);
    }
    expect(fs.existsSync(path.join(root, "src", "app", "[locale]", "dashboard", "courseware", "lectures", "[lectureId]", "page.tsx"))).toBe(true);
  });

  it("keeps preview track identity separate from a shared legacy revision layout", () => {
    const data = read("src", "features", "courseware-studio", "data.ts");
    const panel = read("src", "features", "school", "curriculum", "LecturePreviewPanel.tsx");
    const tasksPage = read("src", "app", "[locale]", "dashboard", "courseware", "page.tsx");

    expect(data).toContain("track: CoursewareTrack;");
    expect(data).toContain('if (layoutProfile === "legacy-16x9-import") return track === "adapted-4x3" ? "4:3" : "16:9";');
    expect(panel).toContain("const currentTrack = preview.track;");
    expect(tasksPage).toContain("?track=${preview.track}");
  });
});
