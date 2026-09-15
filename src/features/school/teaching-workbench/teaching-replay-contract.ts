import { z } from "zod";
import { teachingRecordsSchema, type TeachingRecords } from "./teaching-records-contract";
import { teachingClassOverviewSchema, type TeachingClassOverview, type TeachingRecordSnippet } from "./teaching-class-overview-contract";
import { hasWrittenReview, summarizeTeachingObservations } from "./teaching-learning-summary";
import { calendarDayKey } from "../schedule";

export const TEACHING_REPLAY_ID = "2026-09-07";
export const teachingReplaySchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), source: z.literal("production"), capturedAt: z.string(), timeZone: z.literal("Asia/Shanghai"),
  from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }),
  terms: z.array(z.object({ id: z.string().uuid(), year: z.number().int(), term: z.number().int().min(1).max(4), startsOn: z.string().nullable(), endsOn: z.string().nullable(), isCurrent: z.boolean() })).default([]),
  teachers: z.array(z.object({ id: z.string().uuid(), name: z.string() })).min(1).max(100),
  sessions: teachingClassOverviewSchema.shape.workbench.shape.sessions.max(1000),
  records: z.record(z.string().uuid(), teachingRecordsSchema),
}).superRefine((value, context) => {
  const span = Date.parse(value.to) - Date.parse(value.from);
  if (span <= 0 || span > 366 * 86400000 || value.version === 1 && (value.from !== "2026-09-06T16:00:00.000Z" || value.to !== "2026-09-13T16:00:00.000Z")) {
    context.addIssue({ code: "custom", message: "REPLAY_PERIOD_MISMATCH", path: ["from"] });
  }
});
export type TeachingReplay = z.infer<typeof teachingReplaySchema>;
export function teachingReplayAllowed(nodeEnv: string | undefined, origin: string | undefined, perms: ReadonlySet<string>) {
  return nodeEnv === "development" && origin === "http://127.0.0.1:35421" && perms.has("class.view.all") && perms.has("followup.view");
}
export function selectTeachingReplay(snapshot: TeachingReplay, window: { start: string; end: string }) {
  const start = Date.parse(window.start); const end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 366 * 86400000) throw new Error("REPLAY_PERIOD_MISMATCH");
  const fromDay = calendarDayKey(new Date(start), snapshot.timeZone); const toDay = calendarDayKey(new Date(end), snapshot.timeZone);
  const sessions = snapshot.sessions.filter(session => Date.parse(session.scheduledAt) >= start && Date.parse(session.scheduledAt) < end);
  const records = Object.fromEntries(sessions.map(session => {
    const record = snapshot.records[session.id];
    const contacts = record.contacts.filter(contact => contact.createdAt && Date.parse(contact.createdAt) >= start && Date.parse(contact.createdAt) < end
      || contact.occurredOn && contact.occurredOn >= fromDay && contact.occurredOn < toDay);
    return [session.id, { ...record, contacts, contactTotal: contacts.length, contactPage: 1 }];
  }));
  const coverage = start >= Date.parse(snapshot.from) && end <= Date.parse(snapshot.to) ? "full"
    : start >= Date.parse(snapshot.to) || end <= Date.parse(snapshot.from) ? "none" : "partial";
  return { snapshot: { ...snapshot, sessions, records }, coverage };
}
export function teachingReplayOverview(snapshot: TeachingReplay): TeachingClassOverview {
  const classContacts = new Map<string, TeachingRecords["contacts"]>();
  const metrics = snapshot.sessions.map(session => {
    const data = snapshot.records[session.id];
    if (!data || data.session.id !== session.id || data.session.classroomId !== session.classroomId) throw new Error("REPLAY_RECORD_MISMATCH");
    const scheduled = new Date(session.scheduledAt).getTime();
    if (!Number.isFinite(scheduled) || scheduled < Date.parse(snapshot.from) || scheduled >= Date.parse(snapshot.to)) throw new Error("REPLAY_PERIOD_MISMATCH");
    const names = new Map(data.students.map(student => [student.id, student.name]));
    const reviews = data.reviews.filter(hasWrittenReview);
    const latest = reviews.filter(review => review.comment.trim()).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    classContacts.set(session.classroomId, [...(classContacts.get(session.classroomId) ?? []), ...data.contacts]);
    return { sessionId: session.id, studentIds: data.students.map(student => student.id),
      attendance: { marked: data.attendance.length, present: data.attendance.filter(item => ["present", "late"].includes(item.status)).length,
        late: data.attendance.filter(item => item.status === "late").length, absent: data.attendance.filter(item => item.status === "absent").length, leave: data.attendance.filter(item => item.status === "leave").length },
      checkCount: data.checks.length, ratedCount: data.results.length,
      attentionStudents: [...new Set(data.results.filter(result => ["prompted", "imitated", "incomplete"].includes(result.status)).map(result => result.studentId))].map(id => ({ id, name: names.get(id) ?? "" })),
      reviewCount: reviews.length, latestReview: latest ? { content: latest.comment.slice(0, 240), studentName: names.get(latest.studentId) ?? "", author: latest.author, at: latest.updatedAt } : null,
      observations: summarizeTeachingObservations(data),
    };
  });
  const names = new Map(Object.values(snapshot.records).flatMap(data => data.students.map(student => [student.id, student.name] as const)));
  return { workbench: { sessions: snapshot.sessions, truncated: false }, canReadContacts: true, metrics,
    classContacts: [...classContacts].map(([classroomId, records]) => {
      const contacts = [...new Map(records.map(record => [record.id, record])).values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
      const latest = contacts[0];
      const snippet: TeachingRecordSnippet | null = latest ? { content: latest.content.slice(0, 96), studentName: names.get(latest.studentId) ?? "", author: latest.author, at: latest.createdAt, eventDate: latest.occurredOn } : null;
      return { classroomId, count: contacts.length, studentCount: new Set(contacts.map(record => record.studentId)).size, latest: snippet };
    }),
  };
}
export function teachingReplayDetail(snapshot: TeachingReplay, sessionId: string, requestedPage: number, pageSize: 10 | 20) {
  if (!snapshot.sessions.some(session => session.id === sessionId)) throw new Error("REPLAY_SESSION_NOT_FOUND");
  const data = snapshot.records[sessionId];
  const page = Math.min(Math.max(1, requestedPage), Math.max(1, Math.ceil(data.contacts.length / pageSize)));
  return { ...data, reviews: data.reviews.filter(hasWrittenReview), contactPage: page, contactTotal: data.contacts.length, contacts: data.contacts.slice((page - 1) * pageSize, page * pageSize) };
}
