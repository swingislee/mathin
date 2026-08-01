"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { DataRepairPlan } from "../data-repair";
import { authorizedClient } from "./guards";
import { COMMON_CODES, parse, uuid } from "./schemas";

const findingSchema = z.object({ findingId: uuid });
const planSchema = z.object({ planId: uuid });
const repairCodes = [
  ...COMMON_CODES,
  "QUALITY_FINDING_NOT_FOUND",
  "REPAIR_NOT_APPLICABLE",
  "REPAIR_TARGET_NOT_FOUND",
  "REPAIR_PLAN_NOT_FOUND",
  "REPAIR_PLAN_STATE_CONFLICT",
  "REPAIR_PLAN_EXPIRED",
  "REPAIR_TARGET_CHANGED",
  "REPAIR_POSTCONDITION_FAILED",
  "REPAIR_ROLLBACK_POSTCONDITION_FAILED",
] as const;

function refreshMaintenancePage() {
  revalidatePath("/[locale]/dashboard/data-maintenance", "page");
}

export async function previewOrderStatusRepairAction(findingId: string): Promise<ActionResult<DataRepairPlan>> {
  try {
    const input = parse(findingSchema, { findingId });
    const { supabase } = await authorizedClient("system.operations.manage");
    const { data, error } = await supabase.rpc("preview_order_status_repair", { p_finding_id: input.findingId });
    if (error || !data) throw new Error(error?.message || "REPAIR_PREVIEW_FAILED");
    refreshMaintenancePage();
    return { ok: true, data: data as unknown as DataRepairPlan };
  } catch (error) {
    return actionError<DataRepairPlan>(error, repairCodes, "REPAIR_PREVIEW_FAILED");
  }
}

export async function executeDataRepairPlanAction(planId: string): Promise<ActionResult<DataRepairPlan>> {
  try {
    const input = parse(planSchema, { planId });
    const { supabase } = await authorizedClient("system.operations.manage");
    const { data, error } = await supabase.rpc("execute_data_repair_plan", { p_plan_id: input.planId });
    if (error || !data) throw new Error(error?.message || "REPAIR_EXECUTION_FAILED");
    refreshMaintenancePage();
    return { ok: true, data: data as unknown as DataRepairPlan };
  } catch (error) {
    return actionError<DataRepairPlan>(error, repairCodes, "REPAIR_EXECUTION_FAILED");
  }
}

export async function rollbackDataRepairPlanAction(planId: string): Promise<ActionResult<DataRepairPlan>> {
  try {
    const input = parse(planSchema, { planId });
    const { supabase } = await authorizedClient("system.operations.manage");
    const { data, error } = await supabase.rpc("rollback_data_repair_plan", { p_plan_id: input.planId });
    if (error || !data) throw new Error(error?.message || "REPAIR_ROLLBACK_FAILED");
    refreshMaintenancePage();
    return { ok: true, data: data as unknown as DataRepairPlan };
  } catch (error) {
    return actionError<DataRepairPlan>(error, repairCodes, "REPAIR_ROLLBACK_FAILED");
  }
}
