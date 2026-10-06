import type { CourseOffer } from "./api-types";
import type { Locale } from "./locale";
import { catalogLabels, stageGroups } from "./catalog";

export const courseCopy = {
  zh: { catalog: "公益活动", allGrades: "全部年级", all: "查看全部", choose: "报名参与", detail: "活动详情", selection: "活动报名", apply: "提交报名申请", pricePending: "公益活动", starts: "举办", selectStudent: "选择参与孩子", switchStudent: "切换孩子", submitNote: "本活动为公益活动，不收取参与费用。提交申请后由学服联系确认，提交申请不占用名额。", applications: "活动报名记录", pending: "待联系", contacted: "已联系", confirmed: "已确认", declined: "暂不接受", cancelled: "已撤回", cancel: "撤回报名", success: "报名申请已提交", historyEmpty: "暂无活动报名", login: "登录后报名", studentNeeded: "请先关联孩子，再提交报名申请。", unknown: "提交结果待核对，请重试原申请或查看报名记录。", retry: "重试原申请", closed: "活动已停止展示或报名已截止", catalogEmpty: "暂无符合条件的公益活动", chooseHint: "请选择参与孩子", applicationPrompt: "确认提交活动报名申请？", cancelPrompt: "确认撤回这份待联系的活动报名？", view: "查看报名记录", fee: "公益活动", filterHint: "按孩子年级查看适合的公益活动", activity: "公益活动", advisor: "联系学服", location: "活动地点", full: "已满" },
  en: { catalog: "Community activities", allGrades: "All grades", all: "View all", choose: "Apply to join", detail: "Activity details", selection: "Activity registration", apply: "Submit request", pricePending: "Community activity", starts: "", selectStudent: "Choose a child", switchStudent: "Switch child", submitNote: "This community activity has no participation fee. An advisor will contact you to confirm. A request does not reserve a place.", applications: "Activity requests", pending: "Awaiting contact", contacted: "Contacted", confirmed: "Confirmed", declined: "Unable to accept", cancelled: "Withdrawn", cancel: "Withdraw request", success: "Request submitted", historyEmpty: "No activity requests yet", login: "Sign in to apply", studentNeeded: "Link a child before applying.", unknown: "The result is unknown. Retry this same request or check your records.", retry: "Retry this request", closed: "Activity unavailable or registration closed", catalogEmpty: "No matching community activities", chooseHint: "Choose a participating child", applicationPrompt: "Submit this activity request?", cancelPrompt: "Withdraw this pending activity request?", view: "View requests", fee: "Community activity", filterHint: "Find activities for your child's grade", activity: "Community activity", advisor: "Contact advisor", location: "Activity location", full: "Full" },
};
export function coursePrice(_value: number | null, locale: Locale) { return courseCopy[locale].fee; }
export function courseDate(value: string) {
  const d = new Date(Date.parse(value) + 8 * 3600000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function courseCard(offer: CourseOffer, locale: Locale) {
  return { ...offer, label: offer.title, priceLabel: courseCopy[locale].fee,
    meta: offer.activity?.location || "", startLabel: offer.activity ? courseDate(offer.activity.startsAt) : "",
    open: Date.parse(offer.bookingClosesAt) > Date.now() };
}
const preferenceKey = "gezhi.activity-catalog.filters.v1";
export function courseFilters() { const input = wx.getStorageSync(preferenceKey) || {}; return { stage: typeof input.stage === "string" ? input.stage : "" }; }
export function saveCourseFilters(value: { stage: string }) { wx.setStorageSync(preferenceKey, { stage: value.stage }); }
export function courseCatalogLabels(locale: Locale, stage = "") { return { ...catalogLabels(stage, "", locale), courseCopy: courseCopy[locale] }; }
export function filterCourseOffers(rows: CourseOffer[], stage: string, now = Date.now()) {
  const stages = stageGroups.reduce((all, g) => all.concat(g.stages), [] as typeof stageGroups[0]["stages"]);
  const grade = stages.find(s => s.id === stage)?.grade;
  return rows.filter(r => r.kind === "activity" && r.activity && Date.parse(r.bookingClosesAt) > now
    && (grade === undefined || (Array.isArray(r.activity.targetGrades) && (!r.activity.targetGrades.length || r.activity.targetGrades.includes(grade)))));
}
