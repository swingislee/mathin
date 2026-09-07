import { getTranslations } from "next-intl/server";
import { CustomerVideoButton } from "./CustomerVideoButton";
import { FollowUpForm } from "./FollowUpForm";
import { ImportedHistoryStudentLink } from "./ImportedHistoryStudentLink";
import { BusinessHistorySections } from "./BusinessHistorySections";
import { loadStudentBusinessHistory } from "./student-business-history-data";
import { getStudentBusinessHistoryMessages } from "./student-business-history-messages";
import { Link } from "@/i18n/navigation";
import { DashboardSection } from "./dashboard-page";
import { StageReportPanel } from "./StageReportPanel";
import type { SchoolTermRow } from "./courses";
import type { StaffLearningResult } from "./learning-results";
import type { StudentDetail, StudentLearning } from "./students";
import { loadStudentSourceContext } from './source-use-data';
import { sourceFollowupHref, sourceUseMessages } from './source-use-contract';

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
    <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

export async function StudentFollowUpsTab({
  student,
  locale,
  canWrite,
  sourceRecordId,
}: {
  student: StudentDetail;
  locale: string;
  canWrite: boolean;
  sourceRecordId?: string;
}) {
  const t = await getTranslations("school.students");
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const shortFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const history = await loadStudentBusinessHistory(locale, { studentId: student.id, kind: "communication" });
  const historyMessages = getStudentBusinessHistoryMessages(locale);
  const hasHistory = !!history?.communications.length;
  const sourceContext=sourceRecordId?await loadStudentSourceContext(locale,student.id,sourceRecordId):null;
  const sourceM=sourceUseMessages(locale);

  return (
    <div className="space-y-6">
      {sourceRecordId?<DashboardSection title={sourceM.sourceContext}>
        {sourceContext?<details open className="text-sm"><summary className="cursor-pointer font-medium">{sourceContext.title}</summary>
          <p className="my-2 break-words text-xs text-muted">{sourceContext.source}</p>
          <dl className="max-h-72 space-y-3 overflow-y-auto">{sourceContext.cells.map((cell,index)=><div key={index}><dt className="text-xs text-muted">{cell.name}</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-6">{cell.text}</dd></div>)}</dl>
        </details>:<p role="alert" className="text-sm text-muted">{sourceM.associationRequired}</p>}
      </DashboardSection>:null}
      {hasHistory && <>
        <Link href={`/dashboard/students/${student.id}?tab=history`} className="text-sm underline underline-offset-4">{historyMessages.historyLink}</Link>
        <BusinessHistorySections data={history!} locale={locale} kind="communication" />
      </>}
    <DashboardSection title={hasHistory ? historyMessages.currentFollowup : t("followUps")}>
      {canWrite && (!sourceRecordId||sourceContext) && <FollowUpForm studentId={student.id} currentStatus={student.followUpStatus} contextSourceRecordId={sourceRecordId} />}
      {!hasHistory && <ImportedHistoryStudentLink studentId={student.id} locale={locale} />}
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
              {followUp.contextSourceRecordId?<Link href={sourceFollowupHref(student.id,followUp.contextSourceRecordId)} className="mt-2 inline-block text-xs text-muted underline underline-offset-4">{sourceM.sourceSaved}</Link>:null}
            </li>
          ))}
        </ol>
      )}
    </DashboardSection>
    </div>
  );
}

/** 学习：阶段报告与其证据工作区。报名、排课、账号和跟进由各自工作流承载。 */
export async function StudentLearningTab({
  studentId,
  learning,
  stageReports,
  terms,
  canWriteStageReports,
  initialReportId,
}: {
  studentId: string;
  learning: StudentLearning;
  locale: string;
  stageReports: StaffLearningResult[];
  terms: SchoolTermRow[];
  canWriteStageReports: boolean;
  initialReportId?: string;
}) {
  return (
    <StageReportPanel
      studentId={studentId}
      reports={stageReports}
      terms={terms}
      learning={learning}
      canWrite={canWriteStageReports}
      initialReportId={initialReportId}
    />
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
