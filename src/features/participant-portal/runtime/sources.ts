import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readReports, requireResult } from "@/features/parent-portal/server";
import { activityCatalogGet } from "../activity-detail-server";
import { activityPageImageUrl } from "../../../../contracts/participant-api/activity-detail";
import type { ActivityOffer, ActivityTask, Booking } from "../../../../contracts/participant-api/portal";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import type { RuntimeDay, RuntimeFacet, RuntimeFacetKind, RuntimeItem, RuntimeLocale, RuntimeSource } from "../../../../contracts/participant-api/runtime";

const hour = 3_600_000, day = 24 * hour, shanghai = 8 * hour;
export const shanghaiDate = (ms: number) => new Date(ms + shanghai).toISOString().slice(0, 10);
const shanghaiTime = (ms: number) => new Date(ms + shanghai).toISOString().slice(11, 16);
const dateStart = (value: string) => Date.parse(value + "T00:00:00+08:00");
export const validDate = (value: string | null) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateStart(value)) && shanghaiDate(dateStart(value)) === value;

export type RuntimeIdentity = {
  signedIn: boolean; db: SupabaseClient | null; name: string; participants: { id: string; name: string; stage?: number | null }[];
  participant: string | null; stage: number | null;
};
export type SourceInput = { identity: RuntimeIdentity; locale: RuntimeLocale; settings: MiniappSettings; filters: Partial<Record<RuntimeFacetKind, string>>; now: number };
export type SourceResult = { items: RuntimeItem[]; facets: RuntimeFacet[] };

const item = (value: Partial<RuntimeItem> & Pick<RuntimeItem, "id" | "title">): RuntimeItem => ({
  subtitle: "", summary: "", meta: [], tags: [], image: "", status: null, actionLabel: "", action: null, date: "", start: "", end: "", phase: "", ...value,
});
const words = {
  zh: { stage: "参与者阶段", topic: "活动标签", stageHint: "按参与者阶段查看适合的公益活动", topicHint: "按活动标签筛选", allStages: "全部阶段", allTopics: "全部标签", booked: "待参与", attended: "已参与", no_show: "未参与", cancelled: "已取消",
    due: "截止", submitted: "已提交", pending: "待提交", assessment: "诊断报告", feedback: "活动反馈" },
  en: { stage: "Participant stage", topic: "Activity tag", stageHint: "Find activities for the participant's stage", topicHint: "Filter by activity tag", allStages: "All stages", allTopics: "All tags", booked: "Upcoming", attended: "Attended", no_show: "Not attended", cancelled: "Cancelled",
    due: "Due", submitted: "Submitted", pending: "To submit", assessment: "Assessment report", feedback: "Activity feedback" },
};
const dateLabel = (value: string) => shanghaiDate(Date.parse(value)).replaceAll("-", ".");
const dateTimeLabel = (value: string) => `${dateLabel(value)} ${shanghaiTime(Date.parse(value))}`;

async function activities(input: SourceInput): Promise<SourceResult> {
  const response = await activityCatalogGet();
  const offers = await response.json() as ActivityOffer[];
  const w = words[input.locale];
  const stages = input.settings.stages.flatMap(group => group.stages.filter(stage => stage.visible).map(stage => ({ ...stage, group: group.label[input.locale] || group.label.zh })));
  const stage = stages.find(row => row.id === input.filters.stage);
  const open = offers.filter(row => row.kind === "activity" && row.activity && Date.parse(row.bookingClosesAt) > input.now);
  const topics = [...new Set(open.flatMap(row => row.tags ?? []))];
  const topic = topics.includes(input.filters.topic || "") ? input.filters.topic! : "";
  const rows = open.filter(row => !stage || !Array.isArray(row.activity!.targetStages) || !row.activity!.targetStages.length || row.activity!.targetStages.includes(stage.stageNumber))
    .filter(row => !topic || (row.tags ?? []).includes(topic))
    .sort((a, b) => (a.listing?.sortOrder ?? 0) - (b.listing?.sortOrder ?? 0));
  return {
    items: rows.map(row => item({ id: row.id, title: row.title, summary: row.listing?.summary || "", tags: row.listing?.labels || [],
      image: activityPageImageUrl(row.listing?.cover || "", false, true), meta: [[dateLabel(row.activity!.startsAt), row.activity!.location].filter(Boolean).join(" · ")],
      status: row.registration?.canApply === false ? { label: input.locale === "zh" ? "报名已截止" : "Closed", tone: "muted" } : null,
      action: { type: "route", route: "activity-detail", query: { id: row.id } } })),
    facets: [
      { id: "stage", label: w.stage, hint: w.stageHint, value: stage?.id || "", valueLabel: stage ? stage.label[input.locale] || stage.label.zh : w.allStages,
        options: [{ value: "", label: w.allStages, group: "" }, ...stages.map(row => ({ value: row.id, label: row.label[input.locale] || row.label.zh, group: row.group }))] },
      { id: "topic", label: w.topic, hint: w.topicHint, value: topic, valueLabel: topic || w.allTopics,
        options: [{ value: "", label: w.allTopics, group: "" }, ...topics.map(value => ({ value, label: value, group: "" }))] },
    ],
  };
}

async function bookings(input: SourceInput, db: SupabaseClient): Promise<SourceResult> {
  const rows = (requireResult(await db.rpc("miniapp_my_bookings")) ?? []) as Booking[];
  const w = words[input.locale];
  return { facets: [], items: rows.filter(row => !input.identity.participant || row.participantId === input.identity.participant)
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)).map(row => item({
      id: row.id, title: row.title[input.locale] || row.title.zh, subtitle: dateTimeLabel(row.startsAt), meta: [row.participantName, row.location].filter(Boolean),
      status: { label: w[row.status], tone: row.status === "booked" ? "positive" : row.status === "attended" ? "neutral" : "muted" },
      action: { type: "route", route: "reservations" } })) };
}

async function tasks(input: SourceInput, db: SupabaseClient): Promise<SourceResult> {
  const rows = (requireResult(await db.rpc("miniapp_my_practices")) ?? []) as ActivityTask[];
  const w = words[input.locale];
  return { facets: [], items: rows.filter(row => !input.identity.participant || row.participantId === input.identity.participant).map(row => item({
    id: row.id + ":" + row.participantId, title: row.title, subtitle: row.dueAt ? `${w.due} ${dateTimeLabel(row.dueAt)}` : "", meta: [row.participantName],
    status: row.submittedAt ? { label: w.submitted, tone: "neutral" } : { label: w.pending, tone: "warning" },
    action: { type: "route", route: "task", query: { id: row.id, participant: row.participantId } } })) };
}

async function reports(input: SourceInput, db: SupabaseClient): Promise<SourceResult> {
  const rows = await readReports(db, input.now);
  const w = words[input.locale];
  return { facets: [], items: rows.filter(row => !input.identity.participant || row.participantId === input.identity.participant).map(row => item({
    id: row.id, title: row.title || w[row.kind], subtitle: row.date ? dateLabel(row.date) : "", summary: row.summary, meta: [row.participantName].filter(Boolean),
    action: { type: "route", route: "reflections", query: { id: row.id } } })) };
}

/** Personal sources return `null` for signed-out visitors so the block can offer sign-in instead of empty data. */
export async function readSource(source: RuntimeSource, input: SourceInput): Promise<SourceResult | null> {
  if (source === "activities.catalog") return activities(input);
  const db = input.identity.db;
  if (!db) return null;
  if (source === "account.bookings") return bookings(input, db);
  if (source === "account.tasks") return tasks(input, db);
  return reports(input, db);
}

type ScheduleRow = { session_id: string; student_id: string; classroom_name: string; lecture_name: string; scheduled_at: string; duration_min: number | null; teacher_name: string | null };

/** One Monday-to-Sunday week in Asia/Shanghai for the selected participant: classes and activity bookings. */
export async function readWeek(input: SourceInput, anchor: string): Promise<{ anchor: string; previous: string; next: string; days: RuntimeDay[]; items: RuntimeItem[] }> {
  const anchorStart = dateStart(anchor), weekday = (new Date(anchorStart + shanghai).getUTCDay() + 6) % 7, from = anchorStart - weekday * day, to = from + 7 * day;
  const today = shanghaiDate(input.now), participant = input.identity.participant, db = input.identity.db;
  let items: RuntimeItem[] = [];
  if (db && participant) {
    const [schedule, booked] = await Promise.all([
      db.rpc("get_my_schedule", { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() }),
      db.rpc("miniapp_my_bookings"),
    ]);
    const phase = (start: number, end: number | null): RuntimeItem["phase"] => end !== null && end <= input.now ? "ended" : start <= input.now ? "ongoing" : "upcoming";
    const labels = input.locale === "zh" ? { upcoming: "未开始", ongoing: "进行中", ended: "已结束", "": "" } : { upcoming: "Upcoming", ongoing: "In progress", ended: "Ended", "": "" };
    const status = (value: RuntimeItem["phase"]): RuntimeItem["status"] => value ? { label: labels[value], tone: value === "ended" ? "muted" : value === "ongoing" ? "positive" : "neutral" } : null;
    const sessions = ((requireResult(schedule) ?? []) as ScheduleRow[]).filter(row => row.student_id === participant).map(row => {
      const start = Date.parse(row.scheduled_at), end = row.duration_min === null ? null : start + row.duration_min * 60_000;
      return item({ id: "session-" + row.session_id, title: row.lecture_name, meta: [[row.classroom_name, row.teacher_name].filter(Boolean).join(" | ")],
        date: shanghaiDate(start), start: shanghaiTime(start), end: end === null ? "" : shanghaiTime(end), phase: phase(start, end), status: status(phase(start, end)) });
    });
    const activities = ((requireResult(booked) ?? []) as Booking[]).filter(row => row.participantId === participant && row.status !== "cancelled"
      && Date.parse(row.startsAt) >= from && Date.parse(row.startsAt) < to).map(row => {
      const start = Date.parse(row.startsAt);
      return item({ id: "activity-" + row.id, title: row.title[input.locale] || row.title.zh, meta: [row.location].filter(Boolean),
        tags: [input.locale === "zh" ? "活动安排" : "Activity"], date: shanghaiDate(start), start: shanghaiTime(start), phase: phase(start, null), status: status(phase(start, null)),
        action: { type: "route", route: "reservations" } });
    });
    items = [...sessions, ...activities].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shanghaiDate(from + index * day);
    return { date, day: String(Number(date.slice(8))), weekday: index, today: date === today, count: items.filter(row => row.date === date).length };
  });
  return { anchor, previous: shanghaiDate(from - 7 * day), next: shanghaiDate(to), days, items };
}
