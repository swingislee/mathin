import { ArrowRight, BookOpen, CircleAlert, Layers3, School } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { type CourseFamilyListItem, COURSE_SEASONS } from "./course-queries";
import type { CourseSeason } from "./types";

function courseSeasonLabel(season: CourseSeason, translate: (key: string) => string) {
  return translate(COURSE_SEASONS.find((item) => item.value === season)?.labelKey ?? "summer");
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
    return <div className="mt-6 rounded-2xl border border-dashed border-line bg-card p-8 text-center">
      <p className="text-sm text-muted">{t("familyEmpty")}</p>
      {hasFilters && <Link href={resetHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4")}>{t("clearFilters")}</Link>}
    </div>;
  }

  return <div className="mt-6 space-y-4">
    <p className="text-sm text-muted">{t("familyResults", { count: totalCount })}</p>
    <div className="grid gap-4 xl:grid-cols-2">
      {families.map((family) => <article key={family.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:flex-row">
        <div className="flex size-24 shrink-0 items-center justify-center rounded-xl border border-crater/40 bg-moon/30 text-crater" aria-hidden="true"><BookOpen className="size-9" strokeWidth={1.5} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h2 className="truncate font-display text-xl text-ink">{family.title}</h2><p className="mt-1 text-sm text-muted">{[family.publisher, family.stage, family.subject, family.edition].filter(Boolean).join(" · ")}</p></div>
            <div className="flex gap-1.5"><Badge variant={family.status === "enabled" ? "secondary" : "outline"}>{t(family.status)}</Badge>{family.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t("availableVariants")}>
            {family.matchedVariants.slice(0, 12).map((variant) => <Badge key={variant.id} variant="outline">{t("grade", { grade: variant.grade })} · {courseSeasonLabel(variant.courseSeason, t)} · {variant.classType || t("defaultClassType")}</Badge>)}
            {family.matchedVariants.length > 12 && <Badge variant="outline">+{family.matchedVariants.length - 12}</Badge>}
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-paper p-2"><dt className="flex items-center gap-1 text-muted"><Layers3 className="size-3.5" />{t("variants")}</dt><dd className="mt-1 font-medium text-ink">{family.variantCount}</dd></div>
            <div className="rounded-lg bg-paper p-2"><dt className="text-muted">{t("readiness")}</dt><dd className="mt-1 font-medium text-ink">{family.releasedLectureCount}/{family.lectureCount}</dd></div>
            <div className="rounded-lg bg-paper p-2"><dt className="flex items-center gap-1 text-muted"><School className="size-3.5" />{t("usingClasses")}</dt><dd className="mt-1 font-medium text-ink">{family.classroomCount}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className={cn("flex items-center gap-1 text-xs", family.incompleteLectureCount ? "text-rose" : "text-leaf-deep")}><CircleAlert className="size-3.5" />{family.incompleteLectureCount ? t("readinessIssues", { count: family.incompleteLectureCount }) : t("readinessComplete")}</p>
            <Link href={`/dashboard/courses/${family.id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0")}>{t("viewTeachingPlan")}<ArrowRight className="size-4" /></Link>
          </div>
        </div>
      </article>)}
    </div>
  </div>;
}
