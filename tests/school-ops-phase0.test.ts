import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("DEV-SCHOOL-OPS-1 Phase 0", () => {
  it("registers the active milestone plan without changing the sole current stage", () => {
    const plan = read("docs/plan/30-mathin_school_ops_architecture_plan.md");
    const roadmap = read("docs/plan/04-roadmap.md");
    expect(plan).toContain("**规划状态**：`active`");
    expect(plan).toContain("Phase 0 · 流程校准与模型核验");
    expect(plan).toContain("Phase 2：活动 / 测评 / 销售机会");
    expect(plan).toContain("Phase 5：续报与长期运营");
    expect(roadmap).toContain("DEV-SCHOOL-OPS-1 · 学辅运营与教学履约主干");
    expect(roadmap.match(/^> \*\*当前施工阶段\*\*：/gm)).toHaveLength(1);
  });

  it("keeps the review page read-only, permission-scoped, and connected to real routes", () => {
    const page = read("src/app/[locale]/dashboard/school-ops/page.tsx");
    const data = read("src/features/school/school-ops-architecture.ts");
    expect(page).toContain("<Suspense");
    expect(page).toContain("requireAnyPerm(locale, SCHOOL_OPS_REVIEW_PERMS)");
    expect(page).toContain('href: "/dashboard/students/import"');
    expect(page).toContain('href: "/dashboard/followups"');
    expect(page).toContain('href: "/dashboard/activities"');
    expect(page).toContain('href: "/dashboard/classes"');
    expect(page).not.toContain("use client");
    expect(page).not.toContain("<table");
    expect(data).toContain('from("data_import_batches")');
    expect(data).toContain('from("session_attendance")');
    expect(data).not.toContain("createServiceClient");
  });
});
