import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4I-17 today's work becomes the default staff home", () => {
  it("dashboard/page.tsx 的 staff 分支渲染 TodayWorkHome，不再渲染 StaffHome", () => {
    const page = read("src", "app", "[locale]", "dashboard", "page.tsx");
    expect(page).toContain("TodayWorkHome");
    expect(page).not.toMatch(/<StaffHome\b/);
  });

  it("nav.ts 不再有独立的今日工作入口", () => {
    const nav = read("src", "features", "school", "nav.ts");
    expect(nav).not.toContain("/dashboard/work");
  });

  it("/dashboard/work 已硬切删除并纳入旧路由审计", () => {
    const workPage = path.join(root, "src", "app", "[locale]", "dashboard", "work", "page.tsx");
    const routeAudit = read("scripts", "verify-doc22-routes.mjs");
    expect(fs.existsSync(workPage)).toBe(false);
    expect(routeAudit).toContain('"/dashboard/work"');
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
