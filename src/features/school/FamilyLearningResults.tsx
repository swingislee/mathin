import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { CustomerVideoButton } from "./CustomerVideoButton";
import { KnowledgeSummaryDocumentView } from "./SessionFamilyBriefClient";
import type {
  MyKnowledgeSummary,
  MySessionReview,
  MySessionReviewState,
  MyStageReport,
} from "./customer";

export async function FamilyLearningResults({
  locale,
  knowledgeSummaries,
  reviews,
  states,
  videos,
  stageReports,
}: {
  locale: string;
  knowledgeSummaries: MyKnowledgeSummary[];
  reviews: MySessionReview[];
  states: MySessionReviewState[];
  videos: Array<{
    videoId: string;
    sessionId: string;
    studentId: string;
    score: number | null;
    comment: string;
  }>;
  stageReports: MyStageReport[];
}) {
  const t = await getTranslations("school.students");
  const reviewBySession = new Map(reviews.map((review) => [review.sessionId, review]));
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const shortDateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "short" });

  if (
    knowledgeSummaries.length === 0
    && states.length === 0
    && videos.length === 0
    && stageReports.length === 0
  ) {
    return <p className="text-sm text-muted">{t("noLearningResults")}</p>;
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium text-ink">{t("stageReports")}</h3>
        {stageReports.length === 0 ? (
          <p className="mt-2 text-xs text-muted">{t("noStageReports")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {stageReports.map((report) => (
              <li key={report.headId} className="py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{report.title}</p>
                    <p className="mt-1 text-xs text-muted">
                      {t("reportPeriod", {
                        from: dateFormatter.format(new Date(report.periodStart + "T00:00:00")),
                        to: dateFormatter.format(new Date(report.periodEnd + "T00:00:00")),
                      })}
                    </p>
                  </div>
                  <Badge variant="default">{t("reviewStatus_published")}</Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{report.summary}</p>
                {report.teacherComment && <p className="mt-2 text-xs text-muted">{report.teacherComment}</p>}
                <p className="mt-2 text-xs text-muted">
                  {report.metricVersion === "mathin-learning-report-v1"
                    ? t("metricVersionMathinLearningReportV1")
                    : report.metricVersion}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium text-ink">{t("knowledgeSummaries")}</h3>
        {knowledgeSummaries.length === 0 ? (
          <p className="mt-2 text-xs text-muted">{t("noKnowledgeSummaries")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {knowledgeSummaries.map((summary) => (
              <li key={summary.headId} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-ink">
                    {summary.classroomName} · {summary.lessonTitle || summary.lectureName}
                  </p>
                  <time className="text-xs text-muted">{shortDateFormatter.format(new Date(summary.scheduledAt))}</time>
                </div>
                {summary.document.length > 0 ? (
                  <KnowledgeSummaryDocumentView document={summary.document} />
                ) : (
                  <p className="mt-2 whitespace-pre-wrap">{summary.learningSummary}</p>
                )}
                {summary.materialsNote && <p className="mt-2 text-xs text-muted">{summary.materialsNote}</p>}
                {summary.teacherPublicComment && <p className="mt-2 text-xs text-muted">{summary.teacherPublicComment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium text-ink">{t("sessionReviews")}</h3>
        {states.length === 0 ? (
          <p className="mt-2 text-xs text-muted">{t("noReviews")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {states.map((state) => {
              const review = reviewBySession.get(state.sessionId);
              const publishedReview = state.availabilityState === "published" ? review : undefined;
              return (
                <li key={state.studentId + ":" + state.sessionId} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-medium">{state.classroomName} · {state.lectureName}</span>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={state.availabilityState === "published"
                          ? "default"
                          : state.availabilityState === "pending" ? "secondary" : "outline"}
                      >
                        {t("reviewStatus_" + state.availabilityState)}
                      </Badge>
                      <time className="text-xs text-muted">{shortDateFormatter.format(new Date(state.scheduledAt))}</time>
                    </div>
                  </div>
                  {publishedReview ? (
                    <>
                      <p className="mt-1 text-xs text-muted">
                        {t("reviewScores", {
                          entry: publishedReview.entryScore ?? "—",
                          exit: publishedReview.exitScore ?? "—",
                          focus: publishedReview.focus ?? "—",
                          participation: publishedReview.participation ?? "—",
                          mastery: publishedReview.mastery ?? "—",
                        })}
                      </p>
                      {publishedReview.comment && <p className="mt-2">{publishedReview.comment}</p>}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-muted">{t("reviewStatusHint_" + state.availabilityState)}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium text-ink">{t("videoReviews")}</h3>
        {videos.length === 0 ? (
          <p className="mt-2 text-xs text-muted">{t("noVideoReviews")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {videos.map((video) => (
              <li key={video.videoId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <CustomerVideoButton videoId={video.videoId} />
                <span className="text-xs text-muted">
                  {video.score === null ? t("videoReviewed") : t("videoReviewScore", { score: video.score })}
                </span>
                {video.comment && <span className="min-w-0 flex-1 text-xs text-muted">{video.comment}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
