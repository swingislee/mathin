export type PendingAssessmentRequest = { id: string; teacherId: string; parentTimeOptions: string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = (account: string, participant: string) => "gezhi.assessment.pending.v1." + account + "." + participant;

/** 仅保存尚未确认结果的请求，按账号和孩子隔离；重试沿用同一个请求号和内容。 */
export function pendingAssessment(account: string, participant: string): PendingAssessmentRequest | null {
  const value = wx.getStorageSync(key(account, participant)) as PendingAssessmentRequest | null;
  if (!value || !uuid.test(value.id) || !uuid.test(value.teacherId) || !Array.isArray(value.parentTimeOptions)
    || value.parentTimeOptions.length < 1 || value.parentTimeOptions.length > 84
    || value.parentTimeOptions.some(option => typeof option !== "string" || !/^\d{4}-\d{2}-\d{2}@[a-z_0-9:]+$/.test(option))) return null;
  return { id: value.id, teacherId: value.teacherId, parentTimeOptions: [...value.parentTimeOptions] };
}
export function savePendingAssessment(account: string, participant: string, value: PendingAssessmentRequest) {
  wx.setStorageSync(key(account, participant), value);
}
export function clearPendingAssessment(account: string, participant: string) {
  wx.removeStorageSync(key(account, participant));
}
