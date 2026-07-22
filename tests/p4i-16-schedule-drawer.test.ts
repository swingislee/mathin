import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4I-16 schedule and quick drawer contract", () => {
  it("schedule.ts 的冲突判定同时看教师和教室重叠", () => {
    const schedule = read("src", "features", "school", "schedule.ts");
    expect(schedule).toContain("room: string");
    expect(schedule).toContain("collectOverlapConflicts");
    expect(schedule).toContain("entry.teacherName");
    expect(schedule).toContain("entry.room");
  });

  it("SessionManagementDrawer 瘦身为快速抽屉：不再引用点名/课评/课件版本，包含打开完整课次链接", () => {
    const drawer = read("src", "features", "school", "SessionManagementDrawer.tsx");
    expect(drawer).not.toContain("AttendanceDrawer");
    expect(drawer).not.toContain("ReviewDrawer");
    expect(drawer).not.toContain("setSessionCoursewareTrackOverrideAction");
    expect(drawer).toContain("SessionChangeDialog");
    expect(drawer).toContain("SubstituteTeacherDialog");
    expect(drawer).toContain("/dashboard/sessions/${session.id}");
  });

  it("classes.ts 导出课表快速抽屉用的单课次精简查询", () => {
    const classes = read("src", "features", "school", "classes.ts");
    expect(classes).toContain("export async function getSessionQuickRow");
    expect(classes).toContain("export interface SessionQuickRow");
  });

  it("ScheduleWeekView 接入抽屉点击、sticky 表头与东八区安全的日期工具函数", () => {
    const view = read("src", "features", "school", "ScheduleWeekView.tsx");
    expect(view).toContain('from "@/i18n/navigation"');
    expect(view).toContain("/dashboard/schedule?session=");
    expect(view).toContain("sticky top-0");
    expect(view).toContain('from "./schedule"');
    expect(view).not.toContain("function startOfWeek");
  });

  it("DashboardShell 把课表页纳入全高内部滚动的 workspace 白名单", () => {
    const shell = read("src", "features", "school", "DashboardShell.tsx");
    expect(shell).toContain('segments[1] === "schedule"');
  });

  it("classes/[id] 和课表页共用同一个瘦身后的快速抽屉，参数一致", () => {
    const classesPage = read("src", "app", "[locale]", "dashboard", "classes", "[id]", "page.tsx");
    const schedulePage = read("src", "app", "[locale]", "dashboard", "schedule", "page.tsx");
    expect(classesPage).toContain("classroomName={classroom.name}");
    expect(classesPage).toContain("classroomRoom={classroom.room}");
    expect(schedulePage).toContain("getSessionQuickRow");
    expect(schedulePage).toContain('scroll="internal"');
  });
});
