"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parse, text, uuid } from "./actions/schemas";
import { ASSESSMENT_PARENT_CLASSIFICATIONS, ASSESSMENT_PARENT_REASONS, ASSESSMENT_STAGES,
  assessmentWorkflowDbSchema, type AssessmentWorkflow, type AssessmentWorkflowCommand, type AssessmentWorkflowEvent } from "./assessment-workflow-contract";
import { readAssessmentWorkflow } from "./assessment-workflow-data";

const commandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("visit"), values: z.object({ stage: z.enum(ASSESSMENT_STAGES) }).strict() }),
  z.object({ command: z.literal("report"), values: z.object({}).strict() }),
  z.object({ command: z.literal("revise"), values: z.object({ reason: text(500).refine((value) => Boolean(value.trim())) }).strict() }),
  z.object({ command: z.literal("classify"), values: z.object({ classification: z.enum(ASSESSMENT_PARENT_CLASSIFICATIONS).nullable(),
    parentResponse: text(2000), reasons: z.array(z.enum(ASSESSMENT_PARENT_REASONS)).max(5), nextContactAt: z.string().datetime().nullable(),
    trialIntent: z.boolean().optional(), sharedReportId: uuid.nullable().optional(),
  }).strict() }),
]);
const sourceSchema = z.object({ registrationId: uuid.nullable(), invitationId: uuid.nullable(), expectedRevision: z.number().int().nonnegative() })
  .refine((value) => [value.registrationId, value.invitationId].filter(Boolean).length === 1);
const ERRORS = ["ASSESSMENT_WORKFLOW_CONFLICT", "ASSESSMENT_WORKFLOW_FINALIZED", "ASSESSMENT_REPORT_NOT_READY", "PARTICIPATION_UNAVAILABLE",
  "ASSESSMENT_NAVIGATION_READ_ONLY", "INVITATION_NOT_CONFIRMED", "HISTORICAL_RECORD_READ_ONLY", "FORBIDDEN_SCOPE", "FORBIDDEN", "UNAUTHENTICATED", "VALIDATION"] as const;

async function authorizedClient(write = false) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const perms = await getMyPerms(user.id);
  if (!perms.has("review.write") && !perms.has(write ? "followup.write" : "followup.view")) throw new Error("FORBIDDEN");
  return supabase;
}

export async function saveAssessmentWorkflowAction(input: {
  registrationId: string | null; invitationId: string | null; expectedRevision: number;
} & AssessmentWorkflowCommand): Promise<ActionResult<{
  registrationId: string; activityId: string; participationStatus: "booked" | "attended" | "no_show" | "cancelled"; workflow: AssessmentWorkflow;
}>> {
  try {
    const source = parse(sourceSchema, input);
    const command = parse(commandSchema, input);
    const supabase = await authorizedClient(true);
    if (command.command === "visit") throw new Error("ASSESSMENT_NAVIGATION_READ_ONLY");
    const { data, error } = await supabase.rpc("save_assessment_workflow", {
      p_registration_id: source.registrationId ?? undefined, p_invitation_id: source.invitationId ?? undefined,
      p_command: command.command, p_expected_revision: source.expectedRevision, p_values: command.values,
    });
    if (error) throw new Error(error.message);
    const saved = z.object({ registrationId: uuid, activityId: uuid, participationStatus: z.enum(["booked", "attended", "no_show", "cancelled"]) }).parse(data);
    const workflow = await readAssessmentWorkflow(saved.registrationId, supabase);
    if (!workflow) throw new Error("NOT_FOUND");
    return { ok: true, data: { ...saved, workflow } };
  } catch (error) { return actionError(error, [...ERRORS]); }
}

export async function getAssessmentWorkflowAction(registrationId: string): Promise<ActionResult<AssessmentWorkflow | null>> {
  try { return { ok: true, data: await readAssessmentWorkflow(parse(uuid, registrationId), await authorizedClient()) }; }
  catch (error) { return actionError(error, [...ERRORS]); }
}

export async function getAssessmentWorkflowHistoryAction(registrationId: string): Promise<ActionResult<AssessmentWorkflowEvent[]>> {
  try {
    const supabase = await authorizedClient();
    const { data, error } = await supabase.from("assessment_workflow_events")
      .select("id,action,recorded_at,saved_values,recorder:profiles!assessment_workflow_events_recorded_by_fkey(display_name)")
      .eq("registration_id", parse(uuid, registrationId)).order("recorded_at", { ascending: false }).order("id", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    return { ok: true, data: (data ?? []).map((event) => {
      const state = assessmentWorkflowDbSchema.parse(event.saved_values);
      return { id: event.id, action: event.action, recordedAt: event.recorded_at, recordedByName: event.recorder?.display_name ?? "",
        stage: state.stage, classification: state.classification, reason: state.revision_reason, reportId: state.report_id, sentReportId: state.sent_report_id,
        parentResponse: state.parent_response, trialIntent: state.trial_intent };
    }) };
  } catch (error) { return actionError(error, [...ERRORS]); }
}
