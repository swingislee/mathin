import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { STUDENT_RECONTACT_REASONS, STUDENT_STAGE_TABS, type StudentStageData, type StudentStageFilters, type StudentStageRow, type StudentStageSaved } from "./student-stage-contract";
import { INVITATION_KINDS, INVITATION_STATES } from "./invitation-contract";

export const studentStageRowSchema = z.object({
  key: z.string(), studentId: z.string().nullable(), leadId: z.string().nullable(), name: z.string(), phone: z.string(),
  grade: z.number().nullable(), gradeText: z.string(), ownerId: z.string().nullable(), ownerName: z.string(),
  teacherId: z.string().nullable().optional(), teacherName: z.string().optional(),
  stage: z.enum(STUDENT_STAGE_TABS), detail: z.string(), note: z.string(), lastContactAt: z.string().nullable(), nextContactAt: z.string().nullable(),
  score: z.number().nullable(), assessmentBand: z.string().nullable(), assessmentAt: z.string().nullable(), registrationId: z.string().nullable(),
  assessmentSource: z.enum(["assessment", "class_band"]).nullable().optional(),
  assessmentCandidateCount: z.number().int().nonnegative().optional(),
  inferredSourceIds: z.array(z.string()).optional(),
  assessmentRecordId: z.string().nullable().optional(), learningBand: z.string().nullable().optional(), classBandLabel: z.string().optional(),
  courseTitle: z.string(), termName: z.string(), courseId: z.string().nullable(), termId: z.string().nullable(), createdAt: z.string(),
  detailLoaded: z.literal(false).optional(),
  canWrite: z.boolean(), canContact: z.boolean(), invitation: z.object({
    id: z.string(), leadId: z.string(), updatedAt: z.string(), kind: z.enum(INVITATION_KINDS), state: z.enum(INVITATION_STATES),
    activityId: z.string().nullable(), assessorId: z.string().nullable(), parentTimeOptions: z.array(z.string()), assessorTimeOptions: z.array(z.string()),
    scheduledAt: z.string().nullable(), locationText: z.string(), nextContactAt: z.string().nullable(),
  }).nullable(),
  recontactReason: z.enum(STUDENT_RECONTACT_REASONS).optional(), sharedPhoneCount: z.number().int().positive().optional(),
});
const rowSchema = studentStageRowSchema;
const pageSchema = z.object({
  rows: z.array(rowSchema), counts: z.record(z.string(), z.number().int().nonnegative()),
  count: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.union([z.literal(20),z.literal(50),z.literal(100)]),
  totalPages: z.number().int().positive(),
});
const savedSchema = z.object({ subject: rowSchema, savedAt: z.string(), opportunityId: z.string().nullable(), enrollmentId: z.string().nullable() });
type Client = Awaited<ReturnType<typeof createClient>>;
type StageRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

/** 此增量的版本化 RPC 用运行时合同校验；业务表继续使用现有生成类型。 */
export async function studentStageRpc(client: Client, name: string, args: Record<string, unknown>) {
  const { data, error } = await (client.rpc as unknown as StageRpc).call(client, name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function loadStudentStageData(filters: StudentStageFilters): Promise<StudentStageData> {
  const client = await createClient();
  return pageSchema.parse(await studentStageRpc(client, "list_student_record_workspace", {
    p_stage: filters.stage, p_scope: filters.scope, p_search: filters.q, p_page: filters.page, p_page_size: filters.pageSize, p_detail: filters.detail,
    p_population: filters.population ?? "work",
  }));
}
export async function loadStudentRecordSummaries(filters: StudentStageFilters) {
  const client = await createClient();
  const schema = z.object({ rows: z.array(rowSchema), counts: pageSchema.shape.counts, reasonCounts: z.record(z.string(), z.number().int().nonnegative()).optional() });
  if (filters.population === "recontact") return schema.parse(await studentStageRpc(client, "list_student_recontact_summaries", {
    p_scope: filters.scope, p_search: filters.q, p_reason: filters.reason ?? "unreachable",
  }));
  return schema.parse(await studentStageRpc(client, "list_student_record_summaries", {
    p_stage: filters.stage, p_scope: filters.scope, p_search: filters.q, p_population: filters.population ?? "work",
  }));
}
export async function readStudentStageSubject(client: Client, subject: { studentId: string | null; leadId: string | null }): Promise<StudentStageRow> {
  return rowSchema.parse(await studentStageRpc(client, "read_student_record_subject", { p_student_id: subject.studentId, p_lead_id: subject.leadId }));
}
export function parseStudentStageSaved(data: unknown): StudentStageSaved { return savedSchema.parse(data); }
export function parseStudentStageAssignments(data: unknown) { return z.array(z.object({ key: z.string(), subject: rowSchema.nullable() })).parse(data); }
