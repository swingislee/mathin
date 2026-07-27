import { getTranslations } from "next-intl/server";
import { CustomerVideoButton } from "./CustomerVideoButton";
import { FollowUpForm } from "./FollowUpForm";
import type { StudentDetail, StudentLearning } from "./students";

/**
 * 学生档案各 Tab 的正文（doc 23 §11）。
 *
 * 原来这一切是主栏里一条连续的纵向长卷：档案编辑器 → 跟进 → 一张把报名、未来课次、
 * 出勤、星星、视频、课评、作业全塞进去的"学习"大卡 → 财务。这条长卷有两个问题：
 * 找任何一件事都要滚，而"学习"卡里那七块内容彼此并没有关系——视频审阅和作业成绩
 * 之所以在一起，只是因为当初都没别的地方放。
 *
 * 现在按**做什么事**分区，不是把整页塞进一个 Tab（§15 明确禁止那种做法）。
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

export async function StudentFollowUpsTab({
  student,
  locale,
  canWrite,
}: {
  student: StudentDetail;
  locale: string;
  canWrite: boolean;
}) {
  const t = await getTranslations("school.students");
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const shortFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <Section title={t("followUps")}>
      {canWrite && <FollowUpForm studentId={student.id} currentStatus={student.followUpStatus} />}
      {student.followUps.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("noFollowUps")}</p>
      ) : (
        <ol className="mt-4 divide-y divide-line">
          {student.followUps.map((followUp) => (
            <li key={followUp.id} className="py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{followUp.authorName || t("none")}</span>
                <span className="rounded-full bg-line/50 px-2 py-0.5">{t(`followUpKind_${followUp.kind}`)}</span>
                <time>{formatter.format(new Date(followUp.createdAt))}</time>
                {followUp.statusAfter && <span className="text-crater">→ {t(followUp.statusAfter)}</span>}
                {followUp.nextFollowUpAt && (
                  <span>
                    {t("nextFollowUp")} {shortFormatter.format(new Date(followUp.nextFollowUpAt))}
                  </span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap">{followUp.content}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** 学习：报名、未来课次、出勤与课评。视频拆到自己的 Tab——那是一条独立的审阅工作流。 */
export async function StudentLearningTab({ learning, locale }: { learning: StudentLearning; locale: string }) {
  const t = await getTranslations("school.students");
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const shortDate = new Intl.DateTimeFormat(locale, { dateStyle: "short" });

  return (
    <>
      <Section title={t("enrollments")}>
        {learning.enrollments.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("noEnrollments")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
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
      </Section>

      <Section title={t("upcomingSessions")}>
        {learning.upcomingSessions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("noUpcoming")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {learning.upcomingSessions.map((session) => (
              <li key={session.sessionId} className="py-1.5">
                <time className="text-xs text-muted">{dateTime.format(new Date(session.scheduledAt))}</time>
                <span className="ml-2">{session.classroomName} · {session.lectureName}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("attendanceRate")}>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-2xl font-medium tabular-nums text-ink">{Math.round(learning.attendance.rate * 100)}%</p>
            <p className="mt-1 text-xs text-muted">
              {t("attendanceBreakdown", {
                present: learning.attendance.present,
                absent: learning.attendance.absent,
                late: learning.attendance.late,
                leave: learning.attendance.leave,
              })}
            </p>
          </div>
          <div>
            <p className="text-2xl font-medium tabular-nums text-ink">{learning.hasAccount ? learning.starTotal : "—"}</p>
            <p className="mt-1 text-xs text-muted">{learning.hasAccount ? t("starTotal") : t("noAccountAttendanceOnly")}</p>
          </div>
        </div>
      </Section>

      <Section title={t("recentReviews")}>
        {learning.reviews.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("noReviews")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {learning.reviews.map((review) => (
              <li key={review.sessionId} className="py-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{review.lectureName}</span>
                  {review.scheduledAt && <time className="shrink-0 text-xs text-muted">{shortDate.format(new Date(review.scheduledAt))}</time>}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t("reviewScores", {
                    entry: review.entryScore ?? "—",
                    exit: review.exitScore ?? "—",
                    focus: review.focus ?? "—",
                    participation: review.participation ?? "—",
                    mastery: review.mastery ?? "—",
                  })}
                </p>
                {review.comment && <p className="mt-1">{review.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("submissions")}>
        {learning.submissions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("noSubmissions")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {learning.submissions.map((submission) => (
              <li key={submission.assignmentId} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">{submission.assignmentTitle || t("untitledAssignment")}</span>
                <span className="shrink-0 text-xs text-muted">{submission.score === null ? t("ungraded") : submission.score}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export async function StudentVideosTab({ videos }: { videos: StudentLearning["videos"] }) {
  const t = await getTranslations("school.students");
  return (
    <Section title={t("sessionVideos")}>
      {videos.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("noVideos2")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {videos.map((video) => (
            <li key={video.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{video.lectureName}</span>
              <span className="text-xs text-muted">
                {video.reviewedAt ? t("videoReviewed", { score: video.reviewScore ?? "—" }) : t("videoPending")}
              </span>
              <CustomerVideoButton videoId={video.id} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
