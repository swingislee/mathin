import { getTranslations, setRequestLocale } from "next-intl/server";
import { getWeekSchedule } from "@/features/school/actions/schedule";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { canManageGuardianScopes, getMyAttendance, getMyLearningSummary, getMyReviewedVideos, getMySessionReviews, getMyStudents } from "@/features/school/customer";
import { GuardianScopePanel } from "@/features/school/GuardianScopePanel";
import { CustomerVideoButton } from "@/features/school/CustomerVideoButton";
import { summarizeAttendance } from "@/features/school/learning";
import {
  DashboardAside,
  DashboardCard,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardContentGrid,
  DashboardMainColumn,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { addDays } from "@/features/school/schedule";
import { requireDashboardEnvironment } from "@/lib/auth";

export default async function ChildrenPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["family"]);
  const [t, studentsT] = await Promise.all([getTranslations("school.customer"), getTranslations("school.students")]);

  const [students, summaries] = await Promise.all([getMyStudents(), getMyLearningSummary()]);

  if (students.length === 0) {
    return (
      <DashboardPage title={t("childrenTitle")}>
        <DashboardContentGrid>
          <DashboardMainColumn>
            <DashboardCard>
              <p className="text-sm text-muted">{t("noChildren")}</p>
              <div className="mt-4">
                <BindCodeForm mode="guardian" />
              </div>
            </DashboardCard>
          </DashboardMainColumn>
        </DashboardContentGrid>
      </DashboardPage>
    );
  }

  const rawChild = rawSearchParams.child;
  const requestedId = Array.isArray(rawChild) ? rawChild[0] : rawChild;
  const activeId = students.some((s) => s.id === requestedId) ? requestedId! : students[0].id;
  const activeStudent = students.find((s) => s.id === activeId)!;
  const summary = summaries.find((s) => s.studentId === activeId) ?? null;
  const canManageGuardians=await canManageGuardianScopes(activeId);

  const now = new Date();
  const [scheduleEntries, attendanceRows, reviewRows, reviewedVideos] = await Promise.all([
    getWeekSchedule(now.toISOString(), addDays(now, 30).toISOString()),
    getMyAttendance(addDays(now, -60).toISOString(), now.toISOString()),
    getMySessionReviews(addDays(now,-180).toISOString(),now.toISOString()),
    getMyReviewedVideos(),
  ]);
  const upcomingSessions = scheduleEntries.filter((entry) => entry.studentName === activeStudent.name);
  const attendance = summarizeAttendance(
    attendanceRows.filter((row) => row.studentName === activeStudent.name).map((row) => row.status),
  );

  return (
    <DashboardPage
      title={t("childrenTitle")}
      commandPanel={
        <DashboardCommandPanel>
          <DashboardCommandState>
            <DashboardCommandTabs
              ariaLabel={t("childrenTitle")}
              activeValue={activeId}
              items={students.map((student) => ({
                value: student.id,
                label: student.name,
                href: `/dashboard/children?child=${student.id}`,
              }))}
            />
          </DashboardCommandState>
        </DashboardCommandPanel>
      }
      summary={
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-card/35 px-3 py-2.5 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="font-display text-lg text-ink">{activeStudent.name}</dt>
            {activeStudent.grade !== null && <dd className="text-xs text-muted">{studentsT("grade", { grade: activeStudent.grade })}</dd>}
          </div>
          {summary && (
            <>
              <div className="flex items-center gap-2"><dt className="text-muted">{t("nextSession")}</dt><dd>{summary.nextSessionAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(summary.nextSessionAt)) : "-"}</dd></div>
              <div className="flex items-center gap-2"><dt className="text-muted">{t("starTotal")}</dt><dd>{summary.starTotal}</dd></div>
              <div className="flex items-center gap-2"><dt className="text-muted">{t("paymentStatus")}</dt><dd>{t(`payment_${summary.paymentStatus}`)}</dd></div>
            </>
          )}
        </dl>
      }
    >
      {/* §22.3：顶部概要（summary）+ 主次列。课评是家长真正在看的内容，走主列；
          出勤/课表/作业/监护人权限是围绕它的旁证，收进侧栏。 */}
      <DashboardContentGrid>
      <DashboardMainColumn className="space-y-6">
      <DashboardCard title={studentsT("recentReviews")}>
        {reviewRows.filter(x=>x.studentId===activeId).length===0?<p className="text-sm text-muted">{studentsT("noReviews")}</p>:<ul className="divide-y">{reviewRows.filter(x=>x.studentId===activeId).map(r=>{const videos=reviewedVideos.filter(v=>v.sessionId===r.sessionId&&v.studentId===activeId);return <li key={r.sessionId} className="py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{r.classroomName} · {r.lectureName}</span><time className="text-xs text-muted">{new Intl.DateTimeFormat(locale,{dateStyle:"short"}).format(new Date(r.scheduledAt))}</time></div><p className="mt-1 text-xs text-muted">{studentsT("reviewScores",{entry:r.entryScore??"—",exit:r.exitScore??"—",focus:r.focus??"—",participation:r.participation??"—",mastery:r.mastery??"—"})}</p>{r.comment&&<p className="mt-2">{r.comment}</p>}{r.knowledgeSummary&&<p className="mt-2 rounded-lg bg-line/40 p-2 text-xs text-muted">{r.knowledgeSummary}</p>}<div className="mt-2 flex gap-2">{videos.map(v=><CustomerVideoButton key={v.videoId} videoId={v.videoId}/>)}</div></li>})}</ul>}
      </DashboardCard>
      </DashboardMainColumn>

      <DashboardAside className="space-y-6">
      {canManageGuardians&&<GuardianScopePanel studentId={activeId}/>}

      <DashboardCard title={studentsT("attendanceRate")}>
        <div className="rounded-lg bg-line/40 p-3">
          <p className="text-lg font-medium tabular-nums">{attendance.total > 0 ? `${Math.round(attendance.rate * 100)}%` : "-"}</p>
          <p className="mt-1 text-xs text-muted">
            {studentsT("attendanceBreakdown", { present: attendance.present, absent: attendance.absent, late: attendance.late, leave: attendance.leave })}
          </p>
        </div>
      </DashboardCard>

      <DashboardCard title={studentsT("upcomingSessions")}>
        {upcomingSessions.length === 0 ? (
          <p className="text-sm text-muted">{studentsT("noUpcoming")}</p>
        ) : (
          <ul className="divide-y">
            {upcomingSessions.map((session) => (
              <li key={session.sessionId} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <time className="shrink-0 text-xs text-muted">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(session.scheduledAt))}
                </time>
                <span className="min-w-0 flex-1 truncate font-medium">{session.classroomName}</span>
                <span className="shrink-0 text-xs text-muted">{session.lectureName}</span>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>

      <DashboardCard title={studentsT("submissions")}>
        {!summary || summary.recentSubmissions.length === 0 ? (
          <p className="text-sm text-muted">{studentsT("noSubmissions")}</p>
        ) : (
          <ul className="divide-y">
            {summary.recentSubmissions.map((submission, i) => (
              <li key={`${submission.title}-${i}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate">{submission.title}</span>
                <span className="shrink-0 text-xs text-muted">{submission.score === null ? studentsT("ungraded") : submission.score}</span>
              </li>
            ))}
          </ul>
        )}
      </DashboardCard>
      </DashboardAside>
      </DashboardContentGrid>
    </DashboardPage>
  );
}
