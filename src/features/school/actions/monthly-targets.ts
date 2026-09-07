"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { monthlyTargetPlan } from "../home/monthly-targets-data";
import type { MonthlyTargetCell, MonthlyTargetPlan } from "../home/monthly-targets-contract";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, intInRange, parse, requiredText } from "./schemas";

const inputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  revision: intInRange(1, 2147483647),
  cells: z.array(z.object({ teacher: requiredText(80), grade: requiredText(80), target: intInRange(0, 9999).nullable() })).min(1).max(480),
  arrivalTarget: intInRange(0, 1000000).nullable(),
  invitationTarget: intInRange(0, 1000000).nullable(),
});

export async function saveMonthlyTargetsAction(input: {
  month: string; revision: number; cells: MonthlyTargetCell[]; arrivalTarget: number | null; invitationTarget: number | null;
}): Promise<ActionResult<MonthlyTargetPlan>> {
  try {
    const value = parse(inputSchema, input);
    const { supabase } = await authorizedClient("organization.settings.manage");
    const { data, error } = await supabase.rpc("save_school_monthly_targets", {
      p_month: `${value.month}-01`, p_revision: value.revision, p_targets: value.cells,
      p_arrival_target: nullableRpcArg(value.arrivalTarget), p_invitation_target: nullableRpcArg(value.invitationTarget),
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("NOT_FOUND");
    return { ok: true, data: monthlyTargetPlan(data) };
  } catch (error) {
    return actionError<MonthlyTargetPlan>(error, [...COMMON_CODES, "NOT_FOUND", "VERSION_CONFLICT"]);
  }
}
