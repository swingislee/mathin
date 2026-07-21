import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4I-13 classroom workspace contract", () => {
  it("班级页面用舞台原语拼装，不再是 P4H 时代的自制 header/tab", () => {
    const page = read("src", "app", "[locale]", "dashboard", "classes", "[id]", "page.tsx");
    expect(page).toContain("ObjectBar");
    expect(page).toContain("ObjectWorkspace");
    expect(page).toContain("ContextBar");
    expect(page).not.toContain("SchoolPageHeader");
  });

  it("课次点击合同统一：主体进工作区，⋯开快速管理，进入教室是独立按钮，不再按权限整行分流", () => {
    const list = read("src", "features", "school", "SessionGroupList.tsx");
    expect(list).toContain("/dashboard/sessions/");
    expect(list).toContain("quickManageHref");
    expect(list).not.toContain("canPrepare || canEnterLive");
  });

  it("课次工作区路由存在且鉴权正确（P4I-14 起深化为课前/课堂/课后，见 p4i-14 测试）", () => {
    const route = read("src", "app", "[locale]", "dashboard", "sessions", "[sessionId]", "page.tsx");
    expect(route).toContain("requireUser");
    expect(route).toContain("getSessionWorkspaceDetail");
    expect(route).toContain("SessionWorkspaceBody");
  });

  it("resolveWorkItemHref 已接上 session 工作项的过渡期路由替换", () => {
    const workItems = read("src", "features", "school", "work-items.ts");
    expect(workItems).toContain('case "session":');
    expect(workItems).toContain("/dashboard/sessions/${item.primaryObjectId}");
  });

  it("班级生命周期 RPC 首次接上 Server Action", () => {
    const actions = read("src", "features", "school", "actions", "classes.ts");
    expect(actions).toContain("transitionClassroomStatusAction");
    expect(actions).toContain("trashClassroomAction");
    expect(actions).toContain("restoreClassroomAction");
    expect(actions).toContain("transition_classroom_status");
  });

  it("运营记录 RPC 用独立 scope 判断，不依赖 domain_events 的个人审计 RLS", () => {
    const migration = read("supabase", "migrations", "20260721000100_p4i13_classroom_operational_events.sql");
    expect(migration).toContain("create or replace function public.list_classroom_operational_events");
    expect(migration).toContain("create or replace function public.get_classroom_roster_signals");
    expect(migration).toContain("classroom_staff_assignments");
  });
});
