import "server-only";
import { createClient } from "@/lib/supabase/server";
import { studentStageRpc } from "./student-stage-data";
import { leadBoardSchema, type LeadGrain } from "./lead-board-contract";

export async function readLeadBoard(unitId: string | null, grain: LeadGrain = "week", anchor: string | null = null) {
  return leadBoardSchema.parse(await studentStageRpc(await createClient(), "get_school_lead_board", { p_unit: unitId, p_grain: grain, p_anchor: anchor }));
}
