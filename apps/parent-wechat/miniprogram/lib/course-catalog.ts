import type { CourseOffer, CatalogClass } from "./api-types";
import type { Locale } from "./locale";
import { catalogLabels, learnerGradeLabel, stageGroups } from "./catalog";

export const courseCopy = {
  zh: { catalog: "长期课程", all: "查看全部", choose: "立即选班", detail: "课程详情", selection: "选课", apply: "提交报名申请", pricePending: "报价待确认", startPending: "开课时间待定", lessons: "个已排课次", starts: "起", selectStudent: "选择学员", switchStudent: "切换学员", level: "选择类型", campus: "选择校区", teacher: "选择老师", time: "选择时段", quick: "快捷选择", reset: "重置所有选择", available: "可申请", full: "已满", pendingCampus: "校区待定", pendingTeacher: "老师待定", pendingSchedule: "排课待定", noMatch: "暂无符合选择的班级", selected: "已选班级", submitNote: "申请提交后由工作人员核对确认，不占用名额；费用及缴费方式由工作人员确认。", applications: "报名申请", pending: "待确认", confirmed: "已确认报名", declined: "未通过", cancelled: "已撤回", cancel: "撤回申请", success: "申请已提交", historyEmpty: "暂无报名申请", login: "登录后选班", studentNeeded: "请先关联学员，再提交报名申请。", allTerms: "全部学期", allSubjects: "全部科目", dateNote: "以下时段来自实际排课，具体上课日期以课表为准。", unknown: "提交结果待核对，请重试原申请或查看报名申请。", retry: "重试原申请", closed: "课程已下架或申请已截止", catalogEmpty: "暂无已发布的课程", chooseHint: "请选择学员与班级", remaining: "余位", applicationPrompt: "确认提交报名申请？", cancelPrompt: "确认撤回这份待处理的报名申请？", view: "查看申请", fee: "课程报价", filterHint: "按学员年级和科目查看已发布课程" },
  en: { catalog: "Long-term courses", all: "View all", choose: "Choose a class", detail: "Course details", selection: "Choose a class", apply: "Submit application", pricePending: "Quote pending", startPending: "Start date pending", lessons: "scheduled lessons", starts: "onwards", selectStudent: "Select student", switchStudent: "Switch student", level: "Class type", campus: "Campus", teacher: "Teacher", time: "Time", quick: "Quick selection", reset: "Reset selection", available: "Apply", full: "Full", pendingCampus: "Campus pending", pendingTeacher: "Teacher pending", pendingSchedule: "Schedule pending", noMatch: "No matching classes", selected: "Selected class", submitNote: "Staff will review your application. It does not reserve a seat. Staff will confirm fees and payment arrangements.", applications: "Applications", pending: "Pending", confirmed: "Enrollment confirmed", declined: "Declined", cancelled: "Withdrawn", cancel: "Withdraw application", success: "Application submitted", historyEmpty: "No applications yet", login: "Sign in to choose a class", studentNeeded: "Link a student before applying.", allTerms: "All terms", allSubjects: "All subjects", dateNote: "Times reflect scheduled lessons. Check the timetable for individual dates.", unknown: "Submission outcome is unknown. Retry this application or check your applications.", retry: "Retry application", closed: "Offer closed or no longer published", catalogEmpty: "No published courses", chooseHint: "Select a student and class", remaining: "places left", applicationPrompt: "Submit this application?", cancelPrompt: "Withdraw this pending application?", view: "View application", fee: "Course quote", filterHint: "Browse published courses by grade and subject" },
};
export function coursePrice(value: number | null, locale: Locale) { return value === null ? courseCopy[locale].pricePending : `¥${(value / 100).toFixed(2)}`; }
export function courseDate(value: string) {
  const d = new Date(Date.parse(value) + 8 * 3600000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function courseCard(offer: CourseOffer, locale: Locale) {
  const classes = offer.classes; const first = classes[0];
  const times = classes.reduce((all, c) => all.concat(c.sessions.map(s => s.at)), [] as string[]).sort();
  return { ...offer, label: offer.title, priceLabel: coursePrice(offer.priceCents, locale), termLabel: first.termName,
    meta: [learnerGradeLabel(first.grade, locale), first.subject, first.termName].filter(Boolean).join(" · "),
    startLabel: times.length ? courseDate(times[0]) + " " + courseCopy[locale].starts : courseCopy[locale].startPending,
    open: classes.some(c => c.remaining !== 0) };
}
const preferenceKey = "gezhi.course-catalog.filters.v1";
export function courseFilters() {
  const input = wx.getStorageSync(preferenceKey) || {};
  return { stage: typeof input.stage === "string" ? input.stage : "", subject: typeof input.subject === "string" ? input.subject : "" };
}
export function saveCourseFilters(value: { stage: string; subject: string }) { wx.setStorageSync(preferenceKey, { stage: value.stage, subject: value.subject }); }
export function courseCatalogLabels(rows: CourseOffer[], stage: string, subject: string, locale: Locale) {
  const subjects = Array.from(new Set(rows.map(r => r.classes[0].subject).filter(Boolean))).map(id => ({ id, label: id }));
  return { ...catalogLabels(stage, "", locale), subjects, subjectLabel: subject, courseCopy: courseCopy[locale] };
}
export function filterCourseOffers(rows: CourseOffer[], stage: string, subject: string, term = "", now = Date.now()) {
  const stages = stageGroups.reduce((all, g) => all.concat(g.stages), [] as typeof stageGroups[0]["stages"]);
  const grade = stages.find(s => s.id === stage)?.grade;
  return rows.filter(r => Date.parse(r.bookingClosesAt) > now && r.classes.some(c => (grade === undefined || c.grade === grade) && (!subject || c.subject === subject) && (!term || c.termId === term)));
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
