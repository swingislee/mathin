import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getWeekSchedule } from "@/features/school/actions/schedule";
import {
  getMyAttendance,
  getMyStudents,
  listMySessionLeaveRequests,
} from "@/features/school/customer";
import {
  DashboardCard,
  DashboardContentGrid,
  DashboardEmptyCard,
  DashboardMainColumn,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { LeaveRequestPanel } from "@/features/school/LeaveRequestPanel";
import { summarizeAttendance } from "@/features/school/learning";
import { addDays } from "@/features/school/schedule";
import { requireDashboardEnvironment } from "@/lib/auth";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function CourseworkPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["learning"]);
  const [t, studentsT] = await Promise.all([
    getTranslations("school.customer"),
    getTranslations("school.students"),
  ]);
  const students = await safe(getMyStudents, []);
  const studentId = students[0]?.id ?? null;
  const now = new Date();
  const [scheduleRows, attendanceRows, leaveRequests] = studentId
    ? await Promise.all([
        safe(() => getWeekSchedule(now.toISOString(), addDays(now, 30).toISOString()), []),
        safe(() => getMyAttendance(addDays(now, -60).toISOString(), now.toISOString()), []),
        safe(listMySessionLeaveRequests, []),
      ])
    : [[], [], []];
  const schedule = scheduleRows.filter((row) => row.studentId === studentId);
  const attendanceHistory = attendanceRows.filter((row) => row.studentId === studentId);
  const attendance = summarizeAttendance(attendanceHistory.map((row) => row.status));
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <DashboardPage title={t("courseworkTitle")} description={t("courseworkIntro")}>
      <DashboardContentGrid>
        <DashboardMainColumn className="space-y-6">
          {!studentId ? (
            <DashboardCard>
              <p className="text-sm text-muted">{t("notBound")}</p>
              <div className="mt-4"><BindCodeForm mode="claim" /></div>
            </DashboardCard>
          ) : (
            <>
              <DashboardCard title={studentsT("upcomingSessions")}>
                {schedule.length === 0 ? (
                  <DashboardEmptyCard>{studentsT("noUpcoming")}</DashboardEmptyCard>
                ) : (
                  <ul className="divide-y divide-line">
                    {schedule.slice(0, 12).map((session) => (
                      <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                        <time className="shrink-0 font-mono text-xs text-muted">{dateTime.format(new Date(session.scheduledAt))}</time>
                        <span className="min-w-0 flex-1 truncate font-medium">{session.classroomName}</span>
                        <span className="shrink-0 text-xs text-muted">{session.lectureName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </DashboardCard>

              <div id="attendance" className="scroll-mt-24">
                <DashboardCard title={studentsT("attendanceRate")}>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <p className="text-2xl font-medium tabular-nums">
                      {attendance.total > 0 ? `${Math.round(attendance.rate * 100)}%` : "—"}
                    </p>
                    <p className="text-xs text-muted">
                      {studentsT("attendanceBreakdown", {
                        present: attendance.present,
                        absent: attendance.absent,
                        late: attendance.late,
                        leave: attendance.leave,
                      })}
                    </p>
                  </div>
                  {attendanceHistory.length === 0 ? (
                    <p className="mt-4 text-sm text-muted">{t("attendanceEmpty")}</p>
                  ) : (
                    <ul className="mt-4 divide-y divide-line border-t border-line">
                      {attendanceHistory.slice(0, 12).map((row) => (
                        <li key={row.sessionId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                          <time className="shrink-0 text-xs text-muted">{dateTime.format(new Date(row.scheduledAt))}</time>
                          <span className="min-w-0 flex-1 truncate">{row.classroomName} · {row.lectureName}</span>
                          <Badge variant={row.status === "present" ? "secondary" : row.status === "leave" ? "outline" : "danger"}>
                            {t(`attendance_${row.status}`)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </DashboardCard>
              </div>

              <LeaveRequestPanel
                studentId={studentId}
                sessions={schedule.map((session) => ({
                  id: session.sessionId,
                  label: `${dateTime.format(new Date(session.scheduledAt))} · ${session.classroomName} · ${session.lectureName}`,
                }))}
                requests={leaveRequests.filter((request) => request.studentId === studentId)}
              />
            </>
          )}
        </DashboardMainColumn>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
