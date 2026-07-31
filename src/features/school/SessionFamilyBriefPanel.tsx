import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { SessionWorkspaceDetail } from "./classes";
import { SessionFamilyBriefForm } from "./SessionFamilyBriefForm";

export async function SessionFamilyBriefPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");
  const summaryResults = detail.learningResults.filter((result) => result.kind === "knowledge_summary");
  const statuses = new Set(summaryResults.map((result) => result.status));
  const resultStatus = statuses.size === 1
    ? summaryResults[0].status
    : statuses.has("revised")
      ? "revised"
      : statuses.has("withdrawn")
        ? "withdrawn"
        : statuses.has("review")
          ? "review"
          : statuses.has("published")
            ? "published"
            : detail.familyBrief.publishedAt
              ? "published"
              : "draft";
  const latestPublishedAt = summaryResults
    .flatMap((result) => result.publishedAt ? [result.publishedAt] : [])
    .sort()
    .at(-1) ?? detail.familyBrief.publishedAt;

  if (!detail.capabilities.canWriteReview) {
    if (resultStatus !== "published") return null;
    return (
      <section className="rounded-2xl border border-line bg-card p-4 text-sm">
        <h3 className="font-medium text-ink">{detail.familyBrief.lessonTitle || t("knowledgeSummaryTitle")}</h3>
        <p className="mt-2 whitespace-pre-wrap text-muted">{detail.familyBrief.learningSummary}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4 text-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-ink">{t("knowledgeSummaryTitle")}</h3>
          <p className="mt-1 text-xs text-muted">{t("knowledgeSummaryHint")}</p>
        </div>
        <Badge variant={resultStatus === "published" ? "default" : "outline"}>
          {t(`learningResultStatus_${resultStatus}`)}
        </Badge>
      </div>
      <SessionFamilyBriefForm
        sessionId={detail.id}
        brief={detail.familyBrief}
        resultStatus={resultStatus}
      />
      {latestPublishedAt && (
        <p className="mt-3 text-xs text-muted">
          {t("knowledgeSummaryPublishedAt", { date: new Date(latestPublishedAt).toLocaleString() })}
        </p>
      )}
    </section>
  );
}
