"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { readAssessmentReferencePolicy, referenceRpc } from "./data";
import { referencePolicySchema, type AssessmentReferencePolicy } from "./contract";
import { parse } from "../actions/schemas";

const errors = ["UNAUTHENTICATED", "FORBIDDEN", "CONFLICT", "VALIDATION"];
export async function loadReferencePolicyAction(): Promise<ActionResult<AssessmentReferencePolicy>> {
  try { return { ok: true, data: await readAssessmentReferencePolicy() }; }
  catch (error) { return actionError(error, errors); }
}

export async function saveReferencePolicyAction(input: { validityMonths: number; expectedUpdatedAt: string }): Promise<ActionResult<AssessmentReferencePolicy>> {
  try {
    const value = parse(z.object({ validityMonths: z.number().int().min(1).max(36), expectedUpdatedAt: z.iso.datetime({ offset: true }) }).strict(), input);
    const data = referencePolicySchema.parse(await referenceRpc(await createClient(), "save_assessment_reference_policy", {
      p_validity_months: value.validityMonths, p_expected_updated_at: value.expectedUpdatedAt,
    }));
    revalidatePath("/[locale]/dashboard/assessments", "layout");
    return { ok: true, data };
  } catch (error) { return actionError(error, errors); }
}
