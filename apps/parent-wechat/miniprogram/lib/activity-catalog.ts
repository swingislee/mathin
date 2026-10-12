import type { ActivityOffer } from "./api-types";
import type { Locale } from "./locale";
import { catalogLabels, normalizeFilters, catalogStages } from "./catalog";

export const activityCopy = {
  zh: { catalog: "公益活动", allStages: "全部阶段", all: "查看全部", choose: "报名参与", detail: "活动详情", selection: "活动报名", apply: "提交报名申请", pricePending: "公益活动", starts: "举办", selectParticipant: "选择参与人", switchParticipant: "切换参与人", submitNote: "本活动为公益活动，不收取参与费用。提交申请后由工作人员联系确认，提交申请不占用名额。", applications: "活动报名记录", pending: "待联系", contacted: "已联系", confirmed: "已确认", declined: "暂不接受", cancelled: "已撤回", cancel: "撤回报名", success: "报名申请已提交", historyEmpty: "暂无活动报名", login: "登录后报名", participantNeeded: "请先关联参与人，再提交报名申请。", unknown: "提交结果待核对，请重试原申请或查看报名记录。", retry: "重试原申请", closed: "活动已停止展示或报名已截止", catalogEmpty: "暂无符合条件的公益活动", chooseHint: "请选择参与人", applicationPrompt: "确认提交活动报名申请？", cancelPrompt: "确认撤回这份待联系的活动报名？", view: "查看报名记录", fee: "公益活动", filterHint: "按参与者阶段查看适合的公益活动", activity: "公益活动", service: "联系服务", location: "活动地点", full: "已满" },
  en: { catalog: "Community activities", allStages: "All stages", all: "View all", choose: "Apply to join", detail: "Activity details", selection: "Activity registration", apply: "Submit request", pricePending: "Community activity", starts: "", selectParticipant: "Choose a participant", switchParticipant: "Switch participant", submitNote: "This community activity has no participation fee. A staff member will contact you to confirm. A request does not reserve a place.", applications: "Activity requests", pending: "Awaiting contact", contacted: "Contacted", confirmed: "Confirmed", declined: "Unable to accept", cancelled: "Withdrawn", cancel: "Withdraw request", success: "Request submitted", historyEmpty: "No activity requests yet", login: "Sign in to apply", participantNeeded: "Link a participant before applying.", unknown: "The result is unknown. Retry this same request or check your records.", retry: "Retry this request", closed: "Activity unavailable or registration closed", catalogEmpty: "No matching community activities", chooseHint: "Choose a participant", applicationPrompt: "Submit this activity request?", cancelPrompt: "Withdraw this pending activity request?", view: "View requests", fee: "Community activity", filterHint: "Find activities for the participant’s stage", activity: "Community activity", service: "Contact service", location: "Activity location", full: "Full" },
};
export function activityPrice(_value: number | null, locale: Locale) { return activityCopy[locale].fee; }
export function activityDate(value: string) {
  const d = new Date(Date.parse(value) + 8 * 3600000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function activityCard(offer: ActivityOffer, locale: Locale) {
  return { ...offer, label: offer.title, priceLabel: activityCopy[locale].fee,
    meta: offer.activity?.location || "", startLabel: offer.activity ? activityDate(offer.activity.startsAt) : "",
    open: Date.parse(offer.bookingClosesAt) > Date.now() };
}
const preferenceKey = "gezhi.activity-catalog.filters.v1";
export function activityFilters() { return normalizeFilters(wx.getStorageSync(preferenceKey)); }
export function saveActivityFilters(value: { stage: string; topic: string }) { wx.setStorageSync(preferenceKey, normalizeFilters(value)); }
export function activityTopics(rows: ActivityOffer[], now = Date.now()) {
  return [...new Set(filterActivityOffers(rows, "", "", now).reduce((all, row) => all.concat(row.tags ?? []), [] as string[]))]
    .map(tag => ({ id: tag, label: tag }));
}
export function activityCatalogLabels(locale: Locale, stage = "", topic = "", rows: ActivityOffer[] = []) {
  return { ...catalogLabels(stage, topic, locale, activityTopics(rows)), activityCopy: activityCopy[locale] };
}
export function filterActivityOffers(rows: ActivityOffer[], stage: string, topic = "", now = Date.now()) {
  const stages = catalogStages();
  const stageNumber = stages.find(s => s.id === stage)?.stageNumber;
  return rows.filter(r => r.kind === "activity" && r.activity && Date.parse(r.bookingClosesAt) > now
    && (stageNumber === undefined || (Array.isArray(r.activity.targetStages) && (!r.activity.targetStages.length || r.activity.targetStages.includes(stageNumber)))))
    .filter(row => !topic || (row.tags ?? []).includes(topic));
}
