import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { SessionWorkspaceDetail } from "./classes";
import { SessionFamilyBriefForm } from "./SessionFamilyBriefForm";

export async function SessionFamilyBriefPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");

  if (!detail.capabilities.canWriteReview) {
    if (!detail.familyBrief.publishedAt) return null;
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
        <Badge variant={detail.familyBrief.publishedAt ? "default" : "outline"}>
          {detail.familyBrief.publishedAt ? t("published") : t("draft")}
        </Badge>
      </div>
      <SessionFamilyBriefForm sessionId={detail.id} brief={detail.familyBrief} />
      {detail.familyBrief.publishedAt && (
        <p className="mt-3 text-xs text-muted">
          {t("knowledgeSummaryPublishedAt", { date: new Date(detail.familyBrief.publishedAt).toLocaleString() })}
        </p>
      )}
    </section>
  );
}
