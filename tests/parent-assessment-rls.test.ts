import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261001000200_parent_assessment_requests.sql"), "utf8");

function source(name: string): string {
  const start = sql.indexOf(`create function public.${name}(`);
  if (start < 0) throw new Error(`Missing function: ${name}`);
  const end = sql.indexOf("$$;", start);
  if (end < 0) throw new Error(`Unclosed function: ${name}`);
  return sql.slice(start, end + 3).replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
}

const request = source("request_parent_assessment");
const confirm = source("confirm_parent_assessment");
const overview = source("parent_assessment_overview");
const projection = source("parent_assessment_request_projection");
const teachers = source("parent_assessment_eligible_teachers");
const blocker = source("parent_assessment_request_blocker");

describe("家长独立测评 SQL 权限与协调合同（源码检查）", () => {
  it("只扩展既有邀约与私有辅助函数，原表权限和教师流程保持原状", () => {
    expect(sql).toContain("alter table public.lead_invitation_threads");
    expect(sql).not.toMatch(/\bcreate\s+table\b/i);
    expect(sql).not.toMatch(/\b(?:create|alter|drop)\s+policy\b/i);
    expect(sql).not.toMatch(/\bgrant\s+(?:select|insert|update|delete|all)\b/i);
    expect(sql).not.toMatch(/create(?: or replace)? function public\.(?:set_invitation_assessor_availability|update_lead_invitation|ensure_\w+assessment)/i);
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(?:students|leads|activities|activity_registrations)\b/i);
    expect(sql.match(/insert into public\.lead_invitation_events/g)).toHaveLength(2);
    expect(sql.match(/perform public\.emit_domain_event/g)).toHaveLength(2);
  });

  it("仅三个入口可由 authenticated 执行，所有入口重新核验当前孩子和账号", () => {
    const exported = [...sql.matchAll(/grant execute on function public\.(\w+)\([^;]+ to authenticated;/g)].map((match) => match[1]);
    expect(exported.sort()).toEqual(["confirm_parent_assessment", "parent_assessment_overview", "request_parent_assessment"]);
    for (const match of sql.matchAll(/create function public\.(\w+)\(/g)) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${match[1]}\\([^;]* from public,anon,authenticated;`));
    }
    for (const body of [request, confirm, overview]) {
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path=public,pg_temp");
      expect(body).toContain("public.miniapp_can_participate(p_student_id,'grades')");
      expect(body).toMatch(/from public\.profiles where id=(?:v_uid|auth\.uid\(\)) and is_active/);
      expect(body).toContain("raise exception 'FORBIDDEN'");
    }
    expect(sql).not.toMatch(/grant[^;]+to (?:public|anon)\b/i);
  });

  it("学生到线索只使用已确认 UUID；多线索阻止新建但不会阻止已有邀约读取", () => {
    expect(blocker).toContain("from public.leads l where l.student_id=p_student_id");
    for (const code of ["NO_LINKED_LEAD", "AMBIGUOUS_LINKED_LEAD", "LEAD_UNAVAILABLE", "ACTIVE_INVITATION", "NO_ELIGIBLE_TEACHER"]) {
      expect(blocker).toContain(`return '${code}'`);
    }
    expect(blocker).toContain("if v_status='invalid'");
    expect(blocker).not.toContain("converted");
    expect(sql).not.toMatch(/suggested_student_id|phone_normalized|normalized_name|provisional_student_name/);
    expect(overview).toContain("where l.student_id=p_student_id and t.kind='assessment_1v1'");
    expect(overview).not.toContain("if v_blocker is not null then raise");
    expect(confirm).not.toContain("parent_assessment_request_blocker");
  });

  it("候选教师依赖当前在读班级及当前教学责任，并复核账号和测评权限", () => {
    for (const fragment of [
      "e.student_id=p_student_id and e.status='active' and e.left_at is null",
      "c.operational_status='active' and c.archived_at is null and c.trashed_at is null",
      "c.owner_id=p.id", "a.classroom_id=c.id and a.user_id=p.id",
      "a.responsibility in ('primary_teacher','assistant_teacher')",
      "p.role in ('staff','admin') and p.is_active and p.account_status='active'",
      "public.has_perm(p.id,'review.write')", "order by p.display_name,p.id limit 100",
    ]) expect(teachers).toContain(fragment);
    expect(teachers).not.toMatch(/school_subject_participants|lead_invitation_threads|list_invitation_assessors/);
    expect(request).toContain("public.parent_assessment_eligible_teachers(p_student_id) where id=p_assessor_id");
  });

  it("初始内容独立保存且不可变；重放在时效与新建资格检查之前", () => {
    expect(sql).toContain("parent_request_actor uuid references public.profiles(id) on delete restrict");
    expect(sql).toContain("add column parent_request_payload jsonb");
    const guard = source("guard_parent_assessment_request_metadata");
    expect(guard).toContain("new.parent_request_actor is distinct from old.parent_request_actor");
    expect(guard).toContain("new.parent_request_payload is distinct from old.parent_request_payload");
    expect(guard).toContain("raise exception 'PARENT_REQUEST_IMMUTABLE'");
    expect(request).toContain("array(select distinct option_value from unnest(p_parent_time_options) option_value order by option_value)");
    expect(request).toContain("v_invitation.parent_request_actor is distinct from v_uid");
    expect(request).toContain("v_invitation.parent_request_payload is distinct from v_payload");
    expect(request).toContain("raise exception 'IDEMPOTENCY_CONFLICT'");
    const replay = request.indexOf("return public.parent_assessment_request_projection(v_invitation.id,p_student_id)");
    expect(replay).toBeLessThan(request.indexOf("v_blocker :="));
    expect(replay).toBeLessThan(request.indexOf("foreach v_option"));
    expect(request.slice(0, replay)).not.toMatch(/v_invitation\.(?:parent_time_options|assessor_id|summary)\b/);
  });

  it("重复请求和同孩子新建有串行锁，确认先锁 lead 且不反向请求 student 锁", () => {
    expect(request).toContain("pg_advisory_xact_lock(hashtextextended('parent-assessment-request:'||p_request_id::text,0))");
    expect(request).toContain("where id=p_request_id for update");
    expect(request).toContain("perform 1 from public.students where id=p_student_id for update");
    expect(request).toContain("where student_id=p_student_id order by id limit 1 for update");
    expect(request).toContain("exception when unique_violation then raise exception 'ACTIVE_INVITATION'");
    expect(confirm.indexOf("for share of l")).toBeLessThan(confirm.indexOf("for update of t"));
    expect(confirm).not.toContain("from public.students");
    expect(confirm).toContain("t.kind='assessment_1v1' and l.student_id=p_student_id for update of t");
    expect(confirm).toContain("if not found then raise exception 'NOT_FOUND'");
    expect(confirm.lastIndexOf("miniapp_can_participate")).toBeGreaterThan(confirm.indexOf("for update of t"));
  });

  it("真实日期与上海时区产生具体时间；范围格不成为可确认时段", () => {
    const time = source("parent_assessment_time_at");
    expect(time).toContain("split_part(p_time_option,'@',1)::date");
    expect(time).toContain("exception when datetime_field_overflow or invalid_datetime_format then return null");
    expect(time).toContain("to_char(v_date,'YYYY-MM-DD') <> split_part(p_time_option,'@',1)");
    expect(time).toContain("at time zone 'Asia/Shanghai'");
    expect(time).not.toContain("after_school");
    expect(request).toContain("if v_time is null then raise exception 'VALIDATION'");
    expect(request).toContain("array_position(p_parent_time_options,null)");
    expect(request).toContain("cardinality(v_options)<>cardinality(p_parent_time_options)");
    expect(projection).toContain("option_value=any(t.assessor_time_options) and public.parent_assessment_time_at(option_value)>now()");
    expect(confirm).toContain("if v_time is null then raise exception 'TIME_UNAVAILABLE'");
  });

  it("确认检查状态版本和双方具体时间；同时间成功回放先于过期判断", () => {
    expect(confirm).toContain("v_invitation.state in ('confirmed','completed') and v_invitation.scheduled_at=v_time");
    const replay = confirm.indexOf("return public.parent_assessment_request_projection");
    expect(replay).toBeLessThan(confirm.indexOf("v_invitation.updated_at is distinct from p_expected_updated_at"));
    expect(replay).toBeLessThan(confirm.indexOf("if v_time<=now()"));
    expect(confirm).toContain("v_invitation.state<>'awaiting_parent'");
    expect(confirm).toContain("p_time_option=any(v_invitation.parent_time_options)");
    expect(confirm).toContain("p_time_option=any(v_invitation.assessor_time_options)");
    expect(confirm).toContain("set state='confirmed',scheduled_at=v_time,updated_by=v_uid");
    expect(confirm).not.toMatch(/ensure_\w+registration|state='completed'/);
  });

  it("返回合同白名单和有限列表；提议时间与双方确认时间分开投影", () => {
    const keys = new Set([...projection.matchAll(/'([a-zA-Z][a-zA-Z]+)',(?:[tlp]\.|case |to_jsonb\(|coalesce\()/g)].map((match) => match[1]));
    expect([...keys].sort()).toEqual([
      "id", "participantId", "teacher", "displayName", "state", "parentTimeOptions", "teacherTimeOptions",
      "sharedTimeOptions", "proposedStartsAt", "scheduledAt", "updatedAt", "canConfirm",
    ].sort());
    expect(projection).toContain("'proposedStartsAt',case when t.state='awaiting_parent' then t.scheduled_at else null end");
    expect(projection).toContain("'scheduledAt',case when t.state in ('confirmed','completed') then t.scheduled_at else null end");
    expect(projection).toContain("'canConfirm',coalesce(t.state='awaiting_parent' and l.status<>'invalid'");
    expect(projection).toContain("cardinality(shared.options)>0,false)");
    expect(projection).not.toMatch(/summary|note|phone|parent_request_payload|owner_id_at_open/);
    expect(overview).toContain("'timeZone','Asia/Shanghai'");
    expect(overview).toContain("order by t.updated_at desc,t.id desc limit 100");
  });
});
