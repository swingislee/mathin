import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SharedAssetReplacementEditor } from "@/features/courseware-studio/SharedAssetReplacementEditor";
import { loadCoursewareSharedAssetDetail, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";

export default async function SharedAssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; assetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, assetId }, query] = await Promise.all([params, searchParams]);
  const track = parseCoursewareTrack(query.track);
  setRequestLocale(locale);
  await requirePerm(locale, "courseware.asset.manage");
  const t = await getTranslations("coursewareStudio");
  const detail = await loadCoursewareSharedAssetDetail(assetId, track);
  if (!detail) notFound();

  return (
    <div className="mx-auto w-full max-w-7xl">
      <SchoolPageHeader title={t("assetDetailTitle")}>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("assetDetailIntro")}</p>
      </SchoolPageHeader>
      <p className="mt-3"><Link href={`/dashboard/shared-assets?track=${track}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">{t("backToAssetLibrary")}</Link></p>
      <SharedAssetReplacementEditor detail={detail} />
    </div>
  );
}
