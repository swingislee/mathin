import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssetLibraryFilters } from "@/features/courseware-studio/AssetLibraryFilters";
import { loadCoursewareSharedAssets, parseAssetLibraryFilters } from "@/features/courseware-studio/data";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { requirePerm } from "@/lib/auth";

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
    if (filters.minUsage) query.set("minUsage", String(filters.minUsage));
    if (page > 1) query.set("page", String(page));
    const suffix = query.toString();
    return `/dashboard/courseware/assets${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("assetLibraryTitle")}>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("assetLibraryIntro")}</p>
      </SchoolPageHeader>
      <p className="mt-3">
        <Link href="/dashboard/courseware" className="text-xs text-muted underline underline-offset-2 hover:text-ink">{t("backToCourses")}</Link>
      </p>
      <AssetLibraryFilters initial={filters} />

      {items.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-line bg-card p-5 text-sm text-muted">{t("assetLibraryEmpty")}</p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-card">
          <Table className="w-full border-collapse text-left text-sm">
            <TableHeader className="border-b border-line text-xs text-muted">
              <TableRow>
                <TableHead className="px-4 py-3 font-medium">{t("assetName")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("assetKind")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("assetUsage")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("assetDimensions")}</TableHead>
                <TableHead className="px-4 py-3 font-medium" />
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-line">
              {items.map((asset) => (
                <TableRow key={asset.id}>
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
                      <Link href={`/dashboard/courseware/assets/${asset.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("manageAsset")}</Link>
                    ) : <span className="text-xs text-muted">{t("assetReadOnly")}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <nav className="mt-5 flex items-center justify-between" aria-label={t("assetPagination")}>
        {filters.page > 1 ? <Link href={hrefForPage(filters.page - 1)} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("assetPreviousPage")}</Link> : <span />}
        <span className="text-xs text-muted">{t("assetPage", { page: filters.page })}</span>
        {hasNextPage ? <Link href={hrefForPage(filters.page + 1)} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("assetNextPage")}</Link> : <span />}
      </nav>
    </div>
  );
}
