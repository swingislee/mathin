import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P6 adaptation review and release workflow", () => {
  it("keeps the historical adaptation schema without exposing its old queue UI", () => {
    const page = read("src", "app", "[locale]", "dashboard", "courseware", "review", "page.tsx");
    const migration = read("supabase", "migrations", "20260726000100_p6_adapt_release_and_class_builder.sql");

    expect(page).toContain("FormalCoursewareReviewQueue");
    expect(page).toContain("MicrocourseReviewWorkspace");
    expect(page).not.toContain("AdaptReviewFilters");
    expect(fs.existsSync(path.join(root, "src", "features", "courseware-studio", "adapt-review-data.ts"))).toBe(false);
    expect(migration).toContain("p_course_id uuid default null");
    expect(migration).toContain("p_lecture_id uuid default null");
  });

  it("keeps the historical bounded release contract but removes its parallel editor caller", () => {
    const actions = read("src", "features", "courseware-studio", "actions.ts");
    const guardMigration = read("supabase", "migrations", "20260726000200_p6_adapt_release_duplicate_guard.sql");
    const migration = read("supabase", "migrations", "20260726000100_p6_adapt_release_and_class_builder.sql");
    const retirement = read("supabase", "migrations", "20260902000500_courseware_legacy_publish_retirement.sql");
    const types = read("src", "lib", "database.types.ts");

    expect(migration).toContain("requested_count > 30");
    expect(migration).toContain("public.publish_cw_track_release");
    expect(guardMigration).toContain("ADAPT_RELEASE_NOT_READY");
    expect(guardMigration).toContain("'pending'");
    expect(fs.existsSync(path.join(root, "src", "features", "courseware-studio", "AdaptReleaseQueue.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src", "features", "courseware-studio", "adapt-release-actions.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src", "features", "courseware-studio", "CoursewarePageEditor.tsx"))).toBe(false);
    expect(actions).not.toContain("publishCoursewareReleaseAction");
    expect(actions).not.toContain('rpc<string>(supabase, "publish_cw_track_release"');
    expect(retirement).toContain("drop function if exists public.publish_cw_adapt_releases(uuid[], text)");
    expect(retirement).toContain("drop function if exists public.publish_cw_track_release(uuid, text, text)");
    expect(retirement).toContain("public.publish_cw_review_cycle(uuid, text, text)");
    expect(types).not.toContain("      publish_cw_adapt_releases:");
    expect(types).not.toContain("      publish_cw_track_release:");
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
