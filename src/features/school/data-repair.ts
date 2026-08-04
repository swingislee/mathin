import "server-only";

import { createClient } from "@/lib/supabase/server";

export type DataRepairRecoveryClass = "automatic_rollback" | "domain_rollback" | "backup_required";
export type DataRepairPlanStatus = "previewed" | "executed" | "rolled_back";

export interface DataRepairCapability {
  repairKey: string;
  version: number;
  domain: string;
  recoveryClass: DataRepairRecoveryClass;
  planManaged: boolean;
  entrypoint: string;
  definitionHash: string;
}

// 财务关闭期间（或调用者无 finance.order.view 时）服务端会裁剪金额字段并置
// `amountsRedacted`，投影里只剩审计元数据与状态迁移，因此金额一律是可选的。
export interface OrderStatusRepairSnapshot {
  orderId: string;
  amountOriginal?: number;
  amountDiscount?: number;
  amountDue?: number;
  expectedDue?: number;
  paidTotal?: number;
  refundedTotal?: number;
  netPaid?: number;
  amountsRedacted?: boolean;
  hasPendingRefund: boolean;
  status: string;
  expectedStatus: string;
  dueMatches: boolean;
}

export interface DataRepairEvent {
  id: string;
  eventType: DataRepairPlanStatus;
  actorId: string;
  beforeHash: string;
  afterHash: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface DataRepairPlan {
  id: string;
  repairKey: "order_status_recompute";
  repairVersion: number;
  sourceRunId: string;
  sourceFindingId: string;
  targetObjectType: "order";
  targetObjectId: string;
  impactCount: number;
  targetHash: string;
  expectedAfterHash: string;
  recoverySnapshot: OrderStatusRepairSnapshot;
  expectedAfterSnapshot: OrderStatusRepairSnapshot;
  status: DataRepairPlanStatus;
  afterSnapshot: OrderStatusRepairSnapshot | null;
  afterHash: string | null;
  rollbackHash: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  executedBy: string | null;
  executedAt: string | null;
  rolledBackBy: string | null;
  rolledBackAt: string | null;
  events: DataRepairEvent[];
}

export async function listDataRepairCapabilities(): Promise<DataRepairCapability[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_data_repair_capabilities");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DataRepairCapability[];
}

export async function listDataRepairPlans(): Promise<DataRepairPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_data_repair_plans");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DataRepairPlan[];
}
