import type { Json } from "@/lib/database.types";

/**
 * 统一工作项契约（docs/plan/19-p4i-final.md §7.2）。数据来自
 * `public.list_my_work_items` RPC（P4I-6，snake_case 列），本文件是
 * TS 侧的 camelCase 镜像；snake→camel 的实际映射留给 P4I-8 的数据获取层。
 */

export type WorkItemType = "action" | "alert";

export type WorkItemDomain =
  | "curriculum"
  | "teaching"
  | "student_service"
  | "finance"
  | "operations";

export type WorkItemObjectType =
  | "course_family"
  | "course_variant"
  | "lecture"
  | "classroom"
  | "session"
  | "student"
  | "order"
  | "refund"
  | "activity";

export type WorkItemResponsibility =
  | "explicit_assignee"
  | "object_owner"
  | "object_editor"
  | "reviewer"
  | "primary_teacher"
  | "assistant_teacher"
  | "learning_support"
  | "student_owner"
  | "approver"
  | "manager_oversight";

export type WorkItemOwnershipMode = "direct" | "delegated" | "oversight";

export type WorkItemUrgencyBucket = "now" | "overdue" | "today" | "upcoming" | "backlog";

export type WorkItemSeverity = "critical" | "high" | "normal" | "low";

export type WorkItemContextLens =
  | "production"
  | "teaching"
  | "management"
  | "support"
  | "family"
  | "learning";

export interface WorkItemRow {
  workKey: string;
  groupKey: string;

  type: WorkItemType;
  domain: WorkItemDomain;
  kind: string;

  primaryObjectType: WorkItemObjectType;
  primaryObjectId: string;
  primaryObjectName: string;

  secondaryObjectType?: string;
  secondaryObjectId?: string;
  secondaryObjectName?: string;

  context: Json;

  responsibility: WorkItemResponsibility;
  ownershipMode: WorkItemOwnershipMode;

  availableAt?: string;
  dueAt?: string;
  scheduledAt?: string;
  createdAt: string;

  urgencyBucket: WorkItemUrgencyBucket;
  severity: WorkItemSeverity;

  escalationLevel: number;
  resurfaceAt?: string;
  reasonCodes: string[];

  actionCode?: string;
  canAct: boolean;

  contextLens: WorkItemContextLens;

  routeTarget: string;
  routeParams: Json;

  /** work_item_user_state 左连接结果（P4I-6），未写过状态时全部为 null/false。 */
  lastSeenAt?: string;
  snoozedUntil?: string;
  pinnedAt?: string;
  acknowledgedAt?: string;
  watching: boolean;
}

/** doc19 §6.4：桶的固定展示顺序,由高到低。 */
export const WORK_ITEM_URGENCY_ORDER: readonly WorkItemUrgencyBucket[] = [
  "now",
  "overdue",
  "today",
  "upcoming",
  "backlog",
];
