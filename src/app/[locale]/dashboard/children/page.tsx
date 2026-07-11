import { getTranslations, setRequestLocale } from "next-intl/server";
import { getWeekSchedule } from "@/features/school/actions";
import { BindCodeForm } from "@/features/school/BindCodeForm";
import { getMyAttendance, getMyLearningSummary, getMyReviewedVideos, getMySessionReviews, getMyStudents } from "@/features/school/customer";
import { CustomerVideoButton } from "@/features/school/CustomerVideoButton";
import { summarizeAttendance } from "@/features/school/learning";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { addDays } from "@/features/school/schedule";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default async function ChildrenPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  await requireUser(locale);
  const [t, studentsT] = await Promise.all([getTranslations("school.customer"), getTranslations("school.students")]);

  const [students, summaries] = await Promise.all([getMyStudents(), getMyLearningSummary()]);

  if (students.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <SchoolPageHeader title={t("childrenTitle")} />
        <section className="mt-6 rounded-2xl border bg-card p-5">
          <p className="text-sm text-muted">{t("noChildren")}</p>
          <div className="mt-4">
            <BindCodeForm mode="guardian" />
          </div>
        </section>
      </div>
    );
  }

  const rawChild = rawSearchParams.child;
  const requestedId = Array.isArray(rawChild) ? rawChild[0] : rawChild;
  const activeId = students.some((s) => s.id === requestedId) ? requestedId! : students[0].id;
  const activeStudent = students.find((s) => s.id === activeId)!;
  const summary = summaries.find((s) => s.studentId === activeId) ?? null;

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
    <div className="mx-auto w-full max-w-4xl">
      <SchoolPageHeader title={t("childrenTitle")} />

      <nav className="mt-5 flex flex-wrap gap-2" aria-label={t("childrenTitle")}>
        {students.map((student) => (
          <Link
            key={student.id}
            href={`/dashboard/children?child=${student.id}`}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm transition",
              student.id === activeId ? "border-crater bg-crater/10 font-medium" : "border-line bg-background hover:border-crater",
            )}
          >
            {student.name}
          </Link>
        ))}
      </nav>

      <section className="mt-6 rounded-2xl border bg-card p-5">
        <h2 className="font-medium">{studentsT("recentReviews")}</h2>
        {reviewRows.filter(x=>x.studentId===activeId).length===0?<p className="mt-4 text-sm text-muted">{studentsT("noReviews")}</p>:<ul className="mt-4 divide-y">{reviewRows.filter(x=>x.studentId===activeId).map(r=>{const videos=reviewedVideos.filter(v=>v.sessionId===r.sessionId&&v.studentId===activeId);return <li key={r.sessionId} className="py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{r.classroomName} · {r.lectureName}</span><time className="text-xs text-muted">{new Intl.DateTimeFormat(locale,{dateStyle:"short"}).format(new Date(r.scheduledAt))}</time></div><p className="mt-1 text-xs text-muted">{studentsT("reviewScores",{entry:r.entryScore??"—",exit:r.exitScore??"—",focus:r.focus??"—",participation:r.participation??"—",mastery:r.mastery??"—"})}</p>{r.comment&&<p className="mt-2">{r.comment}</p>}{r.knowledgeSummary&&<p className="mt-2 rounded-lg bg-background p-2 text-xs text-muted">{r.knowledgeSummary}</p>}<div className="mt-2 flex gap-2">{videos.map(v=><CustomerVideoButton key={v.videoId} videoId={v.videoId}/>)}</div></li>})}</ul>}
      </section>

      <section className="mt-6 rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl">{activeStudent.name}</h2>
          {activeStudent.grade !== null && <span className="text-xs text-muted">{studentsT("grade", { grade: activeStudent.grade })}</span>}
        </div>
        {summary && (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="text-muted">{t("nextSession")}</dt><dd>{summary.nextSessionAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(summary.nextSessionAt)) : "-"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">{t("starTotal")}</dt><dd>{summary.starTotal}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">{t("paymentStatus")}</dt><dd>{t(`payment_${summary.paymentStatus}`)}</dd></div>
          </dl>
        )}
      </section>

      <section className="mt-6 rounded-2xl border bg-card p-5">
        <h2 className="font-medium">{studentsT("attendanceRate")}</h2>
        <div className="mt-4 rounded-lg bg-background p-3">
          <p className="text-lg font-medium tabular-nums">{attendance.total > 0 ? `${Math.round(attendance.rate * 100)}%` : "-"}</p>
          <p className="mt-1 text-xs text-muted">
            {studentsT("attendanceBreakdown", { present: attendance.present, absent: attendance.absent, late: attendance.late, leave: attendance.leave })}
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border bg-card p-5">
        <h2 className="font-medium">{studentsT("upcomingSessions")}</h2>
        {upcomingSessions.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{studentsT("noUpcoming")}</p>
        ) : (
          <ul className="mt-4 divide-y">
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
      </section>

      <section className="mt-6 rounded-2xl border bg-card p-5">
        <h2 className="font-medium">{studentsT("submissions")}</h2>
        {!summary || summary.recentSubmissions.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{studentsT("noSubmissions")}</p>
        ) : (
          <ul className="mt-4 divide-y">
            {summary.recentSubmissions.map((submission, i) => (
              <li key={`${submission.title}-${i}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate">{submission.title}</span>
                <span className="shrink-0 text-xs text-muted">{submission.score === null ? studentsT("ungraded") : submission.score}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
