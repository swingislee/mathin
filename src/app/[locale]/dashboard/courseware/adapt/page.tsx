import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { reviewAdaptBackground } from "@/features/courseware-studio/adapt-actions";
import { COURSEWARE_STUDIO_PERMS } from "@/features/courseware-studio/data";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { requireAnyPerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AdaptReviewQueuePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  const t = await getTranslations("coursewareStudio");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cw_adapt_backgrounds")
    .select("id, status, crop_x, crop_y, created_at, derived_asset_revision_id")
    .eq("status", "pending")
    .order("created_at");
  if (error) throw new Error(error.message);
  const { data: manualPages, error: manualPagesError } = await supabase
    .from("cw_page_docs")
    .select("id, lecture_id, page_no, title, adapt_reason")
    .eq("adapt_class", "D")
    .is("deleted_at", null)
    .order("lecture_id")
    .order("page_no");
  if (manualPagesError) throw new Error(manualPagesError.message);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <SchoolPageHeader title={t("adaptQueueTitle")}>
        <p className="mt-1 text-sm text-muted">{t("adaptQueueIntro")}</p>
      </SchoolPageHeader>
      <p className="mt-3"><Link href="/dashboard/courseware" className="text-xs text-muted underline underline-offset-2 hover:text-ink">{t("backToWorkbench")}</Link></p>
      {!data?.length ? <p className="mt-6 rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("adaptQueueEmpty")}</p> : (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
          <ul className="divide-y divide-line">
            {data.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-mono text-xs text-ink">{item.derived_asset_revision_id}</p>
                  <p className="mt-1 text-xs text-muted">{t("adaptCrop", { x: item.crop_x, y: item.crop_y })}</p>
                </div>
                <div className="flex gap-2">
                  <form action={reviewAdaptBackground.bind(null, item.id, "reject")}><Button type="submit" variant="secondary" size="sm">{t("adaptReject")}</Button></form>
                  <form action={reviewAdaptBackground.bind(null, item.id, "approve")}><Button type="submit" size="sm">{t("adaptApprove")}</Button></form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="mt-8">
        <h2 className="text-base font-semibold text-ink">{t("adaptManualTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("adaptManualIntro")}</p>
        {!manualPages?.length ? <p className="mt-4 rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("adaptManualEmpty")}</p> : (
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
            <ul className="divide-y divide-line">
              {manualPages.map((page) => (
                <li key={page.id} className="p-4">
                  <p className="font-medium text-ink">{t("adaptManualPage", { page: page.page_no, title: page.title || t("untitledPage") })}</p>
                  <p className="mt-1 text-xs text-muted">{t("adaptManualLecture", { id: page.lecture_id })}</p>
                  <p className="mt-1 text-xs text-muted">{t("adaptManualReason", { reason: page.adapt_reason || "-" })}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
