import "server-only";
import { createClient } from "@/lib/supabase/server";
import { studentStageRpc } from "./student-stage-data";
import { leadBoardSchema } from "./lead-board-contract";

export async function readLeadBoard(unitId: string | null) {
  return leadBoardSchema.parse(await studentStageRpc(await createClient(), "get_school_lead_board", { p_unit: unitId }));
}
