import { classroomRehearsalHref, classroomScheduleBounds } from "@/features/classroom/preparation/schedule-contract";
import type { ClassRosterSession } from "./class-roster-session-contract";

type EntrySession = Omit<ClassRosterSession, "attendanceCount" | "reviewCount">;
export type ClassRosterEntry = { session: EntrySession; mode: "enter" | "resume" | "rehearse"; href: string };
export const CLASSROOM_ENTRY_LEAD_MS = 30 * 60_000;

/** 只决定导航模式；授课权限与正式开课确认继续由现有服务端负责。 */
export function classSessionEntry(session: EntrySession, now: number): ClassRosterEntry | null {
  const capabilities = session.capabilities;
  if (!capabilities?.canEnterLive && !capabilities?.canRehearse) return null;
  const path = "/classroom/" + session.classroomId + "/session/" + session.id + "/live";
  if (!session.endedAt && session.startedAt && capabilities.canEnterLive) return { session, mode: "resume", href: path };
  const bounds = classroomScheduleBounds({ scheduledAt: session.scheduledAt, durationMin: session.durationMin ?? null });
  if (!session.endedAt && capabilities.canEnterLive && bounds && now >= bounds.start - CLASSROOM_ENTRY_LEAD_MS && now < bounds.end) {
    return { session, mode: "enter", href: path + "?entry=prep" };
  }
  return { session, mode: "rehearse", href: classroomRehearsalHref(path, "", "session") };
}

/** 优先正在上课、临近开课；其余选择最近待上课次试讲，最后才回到历史课次。 */
export function classRosterEntry(sessions: readonly ClassRosterSession[], now: number): ClassRosterEntry | null {
  const entries = sessions.map(session => classSessionEntry(session, now)).filter((entry): entry is ClassRosterEntry => entry !== null);
  const byStart = (a: ClassRosterEntry, b: ClassRosterEntry) =>
    (a.session.scheduledAt ?? "9999").localeCompare(b.session.scheduledAt ?? "9999") || a.session.id.localeCompare(b.session.id);
  entries.sort(byStart);
  return entries.find(entry => entry.mode === "resume")
    ?? entries.find(entry => entry.mode === "enter")
    ?? entries.find(entry => !entry.session.endedAt && (entry.session.scheduledAt === null || Date.parse(entry.session.scheduledAt) >= now))
    ?? entries.filter(entry => !entry.session.endedAt).at(-1)
    ?? entries.at(-1)
    ?? null;
}
