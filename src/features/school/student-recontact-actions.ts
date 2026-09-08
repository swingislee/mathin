"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import { COMMON_CODES, dateOnly, parse, requiredText, uuid } from "./actions/schemas";
import { communicationDayBounds } from "./communication-workday-contract";
import { studentStageRpc } from "./student-stage-data";

const schema = z.object({
  id: uuid, name: requiredText(100), date: dateOnly.refine(value => { try { communicationDayBounds(value); return true; } catch { return false; } }), ownerId: uuid,
  subjects: z.array(z.object({ studentId: uuid.nullable(), leadId: uuid, expectedOwnerId: uuid.nullable() }).strict()).min(1).max(100),
}).strict();

export async function planStudentRecontactAction(input: z.input<typeof schema>): Promise<ActionResult<{ id: string }>> {
  try {
    const value = parse(schema, input);
    const { supabase } = await authorizedClient("followup.write");
    const id = parse(uuid, await studentStageRpc(supabase, "plan_student_recontact_worklist", {
      p_id: value.id, p_name: value.name, p_work_date: value.date, p_owner_id: value.ownerId, p_subjects: value.subjects,
    }));
    revalidatePath("/[locale]/dashboard/students", "page");
    revalidatePath("/[locale]/dashboard/followups", "layout");
    return { ok: true, data: { id } };
  } catch (error) {
    return actionError(error, [...COMMON_CODES, "ASSIGNMENT_CONFLICT", "RECONTACT_CHANGED", "TARGET_CANNOT_FOLLOW_UP", "REQUEST_CONFLICT", "FORBIDDEN_SCOPE", "SUBJECT_MISMATCH"]);
  }
}
