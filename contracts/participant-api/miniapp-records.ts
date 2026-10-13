import { experienceText as t, localText, type AccountRecordSource, type ExperienceLocale } from "./miniapp-experience";
import type { ActivityTask, Booking, Report } from "./portal";
import type { ExperienceRequest, ExperienceRemoteBooking } from "./experience-runtime";
export const accountRecordNames = {
  activityBookings: t("活动预约", "Activity bookings"), serviceBookings: t("服务预约", "Service bookings"), serviceRequests: t("服务申请", "Service requests"),
  reports: t("已发布报告", "Published reports"), tasks: t("学习任务", "Tasks"), notifications: t("服务消息", "Notifications"),
};
export const accountRecordTargets: Record<AccountRecordSource, string> = { activityBookings: "reservations", serviceBookings: "serviceBookings", serviceRequests: "serviceRequests", reports: "reflections", tasks: "records", notifications: "notifications" };
export type AccountRecordRow = { id: string; title: string; participant: string; status: string; time: string; note: string; path: string };
export type AccountNotification = { id: string; title: { zh: string; en: string }; body: { zh: string; en: string }; createdAt: string };
export type AccountRecordData = { activityBookings: Booking[]; serviceBookings: ExperienceRemoteBooking[]; serviceRequests: ExperienceRequest[]; reports: Report[]; tasks: ActivityTask[]; notifications: AccountNotification[] };
const labels: Record<string, [string, string]> = { booked: ["已预约", "Booked"], requested: ["待确认", "Requested"], submitted: ["待受理", "Submitted"], confirmed: ["已确认", "Confirmed"], completed: ["已完成", "Completed"], attended: ["已参加", "Attended"], cancelled: ["已取消", "Cancelled"], declined: ["未受理", "Declined"], no_show: ["未到场", "No show"], noShow: ["未到场", "No show"], waitlisted: ["候补中", "Waiting list"] };
export function accountRecordRows<K extends AccountRecordSource>(source: K, input: AccountRecordData[K], locale: ExperienceLocale): AccountRecordRow[] {
  const status = (value: string) => labels[value]?.[locale === "en" ? 1 : 0] || value;
  const base = (id: string, title: string, time: string | null, path: string): AccountRecordRow => ({ id, title, time: time || "", path, participant: "", status: "", note: "" });
  switch (source) {
    case "activityBookings": return (input as Booking[]).map(r => ({ ...base(r.id, localText(r.title, locale), r.startsAt, "/pages/reservations/index?filter=all"), participant: r.participantName, status: status(r.status), note: r.location }));
    case "serviceBookings": return (input as ExperienceRemoteBooking[]).map(r => ({ ...base(r.id, localText(r.serviceName, locale), r.startsAt, "/pages/provider-bookings/index"), status: status(r.status), note: r.note }));
    case "serviceRequests": return (input as ExperienceRequest[]).map(r => ({ ...base(r.id, localText(r.serviceName, locale), r.createdAt, "/pages/experience-requests/index"), status: status(r.status), note: r.note }));
    case "reports": return (input as Report[]).map(r => ({ ...base(r.id, r.title, r.date, "/pages/reflections/index?id=" + encodeURIComponent(r.id)), participant: r.participantName, status: locale === "en" ? "Published" : "已发布" }));
    case "tasks": return (input as ActivityTask[]).map(r => ({ ...base(r.id + ":" + r.participantId, r.title, r.dueAt, "/pages/task/index?id=" + encodeURIComponent(r.id) + "&participant=" + encodeURIComponent(r.participantId)), participant: r.participantName, status: r.submittedAt ? (locale === "en" ? "Submitted" : "已提交") : (locale === "en" ? "Pending" : "待提交") }));
    case "notifications": return (input as AccountNotification[]).map(r => ({ ...base(r.id, localText(r.title, locale), r.createdAt, "/pages/experience-notifications/index"), note: localText(r.body, locale) }));
    default: return [];
  }
}
