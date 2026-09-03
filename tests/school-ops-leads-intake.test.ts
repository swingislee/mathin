import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyXiaodituiInterest,
  parseXiaodituiWorksheet,
  splitXiaodituiInterests,
} from "../src/features/school/xiaoditui-import";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("SCHOOL-OPS Leads seed intake", () => {
  it("parses both current Xiaoditui export header variants", () => {
    const sharedTail = ["微信昵称", "提交时间", "是否重复", "获取方式", "推广员", "定位", "备注", "订单号", "支付状态", "支付时间"];
    const first = parseXiaodituiWorksheet([
      ["孩子姓名", "手机号码", "年级（9月开学年级）", "马上预约", ...sharedTail],
      ["小满", "138-0000-0001", "六年级", "一对一学情诊断-数独", "星星", "2026-09-01 10:20:30", "", "扫码", "推广一组", "城东", "", "A-1", "已支付", "2026-09-01 10:21:00"],
    ]);
    const second = parseXiaodituiWorksheet([
      ["孩子姓名", "手机号码", "孩子年级", "预约", ...sharedTail],
      ["小新", "13900000002", "大班", "持续关注领学习资料", "", "2026-09-02 08:00:00", "重复", "地推", "推广二组", "城西", "", "", "", ""],
    ]);

    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({
      sourceRow: 2,
      childName: "小满",
      grade: 6,
      interests: ["一对一学情诊断", "数独"],
      sourceDuplicate: false,
      promoter: "推广一组",
    });
    expect(first.rows[0].submittedAt).toBe("2026-09-01T02:20:30.000Z");
    expect(second.rows[0]).toMatchObject({ grade: null, sourceDuplicate: true });
    expect(splitXiaodituiInterests("公开课-公开课-英语体验课")).toEqual(["公开课", "英语体验课"]);
    expect(classifyXiaodituiInterest("一对一学情诊断")).toBe("assessment");
    expect(classifyXiaodituiInterest("持续关注领学习资料")).toBe("nurture");
  });

  it("keeps import application inside the Leads seed boundary", () => {
    const migration = read("supabase", "migrations", "20260902000800_school_ops_xiaoditui_intake.sql");
    const applySection = migration.slice(
      migration.indexOf("create or replace function public.apply_lead_import"),
      migration.indexOf("revoke all on function public.normalize_school_ops_phone"),
    );

    expect(migration).toContain("create table public.leads");
    expect(migration).toContain("create table public.lead_source_records");
    expect(migration).toContain("create table public.lead_interest_selections");
    expect(migration).toContain("suggested_student_id");
    expect(applySection).toContain("insert into public.leads");
    expect(applySection).toContain("'unassigned'");
    expect(applySection).toContain("null,");
    for (const forbiddenWrite of [
      "insert into public.students",
      "insert into public.families",
      "insert into public.contacts",
      "insert into public.activity_registrations",
      "insert into public.opportunities",
      "insert into public.orders",
      "insert into public.enrollments",
      "insert into public.payments",
    ]) {
      expect(applySection).not.toContain(forbiddenWrite);
    }
  });

  it("exposes a separate seed pool and keeps review decisions identity-free", () => {
    const page = read("src", "app", "[locale]", "dashboard", "leads", "page.tsx");
    const table = read("src", "features", "school", "LeadPoolTable.tsx");
    const panel = read("src", "features", "school", "XiaodituiImportPanel.tsx");
    const actions = read("src", "features", "school", "actions", "lead-imports.ts");
    const routes = read("src", "features", "school", "dashboard-routes.ts");

    expect(table).toContain("identityUnconfirmed");
    expect(table).toContain("studentSuggestion");
    expect(page).toContain("listLeadPool");
    expect(panel).toContain('href="/dashboard/leads"');
    expect(panel).toContain("getLeadImportBatchAction");
    expect(actions).toContain('z.enum(["create_new", "link_existing", "skip"])');
    expect(actions).not.toContain("create_household_student");
    expect(routes).toContain('href: "/dashboard/leads"');
  });
});
