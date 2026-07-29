"use server";

// ---------------------------------------------------------------------------
// 今日工作的用户状态动作（P4I-17）：已读/稍后处理/置顶/确认/关注。
// 五个 RPC 是 P4I-6 就建好的（`work_item_user_state` 表 + 5 个 SECURITY DEFINER
// 函数），本文件只是「入参校验 + 透传」，业务规则（now 桶禁止 snooze、
// overdue/today 上限 24h、其余上限 14 天、置顶只在同一 urgency_bucket 内生效）
// 全部在 RPC/`list_my_work_items` 里，这里不重复实现。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { nullableRpcArg, staffRpcClient } from "./guards";
import { COMMON_CODES, datetime, parse, requiredText } from "./schemas";

const WORK_ITEM_CODES = ["INVALID_WORK_KEY", "INVALID_SNOOZE_UNTIL", "SNOOZE_NOT_ALLOWED", "NOT_FOUND", ...COMMON_CODES] as const;

const workKeySchema = z.object({ workKey: requiredText(200) });

export async function markWorkItemSeenAction(workKey: string): Promise<ActionResult> {
  try {
    const value = parse(workKeySchema, { workKey });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("set_work_item_seen", { p_work_key: value.workKey });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}

const snoozeSchema = z.object({ workKey: requiredText(200), until: datetime });

export async function snoozeWorkItemAction(workKey: string, until: string): Promise<ActionResult> {
  try {
    const value = parse(snoozeSchema, { workKey, until });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("snooze_work_item", { p_work_key: value.workKey, p_until: value.until });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}

const pinSchema = z.object({ workKey: requiredText(200), pinned: z.boolean() });

export async function pinWorkItemAction(workKey: string, pinned: boolean): Promise<ActionResult> {
  try {
    const value = parse(pinSchema, { workKey, pinned });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("pin_work_item", { p_work_key: value.workKey, p_pinned: value.pinned });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}

export async function acknowledgeWorkItemAction(workKey: string): Promise<ActionResult> {
  try {
    const value = parse(workKeySchema, { workKey });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("acknowledge_work_item", { p_work_key: value.workKey });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}

const watchSchema = z.object({ workKey: requiredText(200), watching: z.boolean() });

export async function watchWorkItemAction(workKey: string, watching: boolean): Promise<ActionResult> {
  try {
    const value = parse(watchSchema, { workKey, watching });
    const { supabase } = await staffRpcClient();
    const { error } = await supabase.rpc("watch_work_item", { p_work_key: value.workKey, p_watching: value.watching });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, WORK_ITEM_CODES);
  }
}
const COORDINATION_CODES = [
  "INVALID_SOURCE_KIND",
  "INVALID_IDEMPOTENCY",
  "INVALID_DOMAIN",
  "INVALID_TEXT",
  "INVALID_PRIORITY",
  "INVALID_ACTION_HREF",
  "INVALID_ASSIGNEE",
  "INVALID_APPROVER",
  "INVALID_KIND",
  "INVALID_DECISION",
  "PAYLOAD_TOO_LARGE",
  "IDEMPOTENCY_CONFLICT",
  "FORBIDDEN_SELF_APPROVAL",
  "ALREADY_DECIDED",
  "APPROVAL_NOT_PENDING",
  "WORK_ITEM_CLOSED",
  "NOT_FOUND",
  ...COMMON_CODES,
] as const;

const domain = z.enum(["curriculum", "teaching", "student_service", "finance", "operations"]);
const priority = z.enum(["low", "normal", "high", "critical"]);
const nullableDatetime = z.union([datetime, z.null()]);
const actionHref = z.string().trim().min(1).max(500).startsWith("/");

const createDurableWorkItemSchema = z.object({
  sourceKind: z.enum(["manual", "cross_domain", "delegation", "sla"]),
  sourceId: requiredText(160),
  idempotencyKey: requiredText(200),
  domain,
  title: requiredText(160),
  description: z.string().trim().max(2000),
  assigneeId: z.uuid(),
  dueAt: nullableDatetime,
  priority,
  createdReason: requiredText(500),
  actionHref,
});

export type CreateDurableWorkItemInput = z.input<typeof createDurableWorkItemSchema>;

export async function createDurableWorkItemAction(input: CreateDurableWorkItemInput): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(createDurableWorkItemSchema, input);
    const { supabase } = await staffRpcClient();
    const { data, error } = await supabase.rpc("create_durable_work_item", {
      p_source_kind: value.sourceKind,
      p_source_id: value.sourceId,
      p_idempotency_key: value.idempotencyKey,
      p_domain: value.domain,
      p_title: value.title,
      p_description: value.description,
      p_assignee_id: value.assigneeId,
      p_due_at: nullableRpcArg(value.dueAt),
      p_priority: value.priority,
      p_created_reason: value.createdReason,
      p_action_href: value.actionHref,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { id: data } };
  } catch (error) {
    return actionError(error, COORDINATION_CODES);
  }
}

const requestApprovalSchema = z.object({
  approvalKind: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
  subjectKind: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
  subjectId: requiredText(160),
  idempotencyKey: requiredText(200),
  domain,
  title: requiredText(160),
  requestReason: requiredText(1000),
  approverId: z.uuid(),
  dueAt: nullableDatetime,
  priority,
  actionHref,
});

export type RequestApprovalInput = z.input<typeof requestApprovalSchema>;

export async function requestApprovalAction(input: RequestApprovalInput): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(requestApprovalSchema, input);
    const { supabase } = await staffRpcClient();
    const { data, error } = await supabase.rpc("request_approval", {
      p_approval_kind: value.approvalKind,
      p_subject_kind: value.subjectKind,
      p_subject_id: value.subjectId,
      p_idempotency_key: value.idempotencyKey,
      p_domain: value.domain,
      p_title: value.title,
      p_request_reason: value.requestReason,
      p_payload: {},
      p_approver_id: value.approverId,
      p_due_at: nullableRpcArg(value.dueAt),
      p_priority: value.priority,
      p_action_href: value.actionHref,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { id: data } };
  } catch (error) {
    return actionError(error, COORDINATION_CODES);
  }
}

const closeDurableSchema = z.object({ id: z.uuid(), reason: requiredText(1000), idempotencyKey: requiredText(200) });

export async function closeDurableWorkItemAction(id: string, reason: string, idempotencyKey: string): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(closeDurableSchema, { id, reason, idempotencyKey });
    const { supabase } = await staffRpcClient();
    const { data, error } = await supabase.rpc("close_durable_work_item", {
      p_work_item_id: value.id, p_closed_reason: value.reason, p_idempotency_key: value.idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { id: data } };
  } catch (error) {
    return actionError(error, COORDINATION_CODES);
  }
}

const decideApprovalSchema = z.object({
  id: z.uuid(), decision: z.enum(["approved", "rejected"]), reason: requiredText(1000), idempotencyKey: requiredText(200),
});

export async function decideApprovalAction(id: string, decision: "approved" | "rejected", reason: string, idempotencyKey: string): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(decideApprovalSchema, { id, decision, reason, idempotencyKey });
    const { supabase } = await staffRpcClient();
    const { data, error } = await supabase.rpc("decide_approval", {
      p_request_id: value.id, p_decision: value.decision, p_decision_reason: value.reason,
      p_evidence: {}, p_idempotency_key: value.idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { id: data } };
  } catch (error) {
    return actionError(error, COORDINATION_CODES);
  }
}
