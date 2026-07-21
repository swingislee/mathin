import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("P4I-14 session workspace contract", () => {
  it("完成备课走独立 RPC，不改 freeze_session_courseware 的 guard", () => {
    const migration = read("supabase", "migrations", "20260722000100_p4i14_session_workspace.sql");
    expect(migration).toContain("create or replace function public.save_session_prepared_courseware");
    expect(migration).toContain("if started is not null then raise exception 'ALREADY_STARTED'");
    expect(migration).toContain("create or replace function public.record_session_blank_fallback");
    expect(migration).toContain("create or replace function public.list_session_preparation_copy_candidates");

    const freeze = read("supabase", "migrations", "20260719000900_p6_courseware_tracks.sql");
    expect(freeze).toContain("where id=p_session_id and started_at is null and courseware_frozen_at is null");
  });

  it("课次工作区已从 stub 深化为三段结构，主动作恒为 Link", () => {
    const body = read("src", "features", "school", "SessionWorkspaceBody.tsx");
    expect(body).toContain("SessionPrepPanel");
    expect(body).toContain("SessionLivePanel");
    expect(body).toContain("SessionPostworkPanel");
    expect(body).toContain("<Link");
  });

  it("课后面板只做通用标记，不实现 P4I-15 的逐类型专用表单", () => {
    const post = read("src", "features", "school", "SessionPostworkPanel.tsx");
    expect(post).toContain("SessionTaskActions");
    expect(post).not.toContain("AttendanceDrawer");
    expect(post).not.toContain("ReviewDrawer");
  });

  it("备课/复制/完成/任务/课后 Server Action 均已接线", () => {
    const actions = read("src", "features", "school", "actions", "classes.ts");
    expect(actions).toContain("startSessionPreparationAction");
    expect(actions).toContain("copySessionPreparationAction");
    expect(actions).toContain("listSessionPreparationCopyCandidatesAction");
    expect(actions).toContain("completeSessionPreparationAction");
    expect(actions).toContain("completeSessionTaskAction");
    expect(actions).toContain("completeSessionPostworkAction");
    expect(actions).toContain("reopenSessionPostworkAction");
    expect(actions).toContain("save_session_prepared_courseware");
    expect(actions).toContain("record_session_blank_fallback");
  });

  it("工作态与复合状态标签是独立于事件状态的纯函数", () => {
    const scopes = read("src", "features", "school", "teaching-operations", "scopes.ts");
    expect(scopes).toContain("export function deriveSessionWorkState");
    expect(scopes).toContain("export function computeSessionStatusLabel");
    expect(scopes).not.toContain("server-only");
  });

  it("空白课堂降级事件复用班级运营记录时间线，不新增 work-item 告警源", () => {
    const panel = read("src", "features", "school", "OperationalRecordsPanel.tsx");
    expect(panel).toContain("session.courseware.blank_fallback");
    const workItemsMigration = read("supabase", "migrations", "20260720001700_p4i6_work_item_projection.sql");
    expect(workItemsMigration).not.toContain("blank_fallback");
  });
});
