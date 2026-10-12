import type { AssessmentTopic } from "./api-types";
import { restoreAssessmentFields } from "./cache-compat";
export type PendingAssessmentRequest = { id: string; facilitatorId: string; participantTimeOptions: string[] }
  | { id: string; slotId: string; topics: AssessmentTopic[]; stageNumber: number; mode: "campus" | "online" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = (account: string, participant: string) => "gezhi.assessment.pending.v1." + account + "." + participant;

/** 仅保存尚未确认结果的请求，按账号和参与人隔离；重试沿用同一个请求号和内容。 */
export function pendingAssessment(account: string, participant: string): PendingAssessmentRequest | null {
  const value = restoreAssessmentFields(wx.getStorageSync(key(account, participant))) as PendingAssessmentRequest | null;
  if (!value || !uuid.test(value.id)) return null;
  if ("slotId" in value) {
    if (!uuid.test(value.slotId) || !["campus", "online"].includes(value.mode) || !Number.isInteger(value.stageNumber) || value.stageNumber < -1 || value.stageNumber > 12
      || !Array.isArray(value.topics) || !value.topics.length || value.topics.length > 12
      || value.topics.some(topic => typeof topic !== "string" || !(/^[a-z0-9][a-z0-9_-]{0,63}$/).test(topic)) || new Set(value.topics).size !== value.topics.length) return null;
    return { id: value.id, slotId: value.slotId, topics: [...value.topics], stageNumber: value.stageNumber, mode: value.mode };
  }
  if (!uuid.test(value.facilitatorId) || !Array.isArray(value.participantTimeOptions)
    || value.participantTimeOptions.length < 1 || value.participantTimeOptions.length > 84
    || value.participantTimeOptions.some(option => typeof option !== "string" || !/^\d{4}-\d{2}-\d{2}@[a-z_0-9:]+$/.test(option))) return null;
  return { id: value.id, facilitatorId: value.facilitatorId, participantTimeOptions: [...value.participantTimeOptions] };
}
export function savePendingAssessment(account: string, participant: string, value: PendingAssessmentRequest) {
  wx.setStorageSync(key(account, participant), value);
}
export function clearPendingAssessment(account: string, participant: string) {
  wx.removeStorageSync(key(account, participant));
}
