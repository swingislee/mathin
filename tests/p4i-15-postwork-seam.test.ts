import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4I-15 postwork seam contract", () => {
  it("新迁移补上缺勤/补课生成，且不重写既有 record_session_change/freeze 逻辑", () => {
    const migration = read("supabase", "migrations", "20260722000200_p4i15_postwork_seam.sql");
    expect(migration).toContain("create or replace function public.record_attendance_absence");
    expect(migration).toContain("class_support_tasks_session_student_kind_idx");
    expect(migration).toContain("'makeup_followup'");
    expect(migration).toContain("public.record_session_change(request_row.session_id, request_row.student_id, 'leave', null, request_row.reason)");
  });

  it("课后工作区把主动作、独立发布、逐生记录与两类审阅放回各自业务位置", () => {
    const panel = read("src", "features", "school", "SessionPostworkPanel.tsx");
    const workspace = read("src", "features", "school", "SessionWorkspaceBody.tsx");
    expect(workspace).toContain('stage === "post"');
    expect(workspace).toContain("AttendanceDrawer");
    expect(workspace).toContain("SessionCompletePostworkButton");
    expect(panel).toContain("SessionStudentPostworkCards");
    expect(panel).toContain("SessionAssignmentReviewPanel");
    expect(panel).toContain("VideoReviewPanel");
    expect(panel).toContain("SupportTaskRecipientList");
    expect(panel).toContain("SessionFamilyBriefPanel");
    expect(panel).not.toContain("<ReviewDrawer");
    expect(panel).not.toContain("SessionFollowUpQuickForm");
    expect(panel).not.toContain("<ol");
    expect(panel.indexOf("independentPublicationsTitle")).toBeLessThan(panel.indexOf("classPerformanceTitle"));
  });

  it("跟进表单复用 addStudentFollowUp，不接 P4C 招生漏斗的 statusAfter 语义", () => {
    const form = read("src", "features", "school", "SessionStudentPostworkCards.tsx");
    expect(form).toContain("addStudentFollowUp");
    expect(form).toContain('kind: "class"');
    expect(form).toContain("statusAfter: null");
    expect(form).not.toContain('from "./FollowUpForm"');
  });

  it("逐生课评保存不再误完成独立知识总结任务", () => {
    const actions = read("src", "features", "school", "review-actions.ts");
    expect(actions).toContain('.eq("kind", "reviews")');
    expect(actions).not.toContain('.in("kind", ["reviews", "summary"])');
  });

  it("support-tasks.ts 的类型与数据库枚举同步（renewal_followup/invalidated）", () => {
    const supportTasks = read("src", "features", "school", "support-tasks.ts");
    expect(supportTasks).toContain("renewal_followup");
    expect(supportTasks).toContain("invalidated");
  });

  it("P4I-15 新增 Server Action 齐全", () => {
    const actions = read("src", "features", "school", "actions", "classes.ts");
    expect(actions).toContain("export async function decideSessionLeaveRequestAction");
    expect(actions).toContain("export async function updateSupportTaskRecipientAction");
    expect(actions).toContain("export async function saveSessionFamilyBriefAction");
    expect(actions).toContain("export async function publishSessionFamilyBriefAction");
  });

  it("视频审阅只保留所属课次的查询，不恢复已删除的无入口全校队列", () => {
    const videos = read("src", "features", "school", "videos.ts");
    expect(videos).toContain("export async function listSessionVideos(sessionId: string)");
    expect(videos).not.toContain("export async function listReviewVideos()");
  });

  it("请假批准/驳回和支持任务逐人操作走的是 UNAUTHENTICATED 裸校验，鉴权交给 RPC", () => {
    const actions = read("src", "features", "school", "actions", "classes.ts");
    const decideSection = actions.slice(actions.indexOf("export async function decideSessionLeaveRequestAction"));
    expect(decideSection.slice(0, 400)).toContain("UNAUTHENTICATED");
    expect(decideSection.slice(0, 400)).not.toContain("authorizedClient(");
  });
});
