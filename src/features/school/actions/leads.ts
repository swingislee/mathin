"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient, nullableRpcArg } from "./guards";
import { COMMON_CODES, datetime, parse, text, uuid } from "./schemas";

const LEAD_CONTACT_OUTCOMES = ["unreachable", "connected", "declined", "invalid_number"] as const;
const LEAD_INTEREST_LEVELS = ["A", "B", "C"] as const;

const assignLeadsSchema = z.object({
  leadIds: z.array(uuid).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
  staffUserId: uuid,
});

const leadContactSchema = z.object({
  leadId: uuid,
  outcome: z.enum(LEAD_CONTACT_OUTCOMES),
  note: text(2000),
  wechatAdded: z.boolean().nullable(),
  visitCommitted: z.boolean().nullable(),
  interestLevel: z.enum(LEAD_INTEREST_LEVELS).nullable(),
  nextActionAt: datetime.nullable(),
}).superRefine((value, context) => {
  if (["unreachable", "invalid_number"].includes(value.outcome)
      && (value.wechatAdded === true || value.visitCommitted === true)) {
    context.addIssue({ code: "custom", message: "INVALID_CONTACT_FACT" });
  }
  if (value.outcome === "invalid_number" && value.nextActionAt !== null) {
    context.addIssue({ code: "custom", message: "INVALID_NEXT_ACTION" });
  }
});

export type LeadContactInput = {
  outcome: (typeof LEAD_CONTACT_OUTCOMES)[number];
  note: string;
  wechatAdded: boolean | null;
  visitCommitted: boolean | null;
  interestLevel: (typeof LEAD_INTEREST_LEVELS)[number] | null;
  nextActionAt: string | null;
};

export async function assignLeadsAction(leadIds: string[], staffUserId: string): Promise<ActionResult<{ count: number }>> {
  try {
    const value = parse(assignLeadsSchema, { leadIds, staffUserId });
    const { supabase } = await authorizedClient("student.assign");
    const { data, error } = await supabase.rpc("assign_leads", {
      p_lead_ids: value.leadIds,
      p_staff_user_id: value.staffUserId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { count: Number(data ?? value.leadIds.length) } };
  } catch (error) {
    return actionError(error, ["TARGET_CANNOT_FOLLOW_UP", "LEAD_SCOPE_MISMATCH", ...COMMON_CODES]);
  }
}

export async function recordLeadContactAction(
  leadId: string,
  input: LeadContactInput,
): Promise<ActionResult> {
  try {
    const value = parse(leadContactSchema, { leadId, ...input });
    const { supabase } = await authorizedClient("followup.write");
    const { error } = await supabase.rpc("record_lead_contact", {
      p_lead_id: value.leadId,
      p_outcome: value.outcome,
      p_note: value.note,
      p_wechat_added: nullableRpcArg(value.wechatAdded),
      p_visit_committed: nullableRpcArg(value.visitCommitted),
      p_interest_level: nullableRpcArg(value.interestLevel),
      p_next_action_at: nullableRpcArg(value.nextActionAt),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "NEXT_ACTION_NOT_FUTURE",
      "LEAD_UNASSIGNED",
      "LEAD_CLOSED",
      "FORBIDDEN_SCOPE",
      "NOT_FOUND",
      ...COMMON_CODES,
    ]);
  }
}
