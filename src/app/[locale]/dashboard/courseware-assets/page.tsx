import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssetLibraryFilters } from "@/features/courseware-studio/AssetLibraryFilters";
import { loadCoursewareSharedAssets, parseAssetLibraryFilters } from "@/features/courseware-studio/data";
import {
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardEmptyCard,
  DashboardPage,
  DashboardTableShell,
} from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";

// doc22 §5.20：shared-assets 过于宽泛——这个模块只管理课件素材。保持顶层而不是收进
// /courseware/assets，因为课件素材是独立的侧栏入口，不是课件工作台的子页面。
export default async function CoursewareAssetLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const filters = parseAssetLibraryFilters(await searchParams);
  setRequestLocale(locale);
  await requirePerm(locale, "courseware.asset.manage");
  const t = await getTranslations("coursewareStudio");
  const { items, hasNextPage } = await loadCoursewareSharedAssets(filters);
  const hrefForPage = (page: number) => {
    const query = new URLSearchParams();
    if (filters.query) query.set("query", filters.query);
    if (filters.kind) query.set("kind", filters.kind);
    if (filters.role) query.set("role", filters.role);
    if (filters.track !== "native-16x9") query.set("track", filters.track);
    if (filters.minUsage) query.set("minUsage", String(filters.minUsage));
    if (page > 1) query.set("page", String(page));
    const suffix = query.toString();
    return `/dashboard/courseware-assets${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <DashboardPage
      title={t("assetLibraryTitle")}
      commandPanel={
        <DashboardCommandPanel>
          <DashboardCommandFilters>
            <AssetLibraryFilters initial={filters} />
          </DashboardCommandFilters>
        </DashboardCommandPanel>
      }
      footer={
        <nav className="flex items-center justify-between" aria-label={t("assetPagination")}>
          {filters.page > 1 ? <Link href={hrefForPage(filters.page - 1)} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("assetPreviousPage")}</Link> : <span />}
          <span className="text-xs text-muted">{t("assetPage", { page: filters.page })}</span>
          {hasNextPage ? <Link href={hrefForPage(filters.page + 1)} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("assetNextPage")}</Link> : <span />}
        </nav>
      }
    >
      {items.length === 0 ? (
        <DashboardEmptyCard>{t("assetLibraryEmpty")}</DashboardEmptyCard>
      ) : (
        <DashboardTableShell>
          <Table className="w-full min-w-[48rem] border-collapse text-left text-sm">
            <TableHeader className="border-b border-line text-xs text-muted">
              <TableRow>
                <TableHead className="w-24 px-4 py-3 font-medium">{t("assetPreview")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("assetName")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("assetKind")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("assetUsage")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("assetDimensions")}</TableHead>
                <TableHead className="px-4 py-3 font-medium" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell className="px-4 py-3">
                    <div className="grid aspect-video w-16 place-items-center overflow-hidden rounded-lg bg-paper ring-1 ring-line/50">
                      {asset.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL is short lived and has arbitrary host
                        <img src={asset.previewUrl} alt="" className="h-full w-full object-contain" />
                      ) : <span className="text-[10px] text-muted">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <p className="font-medium text-ink">{asset.name || t("unnamedAsset")}</p>
                    <p className="mt-1 font-mono text-xs text-muted">{asset.sha256.slice(0, 12)}… · r{asset.publishedRevisionNo}</p>
                  </TableCell>
                  <TableCell className="px-4 py-3"><Badge variant="secondary">{asset.kind} · {asset.role}</Badge></TableCell>
                  <TableCell className="px-4 py-3 tabular-nums">
                    {t("assetUsageSummary", { pages: asset.usageCount, lectures: asset.lectureCount, courses: asset.courseCount })}
                  </TableCell>
                  <TableCell className="px-4 py-3 tabular-nums text-muted">{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"}</TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    {asset.kind === "image" ? (
                      <Link href={`/dashboard/courseware-assets/${asset.id}?track=${filters.track}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("manageAsset")}</Link>
                    ) : <span className="text-xs text-muted">{t("assetReadOnly")}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DashboardTableShell>
      )}
    </DashboardPage>
  );
}
