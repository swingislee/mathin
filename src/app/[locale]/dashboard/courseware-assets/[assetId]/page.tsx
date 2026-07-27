import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SharedAssetReplacementEditor } from "@/features/courseware-studio/SharedAssetReplacementEditor";
import { loadCoursewareSharedAssetDetail, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { DashboardPage } from "@/features/school/dashboard-page";
import { requirePerm } from "@/lib/auth";

export default async function CoursewareAssetDetailPage({
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
    <DashboardPage
      title={t("assetDetailTitle")}
      backHref={`/dashboard/courseware-assets?track=${track}`}
      backLabel={t("backToAssetLibrary")}
      breadcrumbs={[{ label: t("assetLibraryTitle"), href: `/dashboard/courseware-assets?track=${track}` }, { label: t("assetDetailTitle") }]}
    >
      <SharedAssetReplacementEditor detail={detail} />
    </DashboardPage>
  );
}
