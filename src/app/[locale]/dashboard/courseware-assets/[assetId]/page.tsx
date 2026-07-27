import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AssetReplacementController } from "@/features/courseware-studio/asset-replacement/AssetReplacementController";
import { loadCoursewareSharedAssetDetail, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { resolveReturnTarget } from "@/features/school/object-workspace";
import { requireDashboardEnvironment, requirePerm } from "@/lib/auth";

/**
 * 素材替换工作区（doc 23 §13）。
 *
 * 这里**没有** DashboardPage：它在路由合同里是 shellMode "panel"。之前套着普通页面
 * 外壳，于是外层页面滚动叠着一个内部长内容的双栏编辑器一起滚，标题还是写死的
 * "素材详情"——同一个替换流程连着开好几个素材时，标签页上全都长一个样。
 */
export default async function CoursewareAssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; assetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, assetId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const [{ environment }] = await Promise.all([
    requireDashboardEnvironment(locale, ["staff"]),
    requirePerm(locale, "courseware.asset.manage"),
  ]);

  const track = parseCoursewareTrack(query.track);
  const detail = await loadCoursewareSharedAssetDetail(assetId, track);
  if (!detail) notFound();

  const backHref = resolveReturnTarget({
    returnTo: query.returnTo,
    fallback: `/dashboard/courseware-assets?track=${track}`,
    environment,
  });

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col xl:h-full xl:min-h-0">
      <AssetReplacementController detail={detail} backHref={backHref} />
    </div>
  );
}
