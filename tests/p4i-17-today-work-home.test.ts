import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4I-17 today's work becomes the default staff home", () => {
  it("dashboard/page.tsx 的 staff 分支渲染 TodayWorkHome，不再渲染 StaffHome", () => {
    const page = read("src", "app", "[locale]", "dashboard", "page.tsx");
    expect(page).toContain("TodayWorkHome");
    expect(page).not.toContain("StaffHome");
  });

  it("StaffHome.tsx 不再读取 dashboard_layouts，TileWorkspace 调用带 readOnly", () => {
    const staffHome = read("src", "features", "school", "home", "StaffHome.tsx");
    expect(staffHome).not.toContain('from("dashboard_layouts")');
    expect(staffHome).toContain("readOnly");
  });

  it("TileWorkspace 支持 readOnly 关闭编辑入口", () => {
    const workspace = read("src", "features", "school", "TileWorkspace.tsx");
    expect(workspace).toContain("readOnly?: boolean");
    expect(workspace).toContain("readOnly ? undefined :");
  });

  it("旧磁贴只读对账挂在 operations/legacy-home，用 audit.view 门禁", () => {
    const legacyPage = read("src", "app", "[locale]", "dashboard", "operations", "legacy-home", "page.tsx");
    expect(legacyPage).toContain("StaffHome");
    expect(legacyPage).toContain('requirePerm(locale, "audit.view")');
  });

  it("nav.ts 不再有独立的今日工作入口", () => {
    const nav = read("src", "features", "school", "nav.ts");
    expect(nav).not.toContain("/dashboard/work");
  });

  it("/dashboard/work 变成到 /dashboard 的重定向", () => {
    const workPage = read("src", "app", "[locale]", "dashboard", "work", "page.tsx");
    expect(workPage).toContain("redirect(`/${locale}/dashboard`)");
  });

  it("work-items.ts 的兜底路由不再指向已废弃的 /dashboard/work", () => {
    const workItems = read("src", "features", "school", "work-items.ts");
    expect(workItems).not.toContain('"/dashboard/work"');
  });

  it("接入了五个工作项状态 RPC 的 Server Action", () => {
    const actions = read("src", "features", "school", "actions", "work-items.ts");
    for (const rpc of ["set_work_item_seen", "snooze_work_item", "pin_work_item", "acknowledge_work_item", "watch_work_item"]) {
      expect(actions).toContain(rpc);
    }
  });

  it("WorkItemActions 挂进 TodayWorkHome 的 renderActions 插槽", () => {
    const home = read("src", "features", "school", "home", "TodayWorkHome.tsx");
    expect(home).toContain("renderActions");
    expect(home).toContain("WorkItemActions");
  });
});
