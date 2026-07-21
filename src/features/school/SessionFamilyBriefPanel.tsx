import { getTranslations } from "next-intl/server";
import type { SessionWorkspaceDetail } from "./classes";
import { SessionFamilyBriefForm } from "./SessionFamilyBriefForm";

/** 家庭摘要发布入口（doc19 §16.5）：发布后只读展示，不是"完成本次课"的前置条件。 */
export async function SessionFamilyBriefPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");

  if (detail.familyBrief.publishedAt) {
    return (
      <section className="rounded-2xl border border-line bg-card p-4 text-sm">
        <h3 className="mb-2 text-xs font-medium uppercase text-muted">{t("familyBriefTitle")}</h3>
        <p className="text-ink">{detail.familyBrief.lessonTitle || t("familyBriefUntitled")}</p>
        <p className="mt-1 text-xs text-muted">
          {t("familyBriefPublishedAt", { date: new Date(detail.familyBrief.publishedAt).toLocaleString() })}
        </p>
      </section>
    );
  }

  if (!detail.capabilities.canWriteReview) return null;

  return (
    <section className="rounded-2xl border border-line bg-card p-4 text-sm">
      <h3 className="mb-3 text-xs font-medium uppercase text-muted">{t("familyBriefTitle")}</h3>
      <SessionFamilyBriefForm sessionId={detail.id} brief={detail.familyBrief} />
    </section>
  );
}
