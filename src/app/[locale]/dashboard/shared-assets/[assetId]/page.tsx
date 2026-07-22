import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SharedAssetReplacementEditor } from "@/features/courseware-studio/SharedAssetReplacementEditor";
import { loadCoursewareSharedAssetDetail } from "@/features/courseware-studio/data";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";

export default async function SharedAssetDetailPage({
  params,
}: {
  params: Promise<{ locale: string; assetId: string }>;
}) {
  const { locale, assetId } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "courseware.asset.manage");
  const t = await getTranslations("coursewareStudio");
  const detail = await loadCoursewareSharedAssetDetail(assetId);
  if (!detail) notFound();

  return (
    <div className="mx-auto w-full max-w-7xl">
      <SchoolPageHeader title={t("assetDetailTitle")}>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("assetDetailIntro")}</p>
      </SchoolPageHeader>
      <p className="mt-3"><Link href="/dashboard/shared-assets" className="text-xs text-muted underline underline-offset-2 hover:text-ink">{t("backToAssetLibrary")}</Link></p>
      <SharedAssetReplacementEditor detail={detail} />
    </div>
  );
}
