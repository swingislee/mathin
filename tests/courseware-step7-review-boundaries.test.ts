import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
const exists = (...segments: string[]) => fs.existsSync(path.join(root, ...segments));

describe("DEV-CW-1 Step 7 review semantics", () => {
  it("projects formal and teacher-microcourse reviews into one research workspace", () => {
    const page = read("src", "app", "[locale]", "dashboard", "courseware", "review", "page.tsx");
    const formal = read("src", "features", "courseware-studio", "formal-review-data.ts");
    const workspace = read("src", "features", "teacher-microcourses", "MicrocourseReviewWorkspace.tsx");

    expect(page).toContain('type ReviewTab = "formal" | "microcourses"');
    expect(page).toContain("<FormalCoursewareReviewQueue");
    expect(page).toContain("<MicrocourseReviewWorkspace");
    expect(page).toContain('requirePerm(locale, "courseware.review")');
    expect(formal).toContain('stage", ["in_review", "ready_to_publish"]');
    expect(formal).toContain("listTeacherMicrocourseReviewQueue");
    expect(workspace).toContain("<MicrocourseReviewQueue");
    expect(workspace).not.toContain("<MicrocourseSessionWorkspaceQueue");
  });

  it("retires split list routes and the old adaptation review surfaces", () => {
    const routes = read("src", "features", "school", "dashboard-routes.ts");
    const nav = read("src", "features", "school", "nav.ts");

    expect(routes).toContain('href: "/dashboard/courseware/review"');
    expect(routes).toContain('hrefPattern: "/dashboard/courseware/microcourse-reviews/[reviewCycleId]"');
    expect(routes).not.toContain('href: "/dashboard/courseware/microcourse-reviews"');
    expect(routes).not.toContain('href: "/dashboard/courseware/preparation-review"');
    expect(routes).not.toContain('hrefPattern: "/dashboard/courseware/review/microcourses/[reviewCycleId]"');
    expect(nav).toContain('"coursewareReview"');
    expect(nav).not.toContain('"microcourseReviews"');
    expect(nav).not.toContain('"coursewarePreparationReview"');
    expect(exists("src", "features", "courseware-studio", "AdaptReviewQueue.tsx")).toBe(false);
    expect(exists("src", "features", "courseware-studio", "adapt-review-data.ts")).toBe(false);
  });

  it("keeps preparation review inside the session object reached by work items", () => {
    const workItems = read("src", "features", "school", "work-items.ts");
    const prepPanel = read("src", "features", "school", "SessionPrepPanel.tsx");
    const prepFlow = read("src", "features", "school", "SessionPreparationFlow.tsx");

    expect(workItems).toContain('case "session"');
    expect(workItems).toContain('`/dashboard/sessions/${item.primaryObjectId}`');
    expect(prepPanel).toContain("canReview={prepArtifacts.reviewerId === detail.viewerId}");
    expect(prepFlow).toContain("<PreparationReviewActions");
    expect(exists("src", "app", "[locale]", "dashboard", "courseware", "preparation-review", "page.tsx")).toBe(false);
  });
});
