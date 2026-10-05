import { ArrowRight, BookOpen, CircleAlert, Layers3, School } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DashboardEmptyCard } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { compareCourseDifficulty } from "./course-difficulty";
import { type CourseFamilyListItem, COURSE_SEASONS } from "./course-queries";
import type { CourseSeason } from "./types";

function courseSeasonLabel(season: CourseSeason | null, translate: (key: string) => string) {
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

export async function CourseFamilyList({
  families,
  totalCount,
  hasFilters,
  resetHref,
}: {
  families: CourseFamilyListItem[];
  totalCount: number;
  hasFilters: boolean;
  resetHref: string;
}) {
  const t = await getTranslations("school.courses");
  if (families.length === 0) {
    return <DashboardEmptyCard
      action={hasFilters ? <Link href={resetHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("clearFilters")}</Link> : undefined}
    >{t("familyEmpty")}</DashboardEmptyCard>;
  }

  return <div className="space-y-4">
    <p className="text-sm text-muted">{t("familyResults", { count: totalCount })}</p>
    <div className="grid items-stretch gap-4 @4xl/page:grid-cols-2">
      {families.map((family) => {
        const variants = family.matchedVariants;
        const classTypes = [...new Set(variants.map((variant) => variant.classType))].sort(compareCourseDifficulty);
        const seasons = [...new Set(variants.map((variant) => variant.courseSeason))].sort((a, b) => (a ?? 5) - (b ?? 5));
        const catalogVersions = [...new Map(variants
          .filter((variant) => variant.catalogVersionSlug !== "default")
          .map((variant) => [variant.catalogVersionSlug, variant.catalogVersionTitle])).values()];
        const dimensions = [
          { label: t("gradeLabel"), value: summarizeGrades(variants.map((variant) => variant.grade)) },
          { label: t("classType"), value: classTypes.map((classType) => classType || t("defaultClassType")).join(" · ") },
          { label: t("courseSeason"), value: seasons.map((season) => courseSeasonLabel(season, t)).join(" · ") },
          { label: t("catalogVersion"), value: catalogVersions.join(" · ") },
        ].filter((dimension) => dimension.value);

        return <article key={family.id} className="@container/course-card flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-card p-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-crater/40 bg-moon/30 text-crater @md/course-card:size-16" aria-hidden="true"><BookOpen className="size-6 @md/course-card:size-8" strokeWidth={1.5} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="min-w-0 flex-1 font-display text-lg leading-snug break-words text-ink @md/course-card:text-xl">{family.title}</h2>
                <div className="flex shrink-0 flex-wrap gap-1.5"><Badge variant={family.status === "enabled" ? "secondary" : "outline"}>{t(family.status)}</Badge>{family.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}</div>
              </div>
              <p className="mt-1 text-sm break-words text-muted">{[family.publisher, family.stage, family.subject, family.edition].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          {dimensions.length > 0 && <dl className="space-y-2 text-sm" aria-label={t("availableVariants")}>
            {dimensions.map(({ label, value }) => <div key={label} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0 break-words text-ink">{value}</dd>
            </div>)}
          </dl>}
          <dl className="grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
            <div className="min-w-0"><dt className="flex items-center gap-1 text-muted"><Layers3 className="size-3.5 shrink-0" />{t("variants")}</dt><dd className="mt-1 text-sm font-medium break-words text-ink tabular-nums">{family.variantCount}</dd></div>
            <div className="min-w-0"><dt className="text-muted">{t("readiness")}</dt><dd className="mt-1 text-sm font-medium break-words text-ink tabular-nums">{family.releasedLectureCount}/{family.lectureCount}</dd></div>
            <div className="min-w-0"><dt className="flex items-center gap-1 text-muted"><School className="size-3.5 shrink-0" />{t("usingClasses")}</dt><dd className="mt-1 text-sm font-medium break-words text-ink tabular-nums">{family.classroomCount}</dd></div>
          </dl>
          <div className="mt-auto flex flex-col gap-3 @sm/course-card:flex-row @sm/course-card:items-center @sm/course-card:justify-between">
            <p className={cn("flex min-w-0 items-center gap-1 text-xs", family.incompleteLectureCount ? "text-rose" : "text-leaf-deep")}><CircleAlert className="size-3.5 shrink-0" />{family.incompleteLectureCount ? t("readinessIssues", { count: family.incompleteLectureCount }) : t("readinessComplete")}</p>
            <Link href={`/dashboard/courses/${family.id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "min-h-11 w-full shrink-0 @sm/course-card:w-auto")}>{t("viewProduct")}<ArrowRight className="size-4" /></Link>
          </div>
        </article>;
      })}
    </div>
  </div>;
}
