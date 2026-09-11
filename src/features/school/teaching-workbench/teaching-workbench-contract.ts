import { z } from "zod";
import { addCalendarDays, calendarDayKey, dateTimeInputToInstant, startOfMonth, startOfWeek, zonedDateParts, zonedDateTimeToInstant } from "../schedule";
import type { WorkItemRow } from "../stage/types";

export const ARTIFACT_KINDS = ["solution", "lesson_plan", "rehearsal_video"] as const;
export const PROGRESS_FILTERS = ["all", "preparation", "postwork", "contact", "overdue"] as const;
export type ProgressFilter = (typeof PROGRESS_FILTERS)[number];
export type TeachingPeriod = "week" | "month";

const artifactSchema = z.object({
  status: z.enum(["missing", "draft", "pending", "approved", "changes_requested"]),
  submittedAt: z.string().nullable(),
});
const taskSchema = z.object({
  id: z.string(), source: z.enum(["postwork", "support"]), kind: z.string(),
  status: z.enum(["pending", "done", "skipped"]), required: z.boolean(),
  dueAt: z.string().nullable(), assignedTo: z.string().nullable(),
  assigneeName: z.string().nullable(), completedAt: z.string().nullable(),
});
export const teachingWorkbenchSchema = z.object({
  truncated: z.boolean(),
  sessions: z.array(z.object({
    id: z.string(), classroomId: z.string(), classroomName: z.string(), title: z.string(),
    scheduledAt: z.string(), startedAt: z.string().nullable(), endedAt: z.string().nullable(),
    postworkCompletedAt: z.string().nullable(), preparationStatus: z.string(),
    preparedAt: z.string().nullable(), autoFrozen: z.boolean(), canOpenPreparation: z.boolean(),
    teachers: z.array(z.object({ id: z.string(), name: z.string() })),
    artifacts: z.object({ solution: artifactSchema, lesson_plan: artifactSchema, rehearsal_video: artifactSchema }),
    tasks: z.array(taskSchema),
  })),
});
export type TeachingWorkbenchData = z.infer<typeof teachingWorkbenchSchema>;
export type TeachingSession = TeachingWorkbenchData["sessions"][number];
export type TeachingTask = TeachingSession["tasks"][number];
export type ArtifactStatus = z.infer<typeof artifactSchema>["status"];

export function teachingWorkItems(items: readonly WorkItemRow[]) {
  return items.filter(item => item.domain === "teaching"
    || (item.domain === "student_service" && item.kind === "support.task"));
}

export function isContactTask(task: TeachingTask) {
  return task.source === "support" || task.kind === "followup";
}

export function taskCounts(tasks: readonly TeachingTask[]) {
  return {
    total: tasks.length,
    done: tasks.filter(task => task.status === "done").length,
    skipped: tasks.filter(task => task.status === "skipped").length,
    pending: tasks.filter(task => task.status === "pending").length,
  };
}

export function preparationSubmitted(session: TeachingSession) {
  return ARTIFACT_KINDS.every(kind => ["pending", "approved"].includes(session.artifacts[kind].status));
}

export function preparationDueAt(session: TeachingSession) {
  return new Date(new Date(session.scheduledAt).getTime() - 7 * 86_400_000);
}

export function sessionNeedsAttention(session: TeachingSession, filter: ProgressFilter, now: Date) {
  if (filter === "all") return true;
  if (filter === "preparation") return !preparationSubmitted(session);
  if (filter === "postwork") return Boolean(session.endedAt) && (
    !session.postworkCompletedAt || session.tasks.some(task => !isContactTask(task) && task.status === "pending")
  );
  if (filter === "contact") return session.tasks.some(task => isContactTask(task) && task.status === "pending");
  return (!preparationSubmitted(session) && preparationDueAt(session) < now)
    || session.tasks.some(task => task.status === "pending" && task.dueAt !== null && new Date(task.dueAt) < now);
}

export function summarizeTeachingSessions(sessions: readonly TeachingSession[], now: Date) {
  return {
    sessions: sessions.length,
    submitted: sessions.filter(preparationSubmitted).length,
    approved: sessions.filter(session => ARTIFACT_KINDS.every(kind => session.artifacts[kind].status === "approved")).length,
    ended: sessions.filter(session => session.endedAt).length,
    postwork: sessions.filter(session => session.endedAt && session.postworkCompletedAt).length,
    contact: taskCounts(sessions.flatMap(session => session.tasks.filter(isContactTask))),
    overdue: sessions.filter(session => sessionNeedsAttention(session, "overdue", now)).length,
  };
}

export function summarizeTeachingByTeacher(sessions: readonly TeachingSession[], now: Date) {
  const groups = new Map<string, { id: string; name: string; sessions: TeachingSession[] }>();
  for (const session of sessions) {
    for (const teacher of session.teachers.length ? session.teachers : [{ id: "unassigned", name: "" }]) {
      const group = groups.get(teacher.id) ?? { ...teacher, sessions: [] };
      group.sessions.push(session);
      groups.set(teacher.id, group);
    }
  }
  return [...groups.values()].map(group => ({ ...group, summary: summarizeTeachingSessions(group.sessions, now) }))
    .sort((a, b) => b.summary.overdue - a.summary.overdue || a.name.localeCompare(b.name));
}

export function teachingPeriodWindow(period: TeachingPeriod, date: string | undefined, timeZone: string, now = new Date()) {
  const anchor = date ? dateTimeInputToInstant(`${date}T12:00`, timeZone) ?? now : now;
  const start = period === "month" ? startOfMonth(anchor, timeZone) : startOfWeek(anchor, timeZone);
  const parts = zonedDateParts(start, timeZone);
  const shiftMonth = (offset: number) => {
    const shifted = new Date(Date.UTC(parts.year, parts.month + offset, 1));
    return zonedDateTimeToInstant({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: 1 }, timeZone);
  };
  const end = period === "month" ? shiftMonth(1) : addCalendarDays(start, 7, timeZone);
  return {
    start: start.toISOString(), end: end.toISOString(),
    date: calendarDayKey(start, timeZone),
    lastDate: calendarDayKey(addCalendarDays(end, -1, timeZone), timeZone),
    previous: calendarDayKey(period === "month" ? shiftMonth(-1) : addCalendarDays(start, -7, timeZone), timeZone),
    next: calendarDayKey(end, timeZone),
  };
}
