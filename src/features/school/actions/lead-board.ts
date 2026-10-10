"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { actionError, type ActionResult } from "@/lib/action-result";
import { studentStageRpc } from "../student-stage-data";
import { LEAD_LANES, leadBoardSchema, leadRuleConfigSchema, leadSubjectSchema, type LeadBoard, type LeadSubject } from "../lead-board-contract";
import { parse, uuid } from "./schemas";

const subjectInput = z.object({ unitId: uuid, key: z.string().regex(/^(student|lead):[0-9a-f-]{36}$/) });
export async function readLeadSubjectAction(input: z.infer<typeof subjectInput>): Promise<ActionResult<LeadSubject>> {
  try {
    const value = parse(subjectInput, input);
    const data = await studentStageRpc(await createClient(), "get_school_lead_board_subject", { p_unit: value.unitId, p_key: value.key });
    return { ok: true, data: leadSubjectSchema.parse(data) };
  } catch (error) {
    return actionError(error, ["VALIDATION", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"]);
  }
}

const rulesInput = z.object({ unitId: uuid, lane: z.enum(LEAD_LANES), config: leadRuleConfigSchema.nullable() });
export async function saveLeadRulesAction(input: z.infer<typeof rulesInput>): Promise<ActionResult<LeadBoard>> {
  try {
    const value = parse(rulesInput, input);
    const data = await studentStageRpc(await createClient(), "save_school_lead_board_rules", { p_unit: value.unitId, p_lane: value.lane, p_config: value.config });
    return { ok: true, data: leadBoardSchema.parse(data) };
  } catch (error) {
    return actionError(error, ["VALIDATION", "UNAUTHENTICATED", "FORBIDDEN"]);
  }
}
