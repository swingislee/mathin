import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P6 adaptation background rework contract", () => {
  it("separates system superseded history from human rejection and immutable repair lineage", () => {
    const migration = read("supabase", "migrations", "20260726000300_p6_adapt_background_rework.sql");

    expect(migration).toContain("'pending', 'approved', 'rejected', 'superseded'");
    expect(migration).toContain("rejection_code");
    expect(migration).toContain("supersedes_id");
    expect(migration).toContain("superseded_by_id");
    expect(migration).toContain("guard_cw_adapt_background_audit");
    expect(migration).toContain("list_cw_adapt_background_rework_queue");
    expect(migration).toContain("list_cw_adapt_background_history");
    expect(migration).toContain("repair_cw_adapt_background");
    expect(migration).toContain("P6-6 superseded during deterministic CAS repair");
  });

  it("requires a structured rejection reason and exposes crop repair plus adjacent editing paths", () => {
    const review = read("src", "features", "courseware-studio", "AdaptReviewQueue.tsx");
    const rework = read("src", "features", "courseware-studio", "AdaptBackgroundReworkQueue.tsx");
    const page = read("src", "app", "[locale]", "dashboard", "courseware", "review", "page.tsx");

    expect(review).toContain("ADAPT_REJECTION_CODES");
    expect(review).toContain("adaptRejectReasonRequired");
    expect(review).toContain("rejectNote");
    expect(rework).toContain("cropToFile");
    expect(rework).toContain("stageCoursewareImageReplacementAction");
    expect(rework).toContain("repairAdaptBackgroundAction");
    expect(rework).toContain("track=adapted-4x3");
    expect(rework).toContain("track=native-16x9");
    expect(rework).toContain("adaptChangeClassification");
    expect(page).toContain('requestedTab === "rework"');
    expect(page).toContain('requestedTab === "history"');
  });
});
