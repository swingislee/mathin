import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardEmptyCard, DashboardTableShell } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { compareCourseDifficulty } from "./course-difficulty";
import { type CourseFamilyListItem, COURSE_SEASONS } from "./course-queries";
import type { CourseSeason } from "./types";

/** 与 list_course_families 的每页条数一致。 */
const PAGE_SIZE = 20;

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function courseSeasonLabel(season: CourseSeason | null, translate: Translator) {
  if (season === null) return translate("courseSeasonUnspecified");
  return translate(COURSE_SEASONS.find((item) => item.value === season)?.labelKey ?? "summer");
}

function summarizeGrades(grades: number[]) {
  const ranges: { start: number; end: number }[] = [];
  for (const grade of [...new Set(grades)].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && grade === last.end + 1) last.end = grade;
    else ranges.push({ start: grade, end: grade });
  }
  return ranges.map(({ start, end }) => start === end ? String(start) : `${start}–${end}`).join(" · ");
}

function summarizeFamily(family: CourseFamilyListItem, t: Translator) {
  const variants = family.matchedVariants;
  return {
    grades: summarizeGrades(variants.map((variant) => variant.grade)),
    classTypes: [...new Set(variants.map((variant) => variant.classType))].sort(compareCourseDifficulty).map((classType) => classType || t("defaultClassType")),
    seasons: [...new Set(variants.map((variant) => variant.courseSeason))].sort((a, b) => (a ?? 5) - (b ?? 5)).map((season) => courseSeasonLabel(season, t)),
    catalogVersions: [...new Map(variants
      .filter((variant) => variant.catalogVersionSlug !== "default")
      .map((variant) => [variant.catalogVersionSlug, variant.catalogVersionTitle])).values()],
  };
}

function ReadinessMeter({ family, t }: { family: CourseFamilyListItem; t: Translator }) {
  const total = family.lectureCount;
  const ready = family.releasedLectureCount;
  const complete = family.incompleteLectureCount === 0;
  const percent = total > 0 ? Math.round((ready / total) * 100) : 0;
  return <div className="flex w-full min-w-0 flex-col gap-1.5 lg:w-40">
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-sm text-ink tabular-nums">{ready}<span className="text-muted">/{total}</span></span>
      <span className={cn("whitespace-nowrap", complete ? "text-leaf-deep" : "text-rose")}>
        {complete ? t("ready") : t("readinessIssues", { count: family.incompleteLectureCount })}
      </span>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
      <div className={cn("h-full rounded-full", complete ? "bg-leaf-deep" : "bg-leaf")} style={{ width: `${percent}%` }} />
    </div>
  </div>;
}

function pageHref(basePath: string, params: Record<string, string>, page: number) {
  const search = new URLSearchParams(params);
  if (page > 1) search.set("page", String(page));
  else search.delete("page");
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

async function CourseFamilyPager({ currentPage, totalPages, basePath, params }: {
  currentPage: number; totalPages: number; basePath: string; params: Record<string, string>;
}) {
  const t = await getTranslations("school.courses");
  const leadsT = await getTranslations("school.leads");
  const step = (page: number, label: string, icon: ReactNode) => page < 1 || page > totalPages
    ? <span aria-disabled="true" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "size-9 p-0 opacity-40")}>{icon}</span>
    : <Link href={pageHref(basePath, params, page)} aria-label={label} title={label} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "size-9 p-0")}>{icon}</Link>;
  return <nav aria-label={t("pagination")} className="flex items-center justify-end gap-2 text-xs text-muted">
    {step(currentPage - 1, leadsT("previous"), <ChevronLeft className="size-4" aria-hidden />)}
    <span className="tabular-nums">{t("pageSummary", { page: currentPage, pages: totalPages })}</span>
    {step(currentPage + 1, leadsT("next"), <ChevronRight className="size-4" aria-hidden />)}
  </nav>;
}

// 课程产品库是一张连续的产品目录：一行一个课程产品，适用范围、课件准备和使用规模按列对齐便于横向比较；
// 整行进入产品详情。窄屏由 Table stacked 排成连续记录。
export async function CourseFamilyList({
  families,
  totalCount,
  hasFilters,
  resetHref,
  currentPage,
  searchParams,
}: {
  families: CourseFamilyListItem[];
  totalCount: number;
  hasFilters: boolean;
  resetHref: string;
  currentPage: number;
  /** 当前筛选参数，翻页时原样保留。 */
  searchParams: Record<string, string>;
}) {
  const t = await getTranslations("school.courses");
  if (families.length === 0) {
    return <DashboardEmptyCard
      action={hasFilters ? <Link href={resetHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("clearFilters")}</Link> : undefined}
    >{t("familyEmpty")}</DashboardEmptyCard>;
  }
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return <div className="space-y-3">
    <p className="text-sm text-muted">{t("familyResults", { count: totalCount })}</p>
    <DashboardTableShell data-course-family-table>
      <Table mobileLayout="stacked" className="w-full text-left text-sm lg:min-w-[60rem]">
        <TableHeader className="text-xs text-muted">
          <TableRow className="hover:bg-card">
            <TableHead className="w-[34%]">{t("productColumn")}</TableHead>
            <TableHead>{t("gradeLabel")}</TableHead>
            <TableHead>{t("classType")}</TableHead>
            <TableHead>{t("courseSeason")}</TableHead>
            <TableHead>{t("readiness")}</TableHead>
            <TableHead className="text-right">{t("variants")}</TableHead>
            <TableHead className="text-right">{t("usingClasses")}</TableHead>
            <TableHead className="w-10"><span className="sr-only">{t("viewProduct")}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {families.map((family) => {
            const summary = summarizeFamily(family, t);
            const meta = [family.publisher, family.stage, family.subject, family.edition].filter(Boolean).join(" · ");
            return <TableRow key={family.id} className="group relative cursor-pointer">
              <TableCell mobileSpan="primary" className="py-3.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {/* 标题链接撑满整行，行内其余内容只读。 */}
                  <Link href={`/dashboard/courses/${family.id}`} className="min-w-0 font-display text-base leading-snug break-words text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring">
                    {family.title}
                  </Link>
                  {family.status !== "enabled" && <Badge variant="outline">{t(family.status)}</Badge>}
                  {family.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}
                </div>
                {meta && <p className="mt-0.5 text-xs break-words text-muted">{meta}</p>}
                {summary.catalogVersions.length > 0 && <p className="mt-0.5 text-xs break-words text-muted">{t("catalogVersion")} · {summary.catalogVersions.join(" · ")}</p>}
                <p className="mt-1 text-xs text-muted tabular-nums lg:hidden">{t("familyCounts", { variants: family.variantCount, classes: family.classroomCount })}</p>
              </TableCell>
              <TableCell mobileLabel={t("gradeLabel")} mobileEmpty={!summary.grades} className="whitespace-nowrap tabular-nums text-ink">{summary.grades || "—"}</TableCell>
              <TableCell mobileLabel={t("classType")} mobileEmpty={summary.classTypes.length === 0}>
                <div className="flex flex-wrap gap-1">
                  {summary.classTypes.map((classType) => <span key={classType} className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-xs leading-none text-ink">{classType}</span>)}
                </div>
              </TableCell>
              <TableCell mobileLabel={t("courseSeason")} mobileEmpty={summary.seasons.length === 0} className="text-ink">{summary.seasons.join(" · ") || "—"}</TableCell>
              <TableCell mobileLabel={t("readiness")}><ReadinessMeter family={family} t={t} /></TableCell>
              <TableCell mobileHidden className="text-right tabular-nums text-ink">{family.variantCount}</TableCell>
              <TableCell mobileHidden className={cn("text-right tabular-nums", family.classroomCount ? "text-ink" : "text-muted")}>{family.classroomCount}</TableCell>
              <TableCell mobileSpan="secondary" className="pr-3 text-right text-muted" aria-hidden="true">
                <ChevronRight className="ml-auto size-4 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
              </TableCell>
            </TableRow>;
          })}
        </TableBody>
      </Table>
    </DashboardTableShell>
    {totalPages > 1 && <CourseFamilyPager currentPage={Math.min(currentPage, totalPages)} totalPages={totalPages} basePath="/dashboard/courses" params={searchParams} />}
  </div>;
}
