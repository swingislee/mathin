import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readReports, requireResult } from "@/features/parent-portal/server";
import { activityCatalogGet } from "../activity-detail-server";
import { activityPageImageUrl } from "../../../../contracts/participant-api/activity-detail";
import type { ActivityOffer, ActivityTask, Booking } from "../../../../contracts/participant-api/portal";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import type { ExperienceRequest } from "../../../../contracts/participant-api/experience-runtime";
import type { RuntimeAccountRole, RuntimeDay, RuntimeFacet, RuntimeItem, RuntimeLocale, RuntimeSource } from "../../../../contracts/participant-api/runtime";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";

const hour = 3_600_000, day = 24 * hour, shanghai = 8 * hour;
export const shanghaiDate = (ms: number) => new Date(ms + shanghai).toISOString().slice(0, 10);
export const shanghaiTime = (ms: number) => new Date(ms + shanghai).toISOString().slice(11, 16);
const dateStart = (value: string) => Date.parse(value + "T00:00:00+08:00");
export const validDate = (value: string | null) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateStart(value)) && shanghaiDate(dateStart(value)) === value;

export type RuntimeIdentity = {
  signedIn: boolean; db: SupabaseClient | null; name: string; participants: { id: string; name: string; stage?: number | null }[];
  participant: string | null; stage: number | null;
  role?: RuntimeAccountRole | null;
};
/** Filters are keyed by facet id; `cursor` continues a list and `params` come from the block. */
export type SourceInput = { identity: RuntimeIdentity; locale: RuntimeLocale; settings: MiniappSettings; filters: Record<string, string>; now: number;
  cursor?: string; params?: Record<string, string> };
export type SourceResult = { items: RuntimeItem[]; facets: RuntimeFacet[]; next?: string };

export const item = (value: Partial<RuntimeItem> & Pick<RuntimeItem, "id" | "title">): RuntimeItem => ({
  subtitle: "", summary: "", meta: [], tags: [], image: "", status: null, actionLabel: "", action: null, date: "", start: "", end: "", phase: "", ...value,
});
const words = {
  zh: { stage: "参与者阶段", topic: "活动标签", stageHint: "按参与者阶段查看适合的公益活动", topicHint: "按活动标签筛选", allStages: "全部阶段", allTopics: "全部标签", booked: "待参与", attended: "已参与", no_show: "未参与", cancelled: "已取消",
    due: "截止", submitted: "已提交", pending: "待提交", assessment: "诊断报告", feedback: "活动反馈", search: "搜索活动", searchHint: "输入活动名称或地点",
    requestSubmitted: "已提交", requestConfirmed: "已受理", requestCompleted: "已完成", requestCancelled: "已取消", requestDeclined: "未受理" },
  en: { stage: "Participant stage", topic: "Activity tag", stageHint: "Find activities for the participant's stage", topicHint: "Filter by activity tag", allStages: "All stages", allTopics: "All tags", booked: "Upcoming", attended: "Attended", no_show: "Not attended", cancelled: "Cancelled",
    due: "Due", submitted: "Submitted", pending: "To submit", assessment: "Assessment report", feedback: "Activity feedback", search: "Search", searchHint: "Activity name or place",
    requestSubmitted: "Submitted", requestConfirmed: "Accepted", requestCompleted: "Completed", requestCancelled: "Cancelled", requestDeclined: "Declined" },
};
const dateLabel = (value: string) => shanghaiDate(Date.parse(value)).replaceAll("-", ".");
export const dateTimeLabel = (value: string) => `${dateLabel(value)} ${shanghaiTime(Date.parse(value))}`;

async function activities(input: SourceInput): Promise<SourceResult> {
  const response = await activityCatalogGet();
  const offers = await response.json() as ActivityOffer[];
  const w = words[input.locale];
  const stages = input.settings.stages.flatMap(group => group.stages.filter(stage => stage.visible).map(stage => ({ ...stage, group: group.label[input.locale] || group.label.zh })));
  const stage = stages.find(row => row.id === input.filters.stage);
  const open = offers.filter(row => row.kind === "activity" && row.activity && Date.parse(row.bookingClosesAt) > input.now);
  const topics = [...new Set(open.flatMap(row => row.tags ?? []))];
  const topic = topics.includes(input.filters.topic || "") ? input.filters.topic! : "";
  const search = (input.filters.q || "").trim().toLowerCase().slice(0, 40);
  const rows = open.filter(row => !stage || !Array.isArray(row.activity!.targetStages) || !row.activity!.targetStages.length || row.activity!.targetStages.includes(stage.stageNumber))
    .filter(row => !topic || (row.tags ?? []).includes(topic))
    .filter(row => !search || [row.title, row.activity!.location, row.listing?.summary].some(value => (value || "").toLowerCase().includes(search)))
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
      { id: "q", kind: "search", label: w.search, hint: w.searchHint, value: search, valueLabel: search, options: [] },
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

/** Requests and messages sent from forms, newest first, with the staff note as the reply. */
async function requests(input: SourceInput, db: SupabaseClient): Promise<SourceResult> {
  const page = Math.max(1, Math.min(1000, Number.parseInt(input.cursor || "1", 10) || 1));
  const rows = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_experience_requests", { p_page: page })) as ExperienceRequest[];
  const w = words[input.locale], form = input.params?.form;
  const status = { submitted: [w.requestSubmitted, "warning"], confirmed: [w.requestConfirmed, "positive"], completed: [w.requestCompleted, "neutral"],
    cancelled: [w.requestCancelled, "muted"], declined: [w.requestDeclined, "muted"] } as const;
  const text = (value: { zh: string; en: string } | undefined) => value?.[input.locale] || value?.zh || "";
  return { facets: [], next: rows.length === 30 ? String(page + 1) : "", items: rows.filter(row => !form || row.formId === form).map(row => item({
    id: row.id, title: text(row.serviceName), subtitle: dateTimeLabel(row.createdAt), summary: row.note || "",
    status: { label: status[row.status][0], tone: status[row.status][1] }, date: shanghaiDate(Date.parse(row.createdAt)),
    side: row.note ? "start" : "end", action: { type: "route", route: "experience-requests" } })) };
}

/** Records made by runtime commands such as check-ins; `params.command` chooses which. */
async function events(input: SourceInput, db: SupabaseClient): Promise<SourceResult> {
  const command = input.params?.command || "checkin";
  let query = db.from("miniapp_runtime_events").select("id,participant_id,command,payload,created_at").eq("command", command).order("created_at", { ascending: false }).limit(30);
  if (input.identity.participant) query = query.eq("participant_id", input.identity.participant);
  const rows = (requireResult(await query) ?? []) as { id: string; created_at: string; payload: Record<string, unknown> }[];
  return { facets: [], items: rows.map(row => item({ id: row.id, title: typeof row.payload.title === "string" ? row.payload.title : command,
    subtitle: dateTimeLabel(row.created_at), date: shanghaiDate(Date.parse(row.created_at)), start: shanghaiTime(Date.parse(row.created_at)) })) };
}

/** Personal sources return `null` for signed-out visitors so the block can offer sign-in instead of empty data. */
export async function readSource(source: RuntimeSource, input: SourceInput): Promise<SourceResult | null> {
  if (source === "activities.catalog") return activities(input);
  const db = input.identity.db;
  if (!db) return null;
  switch (source) {
    case "account.bookings": return bookings(input, db);
    case "account.tasks": return tasks(input, db);
    case "account.requests": return requests(input, db);
    case "account.events": return events(input, db);
    default: return reports(input, db);
  }
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
