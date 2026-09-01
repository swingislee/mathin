import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("DEV-SCHOOL-OPS-1 Phase 1 business surfaces", () => {
  it("keeps planning content out of the Mathin product", () => {
    expect(fs.existsSync(path.join(root, "src/app/[locale]/dashboard/school-ops/page.tsx"))).toBe(false);
    expect(read("src/features/school/dashboard-routes.ts")).not.toContain("schoolOps");
    expect(read("src/features/school/nav.ts")).not.toContain("schoolOps");
    expect(read("messages/zh.json")).not.toContain("运营主流程审阅");
  });

  it("makes the data inbox operate on real import batches and actions", () => {
    const page = read("src/app/[locale]/dashboard/students/import/page.tsx");
    const panel = read("src/features/school/ImportStudentsPanel.tsx");
    const data = read("src/features/school/student-imports.ts");
    const actions = read("src/features/school/actions/students.ts");
    expect(page).toContain("<Suspense");
    expect(page).toContain("listRecentStudentImportBatches");
    expect(panel).toContain('type="file"');
    expect(panel).toContain("importBatchSource");
    expect(panel).toContain("previewStudentImportAction");
    expect(panel).toContain("applyStudentImportAction");
    expect(panel).toContain("duplicatesReviewed");
    expect(panel).toContain('href="/dashboard/followups"');
    expect(data).toContain('from("data_import_batches")');
    expect(actions).toContain("source: requiredText(100)");
    expect(panel).not.toContain("<table");
  });

  it("supports owner assignment, communication, and next action on the lead workspace", () => {
    const page = read("src/app/[locale]/dashboard/followups/page.tsx");
    const board = read("src/features/school/FollowUpBoardList.tsx");
    const form = read("src/features/school/FollowUpForm.tsx");
    const data = read("src/features/school/followups.ts");
    expect(page).toContain("listStaffMembers");
    expect(page).toContain('href="/dashboard/students/import"');
    expect(board).toContain("assignStudentAction");
    expect(board).toContain("FollowUpForm");
    expect(form).toContain("DateTimePicker");
    expect(form).toContain("addStudentFollowUp");
    expect(data).toContain("assigned_to");
    expect(board).not.toContain("<table");
    expect(form).not.toContain("<button");
  });
});
