import { z } from "zod";

export const COMMUNICATION_CHANNELS = ["wechat", "phone", "in_person", "class_group", "other"] as const;
export const COMMUNICATION_OUTCOMES = ["contacted", "follow_up", "not_needed"] as const;
export const sessionCommunicationSchema = z.object({
  id: z.string(), studentId: z.string().nullable(), content: z.string(), occurredOn: z.string(),
  channel: z.enum(COMMUNICATION_CHANNELS), outcome: z.enum(COMMUNICATION_OUTCOMES),
  nextAction: z.string(), nextFollowUpOn: z.string().nullable(), author: z.string(), createdAt: z.string(),
});
export const sessionCommunicationsSchema = z.object({
  canRead: z.boolean(), canWrite: z.boolean(), completed: z.boolean(), records: z.array(sessionCommunicationSchema),
});
export type SessionCommunication = z.infer<typeof sessionCommunicationSchema>;
export type SessionCommunications = z.infer<typeof sessionCommunicationsSchema>;
export type CommunicationDraft = {
  id: string; occurredOn: string; channel: typeof COMMUNICATION_CHANNELS[number];
  outcome: typeof COMMUNICATION_OUTCOMES[number]; content: string; nextAction: string; nextFollowUpOn: string;
};

/** 按录入顺序取最新决定，补记早期沟通也能更新当前跟进状态。 */
export function latestSessionCommunication(records: readonly SessionCommunication[], studentId: string | null) {
  return records.filter(record => record.studentId === studentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
}

export function sessionCommunicationProgress(studentIds: readonly string[], records: readonly SessionCommunication[]) {
  const counts = { total: studentIds.length, contacted: 0, follow_up: 0, not_needed: 0, pending: 0 };
  for (const studentId of studentIds) counts[latestSessionCommunication(records, studentId)?.outcome ?? "pending"]++;
  return { ...counts, canComplete: counts.pending === 0 && counts.follow_up === 0 && latestSessionCommunication(records, null)?.outcome !== "follow_up" };
}

/** 保存当前学生时保留其他人的草稿。 */
export function removeCommunicationDraft(drafts: Record<string, CommunicationDraft>, key: string) {
  const next = { ...drafts };
  delete next[key];
  return next;
}
