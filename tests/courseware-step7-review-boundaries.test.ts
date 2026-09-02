import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("DEV-CW-1 Step 7A review object boundaries", () => {
  it("keeps formal adaptation and teacher-microcourse review in separate workspaces", () => {
    const adaptation = read("src", "app", "[locale]", "dashboard", "courseware", "review", "page.tsx");
    const microcourse = read("src", "app", "[locale]", "dashboard", "courseware", "microcourse-reviews", "page.tsx");
    const workspace = read("src", "features", "teacher-microcourses", "MicrocourseReviewWorkspace.tsx");

    expect(adaptation).toContain("<AdaptReviewQueue");
    expect(adaptation).toContain('redirect(`/${locale}/dashboard/courseware/microcourse-reviews`)');
    expect(adaptation).not.toContain("<MicrocourseReviewQueue");
    expect(adaptation).not.toContain("listTeacherMicrocourseReviewQueue");
    expect(microcourse).toContain('requirePerm(locale, "courseware.review")');
    expect(microcourse).toContain("<MicrocourseReviewWorkspace");
    expect(workspace).toContain("<MicrocourseReviewQueue");
    expect(workspace).toContain("<MicrocourseSessionWorkspaceQueue");
  });

  it("keeps legacy URLs as redirects and makes the new review route canonical", () => {
    const routes = read("src", "features", "school", "dashboard-routes.ts");
    const nav = read("src", "features", "school", "nav.ts");
    const legacyDetail = read("src", "app", "[locale]", "dashboard", "courseware", "review", "microcourses", "[reviewCycleId]", "page.tsx");
    const queue = read("src", "features", "teacher-microcourses", "MicrocourseReviewQueue.tsx");
    const panel = read("src", "features", "teacher-microcourses", "MicrocourseReviewPanel.tsx");

    expect(routes).toContain('href: "/dashboard/courseware/microcourse-reviews"');
    expect(routes).toContain('hrefPattern: "/dashboard/courseware/microcourse-reviews/[reviewCycleId]"');
    expect(routes).toContain('hrefPattern: "/dashboard/courseware/review/microcourses/[reviewCycleId]"');
    expect(nav).toContain('"microcourseReviews"');
    expect(legacyDetail).toContain("redirect(`/${locale}/dashboard/courseware/microcourse-reviews/${reviewCycleId}`)");
    expect(queue).toContain("/dashboard/courseware/microcourse-reviews/${item.reviewCycleId}");
    expect(panel).not.toContain("review?tab=microcourses");
  });
});
