import "server-only";

import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import type { WorkItemRow } from "./stage/types";

// ---------------------------------------------------------------------------
// P4I-8：今日工作只读试用（docs/plan/19-p4i-final.md §6-7）的数据获取与
// 纯展示派生逻辑。只读——不封装 snooze/pin/acknowledge/watch 等状态 RPC，
// 那些留给校验通过后的下一阶段。
// ---------------------------------------------------------------------------

interface WorkItemRpcRow {
  work_key: string;
  group_key: string;
  type: WorkItemRow["type"];
  domain: WorkItemRow["domain"];
  kind: string;
  primary_object_type: WorkItemRow["primaryObjectType"];
  primary_object_id: string;
  primary_object_name: string;
  secondary_object_type: string | null;
  secondary_object_id: string | null;
  secondary_object_name: string | null;
  context: Json;
  responsibility: WorkItemRow["responsibility"];
  ownership_mode: WorkItemRow["ownershipMode"];
  available_at: string | null;
  due_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  urgency_bucket: WorkItemRow["urgencyBucket"];
  severity: WorkItemRow["severity"];
  escalation_level: number;
  resurface_at: string | null;
  reason_codes: string[];
  action_code: string | null;
  can_act: boolean;
  context_lens: WorkItemRow["contextLens"];
  route_target: string;
  route_params: Json;
  last_seen_at: string | null;
  snoozed_until: string | null;
  pinned_at: string | null;
  acknowledged_at: string | null;
  watching: boolean;
}

/** 统一工作项列表（P4I-6 RPC）；RPC 内部已按 doc19 §6.4 顺序排序，这里只做 snake→camel 映射。 */
export async function listMyWorkItems(): Promise<WorkItemRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_work_items");
  if (error) throw new Error(error.message);
  return ((data ?? []) as WorkItemRpcRow[]).map((row): WorkItemRow => ({
    workKey: row.work_key,
    groupKey: row.group_key,
    type: row.type,
    domain: row.domain,
    kind: row.kind,
    primaryObjectType: row.primary_object_type,
    primaryObjectId: row.primary_object_id,
    primaryObjectName: row.primary_object_name,
    secondaryObjectType: row.secondary_object_type ?? undefined,
    secondaryObjectId: row.secondary_object_id ?? undefined,
    secondaryObjectName: row.secondary_object_name ?? undefined,
    context: row.context,
    responsibility: row.responsibility,
    ownershipMode: row.ownership_mode,
    availableAt: row.available_at ?? undefined,
    dueAt: row.due_at ?? undefined,
    scheduledAt: row.scheduled_at ?? undefined,
    createdAt: row.created_at,
    urgencyBucket: row.urgency_bucket,
    severity: row.severity,
    escalationLevel: row.escalation_level,
    resurfaceAt: row.resurface_at ?? undefined,
    reasonCodes: row.reason_codes,
    actionCode: row.action_code ?? undefined,
    canAct: row.can_act,
    contextLens: row.context_lens,
    routeTarget: row.route_target,
    routeParams: row.route_params,
    lastSeenAt: row.last_seen_at ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    pinnedAt: row.pinned_at ?? undefined,
    acknowledgedAt: row.acknowledged_at ?? undefined,
    watching: row.watching,
  }));
}

function jsonField(value: Json, key: string): Json | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value[key];
  return undefined;
}

function jsonString(value: Json, key: string): string | undefined {
  const field = jsonField(value, key);
  return typeof field === "string" ? field : undefined;
}

function jsonNumber(value: Json, key: string): number | undefined {
  const field = jsonField(value, key);
  return typeof field === "number" ? field : undefined;
}

/**
 * 过渡期路由解析（判断点 5）：doc19 P4I-9~14 的 canonical 工作区路由还不存在，
 * 落到已有的过渡路由。P4I-9 起随各工作区上线逐个替换。
 */
export function resolveWorkItemHref(item: WorkItemRow): string {
  switch (item.primaryObjectType) {
    case "lecture": {
      const track = jsonString(item.routeParams, "track") ?? "native-16x9";
      return `/dashboard/curriculum/lectures/${item.primaryObjectId}?track=${track}`;
    }
    case "classroom":
      return `/dashboard/classes/${item.primaryObjectId}`;
    case "session":
      return `/dashboard/sessions/${item.primaryObjectId}`;
    case "student":
      return `/dashboard/students/${item.primaryObjectId}`;
    case "course_family":
    case "course_variant":
      return `/dashboard/courses/${item.primaryObjectId}`;
    case "refund":
    case "order":
      return "/dashboard/finance";
    case "activity":
      return "/dashboard/activities";
    default:
      break;
  }
  if (item.secondaryObjectType === "classroom" && item.secondaryObjectId) {
    return `/dashboard/classes/${item.secondaryObjectId}`;
  }
  return "/dashboard/work";
}

function relativeTime(iso: string | undefined, locale: string, now: Date): string | null {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  return rtf.format(Math.round(diffMs / day), "day");
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** "优先原因"（doc19 §6.4）：11 个 kind 全覆盖，不 fallback 到裸 reasonCodes。 */
export function formatWorkItemReason(
  item: WorkItemRow,
  t: Translate,
  tSupportKind: Translate,
  locale: string,
  now: Date,
): string {
  const withTime = (label: string, iso: string | undefined) => {
    const time = relativeTime(iso, locale, now);
    return time ? t("reasonWithTime", { label, time }) : label;
  };

  switch (item.kind) {
    case "review.fix":
      return t("reasonReviewFix", { round: jsonNumber(item.context, "round") ?? 1 });
    case "review.approve":
      return t("reasonReviewApprove", { round: jsonNumber(item.context, "round") ?? 1 });
    case "review.publish":
      return t("reasonReviewPublish");
    case "session.prepare": {
      const status = jsonString(item.context, "prepStatus") ?? "not_started";
      return withTime(t(`prepStatus_${status}`), item.dueAt ?? item.scheduledAt);
    }
    case "session.task": {
      const kind = jsonString(item.context, "taskKind") ?? "";
      return withTime(t(`taskKind_${kind}`), item.dueAt ?? item.scheduledAt);
    }
    case "support.task": {
      const kind = jsonString(item.context, "taskKind") ?? "";
      return t("reasonSupportTask", { label: tSupportKind(`supportTaskKind_${kind}`) });
    }
    case "leave_request.decide":
      return t("reasonLeaveRequest");
    case "student.followup":
      return withTime(t("reasonFollowupDueLabel"), item.dueAt);
    case "refund.approve":
      return t("reasonRefundApprove");
    case "classroom.no_primary_teacher":
      return t("reasonNoPrimaryTeacher");
    case "session.overdue_not_started":
      return withTime(t("reasonOverdueNotStartedLabel"), item.scheduledAt);
    default:
      return item.kind;
  }
}

/** doc19 §6.5：direct/delegated 归"我的工作"，oversight 归"需要关注"。 */
export function partitionByOwnership(items: readonly WorkItemRow[]) {
  return {
    mine: items.filter((item) => item.ownershipMode !== "oversight"),
    oversight: items.filter((item) => item.ownershipMode === "oversight"),
  };
}

/**
 * "现在"分区（doc19 §6.2）：按 groupKey 聚合，取首次出现顺序里"即将发生"
 * 事项的前 N 组，组内全部事项一起展示（不是排他视图，同一事项仍会出现在
 * "我的工作"/"需要关注"里）。
 *
 * 判定不能用 `severity==='critical'`：`classify_work_item_urgency` 把"逾期
 * 超过 2 小时"的行也标成 critical（老化升级信号，不是"正在发生"信号），
 * 真实试用数据里一个 10 天前就该备课的课次会因此常驻"现在"，跟"最多显示
 * 3 个对象工作组"的即时性设计意图相反。改用 `overdue 桶 + severity==='high'`
 * ——按 classify 的判定顺序，这精确对应"刚过点 0~2 小时内"的新鲜逾期
 * （课大概率正在进行/刚结束），超过 2 小时会自动被上面的 critical 分支接管，
 * 从而自然退出这里。
 */
export function selectSpotlightGroups(items: readonly WorkItemRow[], maxGroups = 3): WorkItemRow[][] {
  const order: string[] = [];
  const byGroup = new Map<string, WorkItemRow[]>();
  for (const item of items) {
    let list = byGroup.get(item.groupKey);
    if (!list) {
      list = [];
      byGroup.set(item.groupKey, list);
      order.push(item.groupKey);
    }
    list.push(item);
  }
  const isSpotlight = (item: WorkItemRow) => item.urgencyBucket === "now" || (item.urgencyBucket === "overdue" && item.severity === "high");
  const qualifying = order.filter((key) => byGroup.get(key)!.some(isSpotlight));
  return qualifying.slice(0, maxGroups).map((key) => byGroup.get(key)!);
}

export interface TodayScheduleEntry {
  groupKey: string;
  primaryObjectName: string;
  secondaryObjectName?: string;
  scheduledAt: string;
  href: string;
}

/**
 * "今天的安排"（doc19 §6.2）：不是任务卡片，是当天时间条目，按 groupKey
 * 去重（同一对象的备课/课后任务共享一个 groupKey，只取一行），避免和
 * "我的工作"里同一对象的任务卡片重复展示。
 */
export function selectTodaySchedule(items: readonly WorkItemRow[], now: Date): TodayScheduleEntry[] {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const byGroup = new Map<string, WorkItemRow>();
  for (const item of items) {
    if (!item.scheduledAt) continue;
    const scheduledMs = new Date(item.scheduledAt).getTime();
    if (scheduledMs < dayStart.getTime() || scheduledMs >= dayEnd.getTime()) continue;
    const existing = byGroup.get(item.groupKey);
    if (!existing || scheduledMs < new Date(existing.scheduledAt!).getTime()) {
      byGroup.set(item.groupKey, item);
    }
  }
  return Array.from(byGroup.values())
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
    .map((item) => ({
      groupKey: item.groupKey,
      primaryObjectName: item.primaryObjectName,
      secondaryObjectName: item.secondaryObjectName,
      scheduledAt: item.scheduledAt!,
      href: resolveWorkItemHref(item),
    }));
}
