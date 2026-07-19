import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4H courseware workbench contract", () => {
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

  it("keeps preview and edit in the canonical lecture shell", () => {
    const page = read("src", "app", "[locale]", "dashboard", "courseware", "lectures", "[lectureId]", "page.tsx");
    const body = read("src", "features", "courseware-studio", "CoursewareWorkbenchBody.tsx");

    expect(page).toContain("loadCoursewareWorkbenchContext");
    expect(page).toContain("loadLecturePreview");
    expect(page).toContain("loadCoursewareStudioPage");
    expect(page).toContain("backToTeachingPlan");
    expect(page).not.toContain("CoursewareTemplateEditor");
    expect(body).toContain("dynamic(");
    expect(body).toContain("CoursewareReviewViewport");
    expect(body).toContain("CoursewarePageEditor");
  });

  it("leaves old addresses as permanent redirects with no legacy UI", () => {
    const oldCourse = read("src", "app", "[locale]", "dashboard", "courseware", "[courseId]", "page.tsx");
    const oldLecture = read("src", "app", "[locale]", "dashboard", "courseware", "[courseId]", "[lectureId]", "page.tsx");
    const oldPage = read("src", "app", "[locale]", "dashboard", "courseware", "[courseId]", "[lectureId]", "[pageId]", "page.tsx");
    const oldTemplate = read("src", "app", "[locale]", "dashboard", "courses", "[id]", "lectures", "[lectureId]", "page.tsx");

    for (const source of [oldCourse, oldLecture, oldPage, oldTemplate]) {
      expect(source).toContain("permanentRedirect");
      expect(source).not.toContain("CoursewareTemplateEditor");
      expect(source).not.toContain("CoursewareReviewViewport");
    }
    expect(oldPage).toContain("mode=edit&page=");
  });
});
