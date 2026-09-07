"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Database } from "@/lib/database.types";
import { authorizedClient } from "./actions/guards";
import { dateOnly, datetime, money, parse, text, uuid } from "./actions/schemas";
import { RENEWAL_CONTACT_METHODS, RENEWAL_PAYMENT_METHODS, RENEWAL_RESULTS, RENEWAL_SEASONS, type RenewalWorkbenchSaved } from "./renewal-workbench-contract";

const schema = z.object({
  cycleId: uuid, membershipId: uuid, expectedRevision: z.number().int().nonnegative(),
  result: z.enum(RENEWAL_RESULTS), note: text(2000), contactMethod: z.enum(RENEWAL_CONTACT_METHODS).nullable(),
  seasons: z.array(z.enum(RENEWAL_SEASONS)).max(4).refine(values => new Set(values).size === values.length),
  nextContactAt: datetime.nullable(), periodCount: z.number().int().min(1).max(24).nullable(),
  paidAmount: money.positive().multipleOf(0.01).nullable(),
  paidOn: dateOnly.refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value).nullable(),
  paymentMethod: z.enum(RENEWAL_PAYMENT_METHODS).nullable(),
}).refine(value => value.result === "paid"
  ? value.periodCount !== null && value.paidAmount !== null && value.paidOn !== null && value.paymentMethod !== null
  : value.periodCount === null && value.paidAmount === null && value.paidOn === null && value.paymentMethod === null);

export async function saveRenewalWorkbenchAction(input: z.input<typeof schema>): Promise<ActionResult<RenewalWorkbenchSaved>> {
  try {
    const value = parse(schema, input);
    const { supabase } = await authorizedClient("followup.write");
    type RpcArgs = Database["public"]["Functions"]["save_renewal_workbench_v1"]["Args"];
    const args = {
      p_cycle_id: value.cycleId, p_membership_id: value.membershipId, p_expected_revision: value.expectedRevision,
      p_result: value.result, p_note: value.note, p_contact_method: value.contactMethod,
      p_seasons: value.seasons, p_next_contact_at: value.nextContactAt,
      p_period_count: value.periodCount, p_paid_amount: value.paidAmount,
      p_paid_on: value.paidOn, p_payment_method: value.paymentMethod,
    } satisfies { [Key in keyof RpcArgs]: RpcArgs[Key] | null };
    // 生成器将函数参数标为非空；SQL 接受显式 NULL，并用它区分未登记与清除。
    const { data, error } = await supabase.rpc("save_renewal_workbench_v1", args as RpcArgs);
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard/followups/renewals", "layout");
    revalidatePath("/[locale]/dashboard/followups/enrollments", "page");
    return { ok: true, data: data as unknown as RenewalWorkbenchSaved };
  } catch (error) {
    return actionError(error, ["VALIDATION", "UNAUTHENTICATED", "FORBIDDEN_SCOPE", "FORBIDDEN_OWNER_ASSIGNMENT", "FORBIDDEN",
      "RENEWAL_WORKBENCH_CONFLICT", "INVALID_CYCLE_STATE", "OPPORTUNITY_ENROLLED", "COURSE_REQUIRED",
      "OWNER_NOT_AVAILABLE", "ALREADY_ENROLLED_FOR_COURSE", "ENROLLMENT_CANCELLED"]);
  }
}
