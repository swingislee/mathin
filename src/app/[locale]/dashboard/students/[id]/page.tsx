import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { getStudentAccount, getStudentOrders } from "@/features/school/finance";
import { FollowUpForm } from "@/features/school/FollowUpForm";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { listStaffMembers } from "@/features/school/staff";
import { StudentFinancePanel } from "@/features/school/StudentFinancePanel";
import { StudentLifecycleActions } from "@/features/school/StudentLifecycleActions";
import { StudentProfileEditor } from "@/features/school/StudentProfileEditor";
import { CustomerVideoButton } from "@/features/school/CustomerVideoButton";
import { getStudentDetail, getStudentLearning } from "@/features/school/students";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StudentDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["student.view.all", "student.view.assigned"]);
  if (!UUID_PATTERN.test(id)) notFound();

  const [t, student, learning, perms] = await Promise.all([
    getTranslations("school.students"),
    getStudentDetail(id),
    getStudentLearning(id),
    getMyPerms(user.id),
  ]);
  if (!student) notFound();

  const assignees = perms.has("student.assign")
    ? (await listStaffMembers()).filter((member) => member.canFollowUp).map((member) => ({ userId: member.userId, displayName: member.displayName }))
    : [];

  const showFinance = perms.has("finance.order.view");
  const [orders, account] = showFinance
    ? await Promise.all([getStudentOrders(id), getStudentAccount(id)])
    : [[], { studentId: id, balance: 0, ledger: [] }];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <SchoolPageHeader
        title={student.name}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StudentLifecycleActions
              studentId={id}
              status={student.status}
              assignedTo={student.assignedTo}
              deleted={Boolean(student.deletedAt)}
              canEdit={perms.has("student.edit")}
              canAssign={perms.has("student.assign")}
              canDelete={perms.has("student.delete")}
              assignees={assignees}
            />
            <Link href={student.deletedAt ? "/dashboard/students?tab=recycle" : "/dashboard/students"} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              {t("back")}
            </Link>
          </div>
        }
      >
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>
            {student.grade ? t("grade", { grade: student.grade }) : "-"} · {t(student.status)} · {t(student.followUpStatus)}
          </span>
          <span className="rounded-full bg-line/60 px-3 py-1 font-mono text-xs text-muted">{student.bindCode}</span>
        </div>
      </SchoolPageHeader>

      {student.deletedAt && (
        <div className="mt-6 rounded-xl border border-rose/30 bg-rose/5 p-4 text-sm text-rose">
          {t("deletedBanner", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(student.deletedAt)) })}
        </div>
      )}

      <div className="mt-6">
        <StudentProfileEditor student={student} canEdit={perms.has("student.edit")} />
      </div>

      {perms.has("followup.view") && (
        <section className="mt-6 rounded-xl border border-line bg-card p-5">
          <h2 className="font-medium">{t("followUps")}</h2>
          {perms.has("followup.write") && !student.deletedAt && <FollowUpForm studentId={id} />}
          {student.followUps.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("noFollowUps")}</p>
          ) : (
            <ol className="mt-4 divide-y divide-line">
              {student.followUps.map((followUp) => (
                <li key={followUp.id} className="py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{followUp.authorName || t("none")}</span>
                    <span className="rounded-full bg-line/50 px-2 py-0.5">{t(`followUpKind_${followUp.kind}`)}</span>
                    <time>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(followUp.createdAt))}</time>
                    {followUp.statusAfter && <span className="text-crater">→ {t(followUp.statusAfter)}</span>}
                    {followUp.nextFollowUpAt && (
                      <span>
                        {t("nextFollowUp")}{" "}
                        {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(followUp.nextFollowUpAt))}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap">{followUp.content}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section className="mt-6 rounded-xl border border-line bg-card p-5">
        <h2 className="font-medium">{t("learning")}</h2>

        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-xs text-muted">{t("enrollments")}</h3>
            {learning.enrollments.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{t("noEnrollments")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {learning.enrollments.map((enrollment) => (
                  <li key={`${enrollment.classroomId}-${enrollment.joinedAt}`} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate">
                      {enrollment.classroomName}
                      {enrollment.courseTitle ? ` · ${enrollment.courseTitle}` : ""}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{t(enrollment.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs text-muted">{t("upcomingSessions")}</h3>
            {learning.upcomingSessions.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{t("noUpcoming")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {learning.upcomingSessions.map((session) => (
                  <li key={session.sessionId} className="py-1.5">
                    <time className="text-xs text-muted">
                      {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.scheduledAt))}
                    </time>
                    <span className="ml-2">
                      {session.classroomName} · {session.lectureName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-background p-3">
            <p className="text-xs text-muted">{t("attendanceRate")}</p>
            <p className="mt-1 text-lg font-medium">{Math.round(learning.attendance.rate * 100)}%</p>
            <p className="mt-1 text-xs text-muted">
              {t("attendanceBreakdown", {
                present: learning.attendance.present,
                absent: learning.attendance.absent,
                late: learning.attendance.late,
                leave: learning.attendance.leave,
              })}
            </p>
          </div>
          <div className="rounded-lg bg-background p-3">
            <p className="text-xs text-muted">{t("starTotal")}</p>
            <p className="mt-1 text-lg font-medium">{learning.hasAccount ? learning.starTotal : "-"}</p>
            {!learning.hasAccount && <p className="mt-1 text-xs text-muted">{t("noAccountAttendanceOnly")}</p>}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-xs text-muted">{t("sessionVideos")}</h3>{learning.videos.length===0?<p className="mt-2 text-sm text-muted">{t("noVideos")}</p>:<ul className="mt-2 divide-y">{learning.videos.map(v=><li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{v.lectureName}</span><span className="text-xs text-muted">{v.reviewedAt?t("videoReviewed",{score:v.reviewScore??"—"}):t("videoPending")}</span><CustomerVideoButton videoId={v.id}/></li>)}</ul>}
        </div>

        <div className="mt-6">
          <h3 className="text-xs text-muted">{t("recentReviews")}</h3>
          {learning.reviews.length===0?<p className="mt-2 text-sm text-muted">{t("noReviews")}</p>:<ul className="mt-2 divide-y divide-line">{learning.reviews.map(r=><li key={r.sessionId} className="py-2 text-sm"><div className="flex justify-between"><span className="font-medium">{r.lectureName}</span>{r.scheduledAt&&<time className="text-xs text-muted">{new Intl.DateTimeFormat(locale,{dateStyle:"short"}).format(new Date(r.scheduledAt))}</time>}</div><p className="mt-1 text-xs text-muted">{t("reviewScores",{entry:r.entryScore??"—",exit:r.exitScore??"—",focus:r.focus??"—",participation:r.participation??"—",mastery:r.mastery??"—"})}</p>{r.comment&&<p className="mt-1">{r.comment}</p>}</li>)}</ul>}
        </div>

        <div className="mt-6">
          <h3 className="text-xs text-muted">{t("submissions")}</h3>
          {learning.submissions.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t("noSubmissions")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {learning.submissions.map((submission) => (
                <li key={submission.assignmentId} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">{submission.assignmentTitle || t("untitledAssignment")}</span>
                  <span className="shrink-0 text-xs text-muted">{submission.score === null ? t("ungraded") : submission.score}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {showFinance && (
        <StudentFinancePanel
          studentId={id}
          orders={orders}
          account={account}
          perms={{
            canCreateOrder: perms.has("finance.order.create"),
            canRecordPayment: perms.has("finance.payment.record"),
            canRequestRefund: perms.has("finance.refund.request"),
            canApproveRefund: perms.has("finance.refund.approve"),
            canGrantScholarship: perms.has("finance.scholarship.grant"),
            canAdjustAccount: perms.has("finance.account.adjust"),
          }}
        />
      )}
    </div>
  );
}
