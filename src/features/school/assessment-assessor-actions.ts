"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import { COMMON_CODES, parse, uuid } from "./actions/schemas";

const reassignAssessmentAssessorSchema = z.object({
  invitationId: uuid,
  assessorId: uuid,
});

export async function reassignAssessmentAssessorAction(
  invitationId: string,
  assessorId: string,
): Promise<ActionResult> {
  try {
    const value = parse(reassignAssessmentAssessorSchema, { invitationId, assessorId });
    const { supabase } = await authorizedClient("followup.write");
    const result = await supabase.rpc("reassign_assessment_assessor", {
      p_invitation_id: value.invitationId,
      p_assessor_id: value.assessorId,
    });
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "ASSESSMENT_ALREADY_COMPLETED",
      "ASSESSOR_UNAVAILABLE",
      "INVALID_INVITATION",
      "INVITATION_CLOSED",
      "FORBIDDEN_SCOPE",
      "NOT_FOUND",
      ...COMMON_CODES,
    ]);
  }
}
