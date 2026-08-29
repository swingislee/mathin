import type { ReactNode } from "react";
import { ArrowRight, BookOpen, CheckCircle2, CircleDashed, Layers3 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DashboardEmptyCard, DashboardStatGrid, DashboardSummaryCard } from "@/features/school/dashboard-page";
import {
  ObjectBar,
  ObjectWorkspace,
  type ObjectContextItem,
} from "@/features/school/object-workspace";
import type { StaffOption } from "@/features/school/classes";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CourseVariantReadiness } from "./CourseAsidePanels";
import type { CourseFamilyDetail } from "./course-family-detail";
import { ResponsibilityPanel } from "./ResponsibilityPanel";
import { StatusOverflowMenu } from "./StatusOverflowMenu";
import { TeachingPlan } from "./TeachingPlan";
import { transitionCourseFamilyStatusAction, transitionCourseVariantStatusAction } from "./actions";
import {
  teacherMicrocourseIsReady,
  teacherMicrocourseLibrarySearchParams,
  teacherMicrocourseStructure,
  type TeacherMicrocourseLibraryEntry,
  type TeacherMicrocourseLibraryFilters,
} from "./teacher-microcourse-library";
import { TeacherMicrocourseLibraryFilters as FilterControls } from "./TeacherMicrocourseLibraryFilters";
import { UsagePanel } from "./UsagePanel";
import type { CourseSeason } from "./types";

function entryHref(
  familyId: string,
  entryId: string,
  filters: TeacherMicrocourseLibraryFilters,
  returnTo: string | null,
) {
  const params = teacherMicrocourseLibrarySearchParams(filters);
  params.set("variant", entryId);
  if (returnTo) params.set("returnTo", returnTo);
  return `/dashboard/courses/${familyId}?${params.toString()}#microcourse-detail`;
}

function seasonLabelKey(season: CourseSeason | null) {
  if (season === null) return "courseSeasonUnspecified";
  return ["summer", "autumn", "winter", "spring"][season - 1];
}

export async function TeacherMicrocourseLibrary({
  detail,
  entries,
  filteredEntries,
  selectedEntry,
  filters,
  locale,
  returnTo,
  canManage,
  canAssign,
  canCreateClass,
  canViewUsage,
  staffOptions,
  lecturePreview,
}: {
  detail: CourseFamilyDetail;
  entries: TeacherMicrocourseLibraryEntry[];
  filteredEntries: TeacherMicrocourseLibraryEntry[];
  selectedEntry: TeacherMicrocourseLibraryEntry | null;
  filters: TeacherMicrocourseLibraryFilters;
  locale: string;
  returnTo: string | null;
  canManage: boolean;
  canAssign: boolean;
  canCreateClass: boolean;
  canViewUsage: boolean;
  staffOptions: StaffOption[];
  lecturePreview?: ReactNode;
}) {
  const t = await getTranslations("school.courses");
  const identity: ObjectContextItem[] = [detail.family.publisher, detail.family.stage, detail.family.subject, detail.family.edition]
    .filter(Boolean)
    .map((value) => ({ value }));
  const singleCount = entries.filter((entry) => teacherMicrocourseStructure(entry.lectureCount) === "single").length;
  const shortCount = entries.filter((entry) => teacherMicrocourseStructure(entry.lectureCount) === "short").length;
  const seriesCount = entries.filter((entry) => teacherMicrocourseStructure(entry.lectureCount) === "series").length;
  const readyCount = entries.filter(teacherMicrocourseIsReady).length;
  const selectedVariant = detail.selectedVariant;
  const selectedBaseHref = selectedEntry
    ? entryHref(detail.family.id, selectedEntry.id, filters, returnTo).split("#")[0]
    : `/dashboard/courses/${detail.family.id}`;

  const grades = Array.from(new Set(entries.map((entry) => entry.grade))).sort((left, right) => left - right);
  const seasons = Array.from(new Set(entries.map((entry) => entry.courseSeason))).sort((left, right) => {
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  });
  const classTypes = Array.from(new Set(entries.map((entry) => entry.classType))).sort((left, right) => left.localeCompare(right));
  const topicMap = new Map<string, string>();
  for (const entry of entries) {
    for (const topic of entry.topics) if (!topicMap.has(topic.slug)) {
      topicMap.set(topic.slug, locale === "en" ? topic.titleEn : topic.titleZh);
    }
  }
  const topics = [...topicMap].map(([slug, label]) => ({ slug, label })).sort((left, right) => left.label.localeCompare(right.label));
  const offerings = Array.from(new Set(entries.map((entry) => entry.offeringType)));

  return <ObjectWorkspace
    objectBar={<ObjectBar
      title={detail.family.title}
      backHref={returnTo ?? "/dashboard/courses"}
      backLabel={t("backToLibrary")}
      context={identity}
      status={<>
        <Badge variant={detail.family.status === "enabled" ? "secondary" : "outline"}>{t(detail.family.status)}</Badge>
        {detail.family.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}
      </>}
      overflowSlot={canManage ? <StatusOverflowMenu
        id={detail.family.id}
        status={detail.family.status}
        action={transitionCourseFamilyStatusAction}
        ariaLabel={t("moreActions")}
      /> : undefined}
    />}
  >
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-card p-4 sm:p-5" aria-labelledby="microcourse-library-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h2 id="microcourse-library-heading" className="font-display text-2xl text-ink">{t("microcourseLibrary")}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{t("microcourseLibraryHint")}</p>
          </div>
          <Badge variant="outline">{t("microcourseResultCount", { count: filteredEntries.length })}</Badge>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: t("microcourseAll"), value: entries.length },
            { label: t("microcourseSingle"), value: singleCount },
            { label: t("microcourseShort"), value: shortCount },
            { label: t("microcourseSeries"), value: seriesCount },
            { label: t("microcourseReady"), value: readyCount },
          ].map((item) => <div key={item.label} className="rounded-xl bg-paper/70 px-3 py-2.5">
            <dt className="text-xs text-muted">{item.label}</dt>
            <dd className="mt-1 text-xl font-medium tabular-nums text-ink">{item.value}</dd>
          </div>)}
        </dl>
      </section>

      <FilterControls
        filters={filters}
        grades={grades}
        seasons={seasons}
        classTypes={classTypes}
        topics={topics}
        offerings={offerings}
      />

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-2xl border border-line bg-card p-2" aria-labelledby="microcourse-results-heading">
          <div className="flex items-center justify-between gap-3 px-2 py-2">
            <h2 id="microcourse-results-heading" className="text-sm font-medium text-ink">{t("microcourseCatalog")}</h2>
            <span className="text-xs tabular-nums text-muted">{filteredEntries.length}/{entries.length}</span>
          </div>
          {filteredEntries.length === 0 ? <DashboardEmptyCard className="m-1">{t("microcourseNoResults")}</DashboardEmptyCard> : <div className="flex max-h-[42rem] flex-col gap-1 overflow-y-auto pr-1">
            {filteredEntries.map((entry) => {
              const active = entry.id === selectedEntry?.id;
              const ready = teacherMicrocourseIsReady(entry);
              const structure = teacherMicrocourseStructure(entry.lectureCount);
              return <Link
                key={entry.id}
                href={entryHref(detail.family.id, entry.id, filters, returnTo)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group rounded-xl border p-3 transition",
                  active ? "border-crater bg-moon/25" : "border-transparent hover:border-line hover:bg-paper/70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium text-ink">{entry.title}</h3>
                    <p className="mt-1 truncate text-xs text-muted">{entry.authorName} · {entry.sourceClassroomName}</p>
                  </div>
                  <ArrowRight className={cn("mt-0.5 size-4 shrink-0 transition group-hover:translate-x-0.5", active ? "text-crater" : "text-muted")} aria-hidden />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline">{t(`microcourseStructure_${structure}`)}</Badge>
                  <Badge variant={ready ? "secondary" : "outline"}>{ready ? t("microcourseReady") : t("microcourseNeedsWork")}</Badge>
                  {entry.topics.slice(0, 1).map((topic) => <Badge key={topic.slug} variant="outline">{locale === "en" ? topic.titleEn : topic.titleZh}</Badge>)}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
                  <span>{t("microcourseSourceCompact", {
                    grade: entry.grade,
                    season: t(seasonLabelKey(entry.courseSeason)),
                    classType: entry.classType || t("defaultClassType"),
                  })}</span>
                  <span className="shrink-0 tabular-nums">{entry.releasedLectureCount}/{entry.lectureCount}</span>
                </div>
              </Link>;
            })}
          </div>}
        </section>

        <section id="microcourse-detail" className="min-w-0 scroll-mt-28" aria-labelledby="microcourse-detail-heading">
          {!selectedEntry || !selectedVariant ? <DashboardEmptyCard>{t("microcourseChooseOne")}</DashboardEmptyCard> : <div className="space-y-5">
            <article className="rounded-2xl border border-line bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={selectedVariant.status === "enabled" ? "secondary" : "outline"}>{t(selectedVariant.status)}</Badge>
                    <Badge variant="outline">{t(`microcourseStructure_${teacherMicrocourseStructure(selectedEntry.lectureCount)}`)}</Badge>
                    <Badge variant="outline">{t(`microcourseOffering_${selectedEntry.offeringType}`)}</Badge>
                  </div>
                  <h2 id="microcourse-detail-heading" className="mt-3 font-display text-2xl text-ink">{selectedEntry.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">{t("microcourseSourceExplanation", {
                    classroom: selectedEntry.sourceClassroomName,
                    author: selectedEntry.authorName,
                  })}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {canCreateClass && selectedVariant.status === "enabled" && <Link
                    href={`/dashboard/classes/new?courseId=${selectedVariant.id}`}
                    className={buttonVariants({ size: "sm" })}
                  >{t("useMicrocourseForClass")}</Link>}
                  {canManage && <StatusOverflowMenu
                    id={selectedVariant.id}
                    status={selectedVariant.status}
                    action={transitionCourseVariantStatusAction}
                    ariaLabel={t("moreActions")}
                  />}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="outline">{t("microcourseSourceGradeValue", { grade: selectedEntry.grade })}</Badge>
                <Badge variant="outline">{t("microcourseSourceSeasonValue", { season: t(seasonLabelKey(selectedEntry.courseSeason)) })}</Badge>
                <Badge variant="outline">{t("microcourseSourceClassTypeValue", { classType: selectedEntry.classType || t("defaultClassType") })}</Badge>
                {selectedEntry.topics.map((topic) => <Badge key={topic.slug} variant="outline">{locale === "en" ? topic.titleEn : topic.titleZh}</Badge>)}
                {selectedEntry.keywords.slice(0, 6).map((keyword) => <Badge key={keyword} variant="outline">#{keyword}</Badge>)}
              </div>

              <DashboardStatGrid
                className="mt-5 sm:grid-cols-4"
                 items={[
                   { label: t("lectures"), value: selectedEntry.lectureCount },
                   { label: t("publishedLectures"), value: selectedEntry.releasedLectureCount },
                   { label: t("pagesLabel"), value: detail.readiness.pageCount },
                   ...(canViewUsage ? [{ label: t("usingClasses"), value: detail.usage.length }] : []),
                 ]}
               />
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-paper/70 p-3 text-xs leading-5 text-muted">
                <CircleDashed className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("microcourseFacetNote")}
              </p>
            </article>

            <TeachingPlan baseHref={selectedBaseHref} teachingPlan={detail.teachingPlan} canManage={canManage} />

            <div className="grid gap-4 lg:grid-cols-3">
              <CourseVariantReadiness readiness={detail.readiness} />
              {canViewUsage && <UsagePanel usage={detail.usage} returnTo={selectedBaseHref} />}
              <ResponsibilityPanel
                scopeType="variant"
                scopeId={selectedVariant.id}
                assignments={detail.variantAssignments}
                staffOptions={staffOptions}
                canManage={canAssign}
                title={t("variantResponsibility")}
              />
            </div>
          </div>}
        </section>
      </div>

      {entries.length > 0 && <DashboardSummaryCard title={t("microcourseDiscoveryPrinciple")}>
        <div className="mt-3 grid gap-3 text-sm text-muted sm:grid-cols-3">
          <p className="flex gap-2"><Layers3 className="mt-0.5 size-4 shrink-0 text-crater" aria-hidden />{t("microcoursePrincipleBrowse")}</p>
          <p className="flex gap-2"><BookOpen className="mt-0.5 size-4 shrink-0 text-crater" aria-hidden />{t("microcoursePrincipleInspect")}</p>
          <p className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-crater" aria-hidden />{t("microcoursePrincipleChoose")}</p>
        </div>
      </DashboardSummaryCard>}
    </div>
    {lecturePreview}
  </ObjectWorkspace>;
}
