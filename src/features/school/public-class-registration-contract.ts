import { z } from "zod";
import type { PublicClassParticipant, PublicClassParticipantRecord, PublicClassWorkbenchData } from "./public-class";

export type PublicClassRegistrationData = Pick<PublicClassWorkbenchData, "activity" | "segments" | "participants" | "roomOptions" | "staffOptions"> & {
  canRecord: boolean;
  canManage: boolean;
  canFollowUp: boolean;
};
const presence = z.enum(["expected", "attended", "late", "absent", "not_applicable"]);
export const publicClassRecordDraftSchema = z.object({
  segmentId: z.uuid(),
  expectedUpdatedAt: z.string().nullable(),
  studentPresence: presence,
  guardianPresence: presence,
  learningObservation: z.string().max(3000),
  assessmentSummary: z.string().max(3000),
  parentFeedback: z.string().max(3000),
  recommendation: z.string().max(3000),
}).strict();
export type PublicClassRecordDraft = z.infer<typeof publicClassRecordDraftSchema>;

export function publicClassRecordDraft(record: PublicClassParticipantRecord): PublicClassRecordDraft {
  return {
    segmentId: record.segmentId, expectedUpdatedAt: record.updatedAt,
    studentPresence: record.studentPresence, guardianPresence: record.guardianPresence,
    learningObservation: record.learningObservation, assessmentSummary: record.assessmentSummary,
    parentFeedback: record.parentFeedback, recommendation: record.recommendation,
  };
}
export function publicClassParticipantSummary(participant: PublicClassParticipant) {
  return {
    attended: participant.records.some((record) => ["attended", "late"].includes(record.studentPresence)),
    observation: participant.records.map((record) => record.learningObservation || record.assessmentSummary).filter(Boolean).join(" / "),
    family: participant.records.map((record) => record.parentFeedback).filter(Boolean).join(" / "),
    recommendation: participant.records.map((record) => record.recommendation).filter(Boolean).join(" / "),
  };
}
