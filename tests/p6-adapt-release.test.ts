import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P6 adaptation review and release workflow", () => {
  it("keeps background, page and release queues filterable by course and lecture", () => {
    const page = read("src", "app", "[locale]", "dashboard", "courseware", "review", "page.tsx");
    const data = read("src", "features", "courseware-studio", "adapt-review-data.ts");
    const migration = read("supabase", "migrations", "20260726000100_p6_adapt_release_and_class_builder.sql");

    expect(page).toContain("AdaptReviewFilters");
    expect(page).toContain('requested === "backgrounds" || requested === "rework" || requested === "pages"');
    expect(page).toContain('|| requested === "releases" || requested === "history"');
    expect(page).toContain("resolveReviewTab(requestedTab)");
    expect(page).not.toContain("listTeacherMicrocourseReviewQueue");
    expect(data).toContain('"list_cw_adapt_background_review_queue"');
    expect(data).toContain('"list_cw_adapt_page_review_queue"');
    expect(data).toContain('"list_cw_adapt_release_queue"');
    expect(data).toContain(".bind(supabase)");
    expect(migration).toContain("p_course_id uuid default null");
    expect(migration).toContain("p_lecture_id uuid default null");
  });

  it("keeps the historical bounded release contract but removes its parallel editor caller", () => {
    const queue = read("src", "features", "courseware-studio", "AdaptReleaseQueue.tsx");
    const action = read("src", "features", "courseware-studio", "adapt-release-actions.ts");
    const actions = read("src", "features", "courseware-studio", "actions.ts");
    const guardMigration = read("supabase", "migrations", "20260726000200_p6_adapt_release_duplicate_guard.sql");
    const migration = read("supabase", "migrations", "20260726000100_p6_adapt_release_and_class_builder.sql");

    expect(queue).toContain("publishAdaptReleasesAction");
    expect(queue).toContain("isPublishable");
    expect(queue).toContain("ConfirmDialog");
    expect(action).toContain("z.array(uuid).min(1).max(30)");
    expect(action).toContain(".bind(supabase)");
    expect(action).toContain("ADAPT_RELEASE_NOT_READY");
    expect(migration).toContain("requested_count > 30");
    expect(migration).toContain("public.publish_cw_track_release");
    expect(guardMigration).toContain("ADAPT_RELEASE_NOT_READY");
    expect(guardMigration).toContain("'pending'");
    expect(fs.existsSync(path.join(root, "src", "features", "courseware-studio", "CoursewarePageEditor.tsx"))).toBe(false);
    expect(actions).not.toContain("publishCoursewareReleaseAction");
    expect(actions).not.toContain('rpc<string>(supabase, "publish_cw_track_release"');
  });

  it("treats a native 16:9 release as sufficient courseware readiness for class building", () => {
    const picker = read("src", "features", "school", "teaching-operations", "CoursePicker.tsx");
    const migration = read("supabase", "migrations", "20260726000100_p6_adapt_release_and_class_builder.sql");

    expect(picker).not.toContain("hasCriteria");
    expect(migration).toContain("native_head.track = 'native-16x9'");
    expect(migration).toContain("coalesce(native_head.current_release_id, lecture_row.current_release_id)");
    expect(migration).not.toContain("空状态不预加载版本目录");
  });
});
