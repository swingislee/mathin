import "server-only";
import { z } from "zod";
import { requireResult } from "@/features/parent-portal/server";
import { item, dateTimeLabel, type SourceInput, type SourceResult } from "./sources";

type Lesson = { session_id: string; student_id: string; classroom_id: string; classroom_name: string; lecture_name: string; scheduled_at: string; duration_min: number | null; teacher_name: string | null };
type Notice = { id: string; occurred_at: string; read_at: string | null; notification_key: string; payload: unknown };
const uuid = z.string().uuid();
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const copy = (value: unknown, locale: "zh" | "en") => typeof value === "string" ? value : typeof record(value)[locale] === "string" ? String(record(value)[locale]) : "";
const search = (input: SourceInput) => (input.filters.q || "").trim().slice(0, 60).toLocaleLowerCase();
const searchFacet = (input: SourceInput) => ({ id: "q", kind: "search" as const, label: input.locale === "zh" ? "搜索" : "Search", hint: input.locale === "zh" ? "搜索名称或内容" : "Search names or content", value: search(input), valueLabel: search(input), options: [] });
function paged(items: SourceResult["items"], input: SourceInput, facets: SourceResult["facets"] = []): SourceResult {
  const start = input.cursor ? Math.max(0, items.findIndex(row => row.id === input.cursor) + 1) : 0;
  const visible = items.slice(start, start + (input.limit ?? 30));
  return { items: visible, facets, next: start + visible.length < items.length ? visible.at(-1)?.id : "" };
}

export async function schoolSource(source: string, input: SourceInput): Promise<SourceResult> {
  const { db, participant } = input.identity, zh = input.locale === "zh";
  if (!db) return { items: [], facets: [] };
  if (source === "account.notifications" || source === "account.notice") {
    const user = await db.auth.getUser(); if (!user.data.user) return { items: [], facets: [] };
    const detail = source === "account.notice", id = uuid.safeParse(input.params?.noticeId);
    if (detail && !id.success) return { items: [], facets: [] };
    let query = db.from("notifications").select("id,occurred_at,read_at,notification_key,payload").eq("recipient_id", user.data.user.id).is("archived_at", null);
    if (detail && id.success) query = query.eq("id", id.data);
    if (input.params?.unread === "true") query = query.is("read_at", null);
    const rows = (requireResult(await query.order("occurred_at", { ascending: false }).order("id").limit(100)) ?? []) as Notice[];
    const items = rows.map(n => {
      const p = record(n.payload), title = copy(p.title, input.locale) || copy(p.sessionTitle, input.locale) || (zh ? "学习通知" : "Learning notification");
      const body = copy(p.body, input.locale) || copy(p.message, input.locale) || "";
      return item({ id: n.id, title, subtitle: dateTimeLabel(n.occurred_at), summary: body, image: "asset:icons/message",
        meta: [copy(p.studentName, input.locale), copy(p.classroomName, input.locale)].filter(Boolean),
        status: n.read_at ? null : { label: zh ? "未读" : "Unread", tone: "warning" },
        actionLabel: detail ? n.read_at ? "" : zh ? "标为已读" : "Mark as read" : "",
        action: detail ? n.read_at ? null : { type: "command", command: "notifications.read", params: { noticeId: n.id } }
          : { type: "screen", screen: "learning-notice", params: { noticeId: n.id } } });
    }).filter(n => !search(input) || [n.title, n.summary, ...n.meta].join(" ").toLocaleLowerCase().includes(search(input)));
    return paged(items, input, detail ? [] : [searchFacet(input)]);
  }
  if (!participant) return { items: [], facets: [] };
  const span = 365 * 86400000;
  const all = (requireResult(await db.rpc("get_my_schedule", { p_from: new Date(input.now - span).toISOString(), p_to: new Date(input.now + span).toISOString() })) ?? []) as Lesson[];
  const rows = all.filter(r => r.student_id === participant).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.session_id.localeCompare(b.session_id));
  if (source === "account.lessons") {
    const classroom = uuid.safeParse(input.params?.classroomId);
    if (!classroom.success) return { items: [], facets: [] };
    return paged(rows.filter(r => r.classroom_id === classroom.data).map(r => item({ id: r.session_id, title: r.lecture_name, subtitle: dateTimeLabel(r.scheduled_at), date: r.scheduled_at.slice(0,10),
      meta: [r.classroom_name, r.teacher_name || ""].filter(Boolean),
      status: { label: Date.parse(r.scheduled_at) > input.now ? (zh ? "待上课" : "Upcoming") : (zh ? "已到课次时间" : "Past lesson time"), tone: Date.parse(r.scheduled_at) > input.now ? "positive" : "muted" },
      action: { type: "screen", screen: "calendar" } })), input);
  }
  const groups = new Map<string, Lesson[]>();
  for (const r of rows) groups.set(r.classroom_id, [...(groups.get(r.classroom_id) || []), r]);
  return paged([...groups].filter(([, group]) => !search(input) || group[0].classroom_name.toLocaleLowerCase().includes(search(input)))
    .map(([id, group]) => {
      const next = group.find(r => Date.parse(r.scheduled_at) > input.now), last = group.at(-1)!;
      return item({ id, title: group[0].classroom_name, subtitle: `${next ? (zh ? "下次课 " : "Next ") : (zh ? "最近课次 " : "Latest ")}${dateTimeLabel((next || last).scheduled_at)}`,
        summary: (next || last).lecture_name, meta: [(next || last).teacher_name || ""].filter(Boolean), image: "asset:icons/book",
        actionLabel: zh ? "查看课次" : "View lessons", action: { type: "screen", screen: "course-lessons", params: { classroomId: id } } });
    }), input, [searchFacet(input)]);
}
