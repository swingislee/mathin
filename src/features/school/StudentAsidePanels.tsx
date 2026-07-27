import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { DashboardSummaryCard } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import type { StudentDetail, StudentLearning } from "./students";

/**
 * 学生详情侧栏（doc 23 §11）。
 *
 * 旧版的 Aside 放的是三个**操作**面板（监护邀请、可见范围、档案合并）——侧栏被
 * 当成"塞不下的表单往这儿放"，于是这一页没有任何地方回答"这个学生现在是什么情况"。
 * 那些操作现在各归其位（监护人 tab / 档案维护区），侧栏改为跨 tab 不变的稳定摘要。
 */

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-ink">{value}</dd>
    </div>
  );
}

export async function StudentSummary({ student, ownerName }: { student: StudentDetail; ownerName: string | null }) {
  const t = await getTranslations("school.students");
  return (
    <DashboardSummaryCard title={t("summaryTitle")}>
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        <Row label={t("statusLabel")} value={<Badge variant="secondary">{t(student.status)}</Badge>} />
        <Row label={t("gradeLabel")} value={student.grade ? t("grade", { grade: student.grade }) : t("none")} />
        <Row label={t("followUpStatusLabel")} value={t(student.followUpStatus)} />
        <Row label={t("summaryOwner")} value={ownerName ?? t("none")} />
        <Row label={t("summarySource")} value={student.source || t("none")} />
        <Row label={t("summaryRegion")} value={student.region || t("none")} />
        <Row label={t("summarySchool")} value={student.school || t("none")} />
      </dl>
    </DashboardSummaryCard>
  );
}

/** 下一次跟进：取最近一条约定了下次时间的跟进记录。 */
export async function StudentNextFollowUp({ student, locale }: { student: StudentDetail; locale: string }) {
  const t = await getTranslations("school.students");
  const next = student.followUps.find((followUp) => followUp.nextFollowUpAt !== null);
  return (
    <DashboardSummaryCard title={t("nextFollowUpTitle")}>
      {!next?.nextFollowUpAt ? (
        <p className="mt-2 text-sm text-muted">{t("nextFollowUpNone")}</p>
      ) : (
        <div className="mt-2 text-sm">
          <p className="text-ink">
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(next.nextFollowUpAt))}
          </p>
          <p className="mt-1 line-clamp-3 text-muted">{next.content}</p>
        </div>
      )}
    </DashboardSummaryCard>
  );
}

export async function StudentCurrentClasses({ enrollments }: { enrollments: StudentLearning["enrollments"] }) {
  const t = await getTranslations("school.students");
  const active = enrollments.filter((enrollment) => enrollment.status === "active");
  return (
    <DashboardSummaryCard title={t("currentClassesTitle")}>
      {active.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("currentClassesNone")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {active.map((enrollment) => (
            <li key={`${enrollment.classroomId}-${enrollment.joinedAt}`} className="min-w-0">
              <Link href={`/dashboard/classes/${enrollment.classroomId}`} className="block truncate text-ink hover:text-crater">
                {enrollment.classroomName}
              </Link>
              {enrollment.courseTitle ? <span className="block truncate text-xs text-muted">{enrollment.courseTitle}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </DashboardSummaryCard>
  );
}

/**
 * 账号与风险。绑定码从页头 meta 挪到这里：它是"家长还没绑上"时才用得着的一次性凭据，
 * 放在标题旁边等于让每次打开档案都先看一眼一串没人关心的字符。
 */
export async function StudentAccountStatus({
  student,
  learning,
}: {
  student: StudentDetail;
  learning: StudentLearning;
}) {
  const t = await getTranslations("school.students");
  // 只放**信号**，不放学情指标：出勤率、星星是"学习"Tab 的内容，在侧栏再显示一次
  // 就是同一屏两份同样的数字（§15）。这里回答的是"有没有需要立刻处理的异常"。
  const absences = learning.attendance.absent;
  const ungraded = learning.submissions.filter((submission) => submission.score === null).length;

  return (
    <DashboardSummaryCard title={t("accountStatusTitle")}>
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        <Row
          label={t("accountLabel")}
          value={student.userId ? <Badge variant="secondary">{t("accountLinked")}</Badge> : <Badge variant="outline">{t("accountMissing")}</Badge>}
        />
        {!student.userId && <Row label={t("bindCode")} value={<span className="font-mono text-xs">{student.bindCode}</span>} />}
        <Row label={t("absentCount")} value={<span className={absences > 0 ? "text-rose" : undefined}>{absences}</span>} />
        <Row label={t("ungradedCount")} value={<span className={ungraded > 0 ? "text-amber-700 dark:text-amber-300" : undefined}>{ungraded}</span>} />
      </dl>
    </DashboardSummaryCard>
  );
}
