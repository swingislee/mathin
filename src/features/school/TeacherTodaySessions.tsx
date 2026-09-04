import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { AttendanceDrawer } from "./AttendanceDrawer";
import { DashboardEmptyCard, DashboardTableShell } from "./dashboard-page";
import { formatRoomLocation } from "./location-format";
import { withReturnTo } from "./object-workspace/return-target";
import type { TeacherSessionOperation } from "./teacher-session-operations-contract";

function sessionStatusKey(state: TeacherSessionOperation["state"]): "statusEnded" | "statusLive" | "statusScheduled" | "statusCancelled" | "statusVoided" {
  if (state === "ended") return "statusEnded";
  if (state === "started") return "statusLive";
  if (state === "cancelled") return "statusCancelled";
  if (state === "voided") return "statusVoided";
  return "statusScheduled";
}

function canOperateAttendance(session: TeacherSessionOperation, canMarkAttendance: boolean): boolean {
  return canMarkAttendance && session.rosterCount > 0 && session.state !== "cancelled" && session.state !== "voided";
}

export async function TeacherTodaySessions({
  sessions,
  timeZone,
  locale,
  canMarkAttendance,
  returnTo,
  compact = false,
}: {
  sessions: readonly TeacherSessionOperation[];
  timeZone: string;
  locale: string;
  canMarkAttendance: boolean;
  returnTo: string;
  compact?: boolean;
}) {
  const [workT, classesT, sessionT, scheduleT] = await Promise.all([
    getTranslations("school.work"),
    getTranslations("school.classes"),
    getTranslations("school.session"),
    getTranslations("school.schedule"),
  ]);
  const timeFormatter = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" });

  if (sessions.length === 0) {
    return compact
      ? <p className="text-sm text-muted">{workT("todayEmpty")}</p>
      : <DashboardEmptyCard>{workT("todayEmpty")}</DashboardEmptyCard>;
  }

  const sessionHref = (sessionId: string) => withReturnTo(`/dashboard/sessions/${sessionId}`, returnTo);
  const rosterHref = (classroomId: string) => withReturnTo(`/dashboard/classes/${classroomId}?tab=students`, returnTo);
  const attendanceProgress = (session: TeacherSessionOperation) => session.rosterCount === 0
    ? classesT("emptyRoster")
    : `${classesT("attendanceRecorded")} ${session.attendanceRecordedCount}/${session.rosterCount}`;

  if (compact) {
    return (
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {sessions.map((session) => (
          <li key={session.sessionId} className="flex min-w-0 items-center gap-2 px-3 py-2.5">
            <Link href={sessionHref(session.sessionId)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 transition hover:bg-line/20">
              <span className="w-12 shrink-0 tabular-nums text-muted">{timeFormatter.format(new Date(session.scheduledAt))}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{session.classroomName}</span>
                <span className="block truncate text-[11px] text-muted">
                  {session.lectureName || classesT("untitledSession")} · {attendanceProgress(session)}
                  {session.attendanceHistoryMismatchCount > 0 ? ` · ${classesT("rosterCompositeAnomaly", { count: session.attendanceHistoryMismatchCount })}` : ""}
                </span>
              </span>
              <Badge variant="secondary" className="hidden shrink-0 @2xl/page:inline-flex">{classesT(sessionStatusKey(session.state))}</Badge>
            </Link>
            {canOperateAttendance(session, canMarkAttendance) ? (
              <AttendanceDrawer
                sessionId={session.sessionId}
                mode={session.attendanceRecordedCount > 0 ? "amend" : "initial"}
              />
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <DashboardTableShell data-teacher-today-sessions>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">{classesT("sessionScheduledAt")}</TableHead>
            <TableHead>{classesT("title")}</TableHead>
            <TableHead className="w-36">{sessionT("rosterCount")}</TableHead>
            <TableHead className="w-40">{classesT("markAttendance")}</TableHead>
            <TableHead className="w-32"><span className="sr-only">{classesT("openSessionWorkspace")}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.sessionId}>
              <TableCell>
                <span className="block font-medium tabular-nums text-ink">{timeFormatter.format(new Date(session.scheduledAt))}</span>
                <span className="block max-w-40 truncate text-[11px] text-muted">
                  {formatRoomLocation(session.roomName, session.campusName, scheduleT("roomTbd"))}
                </span>
              </TableCell>
              <TableCell>
                <Link href={sessionHref(session.sessionId)} className="inline-flex min-w-0 max-w-full items-center gap-1 font-medium text-ink hover:underline">
                  <span className="truncate">{session.classroomName} · {session.lectureName || classesT("untitledSession")}</span>
                  <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
                </Link>
                <span className="mt-1 block"><Badge variant="secondary">{classesT(sessionStatusKey(session.state))}</Badge></span>
              </TableCell>
              <TableCell>
                <Link href={rosterHref(session.classroomId)} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
                  {classesT("roster", { count: session.rosterCount })}
                </Link>
              </TableCell>
              <TableCell>
                <span className={cn("text-sm tabular-nums", session.attendanceComplete ? "text-leaf-deep" : "text-muted")}>
                  {attendanceProgress(session)}
                </span>
                {session.attendanceHistoryMismatchCount > 0 ? (
                  <span className="mt-1 block text-[11px] text-rose">
                    {classesT("rosterCompositeAnomaly", { count: session.attendanceHistoryMismatchCount })}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-right">
                {canOperateAttendance(session, canMarkAttendance) ? (
                  <AttendanceDrawer
                    sessionId={session.sessionId}
                    mode={session.attendanceRecordedCount > 0 ? "amend" : "initial"}
                    appearance={session.attendanceComplete ? "secondary" : "primary"}
                  />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}
