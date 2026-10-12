import type { ActivityRequestCommand } from "./api-types";
import type { QuestionAnswers } from "./form-questions";

/** Existing installations may still have unconfirmed requests using the previous API names. Keep their IDs and payloads. */
export function restoreAssessmentFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  if ("slotId" in input) return { id: input.id, slotId: input.slotId, mode: input.mode,
    topics: input.topics ?? input.subjects, stageNumber: input.stageNumber ?? input.grade };
  return { id: input.id, facilitatorId: input.facilitatorId ?? input.teacherId,
    participantTimeOptions: input.participantTimeOptions ?? input.parentTimeOptions };
}

export function restoreActivityRequest(value: unknown, publicationId: string): Extract<ActivityRequestCommand, { action: "apply" }> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (row.action !== "apply" || row.kind !== "activity" || row.publicationId !== publicationId
    || typeof row.id !== "string" || !uuid.test(row.id) || typeof row.participantId !== "string" || !uuid.test(row.participantId)
    || typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 1
    || (row.classroomId !== undefined && row.classroomId !== null)) return null;
  if (row.pageRevision !== undefined && (typeof row.pageRevision !== "number" || !Number.isInteger(row.pageRevision) || row.pageRevision < 0)) return null;
  if (row.answers !== undefined && (!row.answers || typeof row.answers !== "object" || Array.isArray(row.answers)
    || Object.keys(row.answers).length > 20 || JSON.stringify(row.answers).length > 20000
    || Object.entries(row.answers).some(([key, value]) => !/^[a-z][a-z0-9_-]{0,49}$/.test(key) || ["constructor", "prototype"].includes(key)
      || (typeof value !== "string" && (!Array.isArray(value) || value.some(item => typeof item !== "string")))))) return null;
  return { action: "apply", kind: "activity", id: row.id, publicationId, revision: row.revision, participantId: row.participantId,
    ...(row.pageRevision !== undefined ? { pageRevision: row.pageRevision as number } : {}), ...(row.answers !== undefined ? { answers: row.answers as QuestionAnswers } : {}) };
}
