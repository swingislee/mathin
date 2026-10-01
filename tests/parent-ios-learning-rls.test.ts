import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const original = read("supabase/migrations/20260922010000_parent_miniapp_portal.sql");
const upgrade = read("supabase/migrations/20261001000100_parent_report_participant_identity.sql");

function functionSource(sql: string, name: string): string {
  const declaration = new RegExp(`create (?:or replace )?function public\\.${name}\\(`, "i");
  const start = sql.search(declaration);
  if (start < 0) throw new Error(`Missing SQL function: ${name}`);
  const end = sql.indexOf("$$;", start);
  if (end < 0) throw new Error(`Unclosed SQL function: ${name}`);
  return sql.slice(start, end + 3).replace("create or replace function", "create function").replace(/\s+/g, " ").trim();
}

describe("家长端报告参与人标识与已有授权合同", () => {
  it("仅增补稳定学生 ID，保持原报告、发送状态、排序和权限表达式", () => {
    const before = functionSource(original, "miniapp_assessment_reports");
    const after = functionSource(upgrade, "miniapp_assessment_reports");
    expect(after.match(/'participantId',s\.id,/g)).toHaveLength(1);
    expect(after.replace("'participantId',s.id,", "")).toBe(before);
  });

  it("报告沿用当前账号、未删除学生和 grades 权限，匿名无执行授权", () => {
    const canParticipate = functionSource(original, "miniapp_can_participate");
    expect(canParticipate).toContain("p_scope text default 'grades'");
    expect(canParticipate).toContain("public.miniapp_family_ready()");
    expect(canParticipate).toContain("s.deleted_at is null");
    expect(canParticipate).toContain("s.user_id=auth.uid() or public.guardian_can(s.id,auth.uid(),p_scope)");
    const ready = functionSource(original, "miniapp_family_ready");
    expect(ready).toContain("p.account_status='active' and not p.password_change_required");
    expect(ready).toContain("public.has_current_required_consents(auth.uid())");
    expect(upgrade).toMatch(/revoke all on function public\.miniapp_assessment_reports\(\) from public,anon,authenticated;/);
    expect(upgrade).toMatch(/grant execute on function public\.miniapp_assessment_reports\(\) to authenticated;/);
    expect(upgrade).not.toMatch(/grant[^;]+to (?:public|anon)\b/i);
  });

  it("只升级同签名只读 RPC，不新增表、业务写入或扩大既有策略", () => {
    expect(upgrade.match(/create or replace function/g)).toHaveLength(1);
    expect(upgrade).toMatch(/returns jsonb\s+language sql security definer stable set search_path=public,pg_temp/);
    expect(upgrade).not.toMatch(/\b(?:create|alter|drop)\s+(?:table|policy)\b/i);
    expect(upgrade).not.toMatch(/\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i);
  });
});
