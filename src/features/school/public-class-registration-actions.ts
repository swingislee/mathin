"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { parse, uuid } from "./actions/schemas";
import { enrollmentWorkflowRpc } from "./enrollment-workflow-data";
import { loadPublicClassRegistration } from "./public-class-registration-data";
import { publicClassRecordDraftSchema, type PublicClassRegistrationData } from "./public-class-registration-contract";

const bundleSchema = z.object({
  activityId: uuid, registrationId: uuid,
  records: z.array(publicClassRecordDraftSchema).min(1).max(24),
}).strict().refine((value) => new Set(value.records.map((record) => record.segmentId)).size === value.records.length);
const codes = ["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION", "PUBLIC_CLASS_NOT_FOUND", "PUBLIC_CLASS_RECORD_NOT_FOUND", "PUBLIC_CLASS_RECORD_CHANGED", "INVALID_PUBLIC_CLASS_RECORD"] as const;

export async function getPublicClassRegistrationAction(activityId: string): Promise<ActionResult<PublicClassRegistrationData>> {
  try { return { ok: true, data: await loadPublicClassRegistration(parse(uuid, activityId)) }; }
  catch (error) { return actionError(error, codes); }
}
export async function savePublicClassRegistrationBundleAction(input: z.input<typeof bundleSchema>): Promise<ActionResult<PublicClassRegistrationData>> {
  try {
    const value = parse(bundleSchema, input);
    await enrollmentWorkflowRpc("save_public_class_registration_bundle", {
      p_activity_id: value.activityId, p_registration_id: value.registrationId, p_records: value.records,
    });
    revalidatePath("/[locale]/dashboard/activities", "layout");
    revalidatePath("/[locale]/dashboard/invitations", "page");
    return { ok: true, data: await loadPublicClassRegistration(value.activityId) };
  } catch (error) { return actionError(error, codes); }
}
