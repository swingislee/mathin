import { z } from "zod";
import { STORED_ASSESSMENT_BANDS } from "./activity-workflow-contract";

export const ASSESSMENT_STAGES = ["pending", "in_progress", "feedback", "handled"] as const;
export type AssessmentStage = (typeof ASSESSMENT_STAGES)[number];
export const ASSESSMENT_PARENT_CLASSIFICATIONS = ["awaiting_reply", "considering", "ready_to_enroll", "awaiting_class", "not_enrolling"] as const;
export const ASSESSMENT_PARENT_REASONS = ["price", "schedule", "distance", "child_preference", "other"] as const;

export const assessmentReportPayloadSchema = z.object({
  schemaVersion: z.literal(1), name: z.string(), grade: z.number().nullable(), gradeText: z.string(), activityTitle: z.string(),
  assessedAt: z.string(), resultSource: z.enum(["legacy", "quick_entry", "teacher", "activity"]), recordedByName: z.string(),
  score: z.number().nullable(), totalScore: z.number().nullable(), assessmentBand: z.enum(STORED_ASSESSMENT_BANDS).nullable(),
  strengths: z.string(), focusAreas: z.string(), teacherObservation: z.string(), recommendation: z.string(), recommendedClass: z.string(),
});
export const assessmentReportSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), payload: assessmentReportPayloadSchema,
  created_at: z.string(),
});
export type AssessmentReport = z.infer<typeof assessmentReportSchema>;

export const assessmentWorkflowDbSchema = z.object({
  id: z.string().uuid(), registration_id: z.string().uuid(), stage: z.enum(ASSESSMENT_STAGES), revision: z.number().int().positive(),
  arrived_at: z.string().nullable(), report_id: z.string().uuid().nullable(), sent_report_id: z.string().uuid().nullable(),
  sent_at: z.string().nullable(), sent_by: z.string().uuid().nullable(),
  classification: z.enum(ASSESSMENT_PARENT_CLASSIFICATIONS).nullable(), parent_response: z.string(),
  reasons: z.array(z.enum(ASSESSMENT_PARENT_REASONS)), next_contact_at: z.string().nullable(),
  finalized_at: z.string().nullable(), revision_reason: z.string(), updated_by: z.string().uuid(), updated_at: z.string(),
  recorder: z.object({ display_name: z.string() }).nullable().optional(),
  sender: z.object({ display_name: z.string() }).nullable().optional(),
  report: assessmentReportSchema.nullable().optional(),
});
export type AssessmentWorkflowDbRow = z.infer<typeof assessmentWorkflowDbSchema>;
export function assessmentWorkflowFromDb(value: unknown) {
  const row = assessmentWorkflowDbSchema.parse(value);
  return {
    id: row.id, registrationId: row.registration_id, stage: row.stage, revision: row.revision,
    arrivedAt: row.arrived_at, report: row.report ?? null, sentReportId: row.sent_report_id,
    sentAt: row.sent_at, sentByName: row.sender?.display_name ?? "",
    classification: row.classification, parentResponse: row.parent_response, reasons: row.reasons, nextContactAt: row.next_contact_at,
    finalizedAt: row.finalized_at, revisionReason: row.revision_reason, updatedAt: row.updated_at,
    updatedByName: row.recorder?.display_name ?? "",
  };
}
export type AssessmentWorkflow = ReturnType<typeof assessmentWorkflowFromDb>;
export type AssessmentClassificationValues = {
  classification: (typeof ASSESSMENT_PARENT_CLASSIFICATIONS)[number]; parentResponse: string;
  reasons: (typeof ASSESSMENT_PARENT_REASONS)[number][]; nextContactAt: string | null;
};
export type AssessmentWorkflowCommand = { command: "visit"; values: { stage: AssessmentStage } }
  | { command: "report"; values: Record<string, never> }
  | { command: "classify"; values: AssessmentClassificationValues }
  | { command: "revise"; values: { reason: string } };

/** 发送事实绑定具体报告版本；导出、旧报告发送记录均不等于当前版已发送。 */
export function currentAssessmentReportWasSent(workflow: AssessmentWorkflow | null | undefined): boolean {
  return Boolean(workflow?.report && workflow.sentAt && workflow.sentReportId === workflow.report.id);
}

/** 已归类和只读身份点击仅浏览；服务端再以同一规则保护旧客户端。 */
export function assessmentStageClickWrites(workflow: AssessmentWorkflow | null | undefined, canWrite: boolean): boolean {
  return canWrite && !workflow?.finalizedAt;
}

export interface AssessmentWorkflowEvent {
  id: string; action: string; recordedAt: string; recordedByName: string;
  stage: AssessmentStage; classification: AssessmentWorkflow["classification"]; reason: string;
  reportId: string | null; sentReportId: string | null;
  parentResponse: string;
}
