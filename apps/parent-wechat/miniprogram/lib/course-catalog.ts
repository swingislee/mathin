import type { CourseOffer, CatalogClass } from "./api-types";
import type { Locale } from "./locale";
import { catalogLabels, learnerGradeLabel, stageGroups } from "./catalog";

export const courseCopy = {
  zh: { catalog: "班级与活动", all: "查看全部", choose: "预报名", detail: "报名详情", selection: "预报名", apply: "提交预报名", pricePending: "线下缴费", startPending: "开课时间待定", lessons: "个已排课次", starts: "起", selectStudent: "选择学员", switchStudent: "切换学员", level: "班型", campus: "校区", teacher: "老师", time: "上课时段", quick: "查看班级安排", reset: "重置所有选择", available: "预报名", full: "已满", pendingCampus: "校区待定", pendingTeacher: "老师待定", pendingSchedule: "排课待定", noMatch: "暂无符合选择的班级", selected: "所选班级", submitNote: "这里只提交预报名，不占用名额。学辅老师将线下联系，家长线下缴费，正式入班另行办理。", applications: "我的预报名", pending: "待联系", contacted: "已联系", confirmed: "历史正式报名", declined: "暂不接受", cancelled: "已撤回", cancel: "撤回预报名", success: "预报名已提交", historyEmpty: "暂无预报名", login: "登录后预报名", studentNeeded: "请先关联学员，再提交预报名。", allTerms: "全部学期", allSubjects: "全部科目", dateNote: "以下时段来自实际排课，具体上课日期以课表为准。", unknown: "提交结果待核对，请重试原预报名或查看记录。", retry: "重试原预报名", closed: "已停止展示或预报名已截止", catalogEmpty: "暂无已发布的班级或活动", chooseHint: "请选择学员与班级", remaining: "余位", applicationPrompt: "确认提交预报名？", cancelPrompt: "确认撤回这份待联系的预报名？", view: "查看预报名", fee: "线下缴费", filterHint: "按年级和科目查看班级与活动", allKinds: "全部", longClass: "长期班", shortClass: "短期班", activity: "活动", advisor: "联系学辅", location: "活动地点" },
  en: { catalog: "Classes and activities", all: "View all", choose: "Pre-register", detail: "Registration details", selection: "Pre-register", apply: "Submit pre-registration", pricePending: "Pay offline", startPending: "Start date pending", lessons: "scheduled lessons", starts: "onwards", selectStudent: "Select student", switchStudent: "Switch student", level: "Class type", campus: "Campus", teacher: "Teacher", time: "Timetable", quick: "Class arrangement", reset: "Reset selection", available: "Pre-register", full: "Full", pendingCampus: "Campus pending", pendingTeacher: "Teacher pending", pendingSchedule: "Schedule pending", noMatch: "No matching classes", selected: "Selected class", submitNote: "This is pre-registration and does not reserve a seat. An advisor will contact you. Families pay offline, and class membership is handled separately.", applications: "My pre-registrations", pending: "Awaiting contact", contacted: "Contacted", confirmed: "Historical enrollment", declined: "Unable to accept", cancelled: "Withdrawn", cancel: "Withdraw pre-registration", success: "Pre-registration submitted", historyEmpty: "No pre-registrations yet", login: "Sign in to pre-register", studentNeeded: "Link a student before pre-registering.", allTerms: "All terms", allSubjects: "All subjects", dateNote: "Times reflect scheduled lessons. Check the timetable for individual dates.", unknown: "Submission outcome is unknown. Retry this pre-registration or check your records.", retry: "Retry pre-registration", closed: "Listing unavailable or pre-registration closed", catalogEmpty: "No published classes or activities", chooseHint: "Select a student and class", remaining: "places left", applicationPrompt: "Submit pre-registration?", cancelPrompt: "Withdraw this pending pre-registration?", view: "View pre-registrations", fee: "Pay offline", filterHint: "Browse classes and activities by grade and subject", allKinds: "All", longClass: "Long-term", shortClass: "Short-term", activity: "Activities", advisor: "Contact advisor", location: "Activity location" },
};
export function coursePrice(value: number | null, locale: Locale) { return value === null ? courseCopy[locale].pricePending : `¥${(value / 100).toFixed(2)}`; }
export function courseDate(value: string) {
  const d = new Date(Date.parse(value) + 8 * 3600000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function courseCard(offer: CourseOffer, locale: Locale) {
  const classes = offer.classes; const first = classes[0];
  const times = classes.reduce((all, c) => all.concat(c.sessions.map(s => s.at)), [] as string[]).sort();
  const activity = offer.activity;
  const kindLabel = activity ? courseCopy[locale].activity : first?.offeringType === "short_term_topic" ? courseCopy[locale].shortClass : courseCopy[locale].longClass;
  if (activity) times.push(activity.startsAt);
  return { ...offer, label: offer.title, priceLabel: courseCopy[locale].fee, termLabel: first?.termName || "", kindLabel,
    meta: activity ? [kindLabel, activity.location].filter(Boolean).join(" · ") : [kindLabel, learnerGradeLabel(first?.grade, locale), first?.subject, first?.termName].filter(Boolean).join(" · "),
    startLabel: times.length ? courseDate(times[0]) + " " + courseCopy[locale].starts : courseCopy[locale].startPending,
    open: true };
}
const preferenceKey = "gezhi.course-catalog.filters.v1";
export function courseFilters() {
  const input = wx.getStorageSync(preferenceKey) || {};
  return { stage: typeof input.stage === "string" ? input.stage : "", subject: typeof input.subject === "string" ? input.subject : "" };
}
export function saveCourseFilters(value: { stage: string; subject: string }) { wx.setStorageSync(preferenceKey, { stage: value.stage, subject: value.subject }); }
export function courseCatalogLabels(rows: CourseOffer[], stage: string, subject: string, locale: Locale) {
  const subjects = Array.from(new Set(rows.reduce((all, r) => all.concat(r.classes.map(c => c.subject)), [] as string[]).filter(Boolean))).map(id => ({ id, label: id }));
  return { ...catalogLabels(stage, "", locale), subjects, subjectLabel: subject, courseCopy: courseCopy[locale] };
}
export function filterCourseOffers(rows: CourseOffer[], stage: string, subject: string, term = "", now = Date.now(), kind = "") {
  const stages = stageGroups.reduce((all, g) => all.concat(g.stages), [] as typeof stageGroups[0]["stages"]);
  const grade = stages.find(s => s.id === stage)?.grade;
  return rows.filter(r => Date.parse(r.bookingClosesAt) > now && (r.kind === "activity"
    ? (!kind || kind === "activity") && !subject && !term && (grade === undefined || (Array.isArray(r.activity?.targetGrades) && (!r.activity.targetGrades.length || r.activity.targetGrades.includes(grade))))
    : r.classes.some(c => (!kind || (kind === "short" ? c.offeringType === "short_term_topic" : kind === "long" && c.offeringType !== "short_term_topic"))
      && (grade === undefined || c.grade === grade) && (!subject || c.subject === subject) && (!term || c.termId === term))));
}
export type ClassFilters = { level: string; campus: string; teacher: string };
export function matchingClasses(rows: CatalogClass[], filters: ClassFilters) {
  return rows.filter(c => (!filters.level || c.level === filters.level) && (!filters.campus || (c.campusId || "pending") === filters.campus)
    && (!filters.teacher || c.teachers.some(t => t.id === filters.teacher)));
}
export function classTimes(row: CatalogClass, locale: Locale) {
  const days = locale === "zh" ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const labels = row.sessions.map(s => {
    const d = new Date(Date.parse(s.at) + 8 * 3600000); const end = new Date(d.getTime() + s.duration * 60000);
    const hhmm = (v: Date) => `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
    return `${days[d.getUTCDay()]} ${hhmm(d)}–${hhmm(end)}`;
  });
  return Array.from(new Set(labels)).join(" / ") || courseCopy[locale].pendingSchedule;
}
export function classTimeGrid(classes: CatalogClass[], locale: Locale) {
  const dayLabels = locale === "zh" ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const entries: { day: number; time: string; id: string; name: string; full: boolean }[] = [];
  for (const c of classes) for (const s of c.sessions) {
    const d = new Date(Date.parse(s.at) + 8 * 3600000); const end = new Date(d.getTime() + s.duration * 60000);
    const hm = (v: Date) => `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
    const time = hm(d) + "–" + hm(end), day = d.getUTCDay();
    if (!entries.some(e => e.id === c.id && e.day === day && e.time === time)) entries.push({ day, time, id: c.id, name: c.name, full: c.remaining === 0 });
  }
  const days = Array.from(new Set(entries.map(e => e.day))).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(id => ({ id, label: dayLabels[id] }));
  const times = Array.from(new Set(entries.map(e => e.time))).sort();
  return { days, rows: times.map(time => ({ time, cells: days.map(day => ({ day: day.id, choices: entries.filter(e => e.day === day.id && e.time === time) })) })) };
}
