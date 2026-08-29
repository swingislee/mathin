import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardEmptyCard,
} from "@/features/school/dashboard-page";
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
  const selectedReady = selectedEntry ? teacherMicrocourseIsReady(selectedEntry) : false;

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
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandFilters>
        <FilterControls
          filters={filters}
          grades={grades}
          seasons={seasons}
          classTypes={classTypes}
          topics={topics}
          offerings={offerings}
        />
      </DashboardCommandFilters>
    </DashboardCommandPanel>}
  >
    <div className="grid min-w-0 gap-6 @4xl/page:grid-cols-[21rem_minmax(0,1fr)]">
      <section className="min-w-0 self-start overflow-hidden rounded-2xl border border-line bg-card" aria-labelledby="microcourse-results-heading">
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="microcourse-results-heading" className="font-medium text-ink">{t("microcourseCatalog")}</h2>
            <span className="text-xs tabular-nums text-muted">{filteredEntries.length}/{entries.length}</span>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-muted">
            {t("microcourseSingle")} {singleCount} · {t("microcourseShort")} {shortCount} · {t("microcourseSeries")} {seriesCount} · {t("microcourseReady")} {readyCount}
          </p>
        </div>

        {filteredEntries.length === 0 ? <DashboardEmptyCard className="m-3">{t("microcourseNoResults")}</DashboardEmptyCard> : <div className="flex max-h-[calc(100vh-18rem)] min-h-64 flex-col overflow-y-auto p-2">
          {filteredEntries.map((entry) => {
            const active = entry.id === selectedEntry?.id;
            const ready = teacherMicrocourseIsReady(entry);
            const ReadyIcon = ready ? CheckCircle2 : CircleDashed;
            const topic = entry.topics[0];
            return <Link
              key={entry.id}
              href={entryHref(detail.family.id, entry.id, filters, returnTo)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group rounded-xl border px-3 py-3 transition",
                active ? "border-crater/60 bg-moon/20" : "border-transparent hover:border-line hover:bg-paper/70",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-ink">{entry.title}</h3>
                  <p className="mt-1 truncate text-xs text-muted">{entry.authorName} · {entry.sourceClassroomName}</p>
                </div>
                <span className={cn("flex shrink-0 items-center gap-1 text-xs tabular-nums", ready ? "text-emerald-700 dark:text-emerald-300" : "text-muted")}>
                  <ReadyIcon className="size-3.5" aria-hidden />{entry.releasedLectureCount}/{entry.lectureCount}
                </span>
              </div>
              <p className="mt-2 truncate text-xs text-muted">
                {t(`microcourseStructure_${teacherMicrocourseStructure(entry.lectureCount)}`)}
                {topic ? ` · ${locale === "en" ? topic.titleEn : topic.titleZh}` : ""}
                {` · ${t(seasonLabelKey(entry.courseSeason))}`}
              </p>
            </Link>;
          })}
        </div>}
      </section>

      <section id="microcourse-detail" className="min-w-0 scroll-mt-28" aria-labelledby="microcourse-detail-heading">
        {!selectedEntry || !selectedVariant ? <DashboardEmptyCard>{t("microcourseChooseOne")}</DashboardEmptyCard> : <>
          <header className="border-b border-line pb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={selectedVariant.status === "enabled" ? "secondary" : "outline"}>{t(selectedVariant.status)}</Badge>
                  <Badge variant={selectedReady ? "secondary" : "outline"}>{selectedReady ? t("microcourseReady") : t("microcourseNeedsWork")}</Badge>
                </div>
                <h2 id="microcourse-detail-heading" className="mt-3 font-display text-3xl text-ink">{selectedEntry.title}</h2>
                <p className="mt-1.5 text-sm text-muted">{t("microcourseSourceByline", {
                  author: selectedEntry.authorName,
                  classroom: selectedEntry.sourceClassroomName,
                })}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
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

            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {[
                { label: t("lectures"), value: selectedEntry.lectureCount },
                { label: t("publishedLectures"), value: selectedEntry.releasedLectureCount },
                { label: t("pagesLabel"), value: detail.readiness.pageCount },
                ...(canViewUsage ? [{ label: t("usingClasses"), value: detail.usage.length }] : []),
              ].map((item) => <div key={item.label} className="flex items-baseline gap-1.5">
                <dt className="text-xs text-muted">{item.label}</dt>
                <dd className="font-medium tabular-nums text-ink">{item.value}</dd>
              </div>)}
            </dl>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span>{t("microcourseSourceGradeValue", { grade: selectedEntry.grade })}</span><span aria-hidden>·</span>
              <span>{t("microcourseSourceSeasonValue", { season: t(seasonLabelKey(selectedEntry.courseSeason)) })}</span><span aria-hidden>·</span>
              <span>{t("microcourseSourceClassTypeValue", { classType: selectedEntry.classType || t("defaultClassType") })}</span>
            </div>

            {(selectedEntry.topics.length > 0 || selectedEntry.keywords.length > 0) && <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedEntry.topics.map((topic) => <Badge key={topic.slug} variant="outline">{locale === "en" ? topic.titleEn : topic.titleZh}</Badge>)}
              {selectedEntry.keywords.slice(0, 6).map((keyword) => <Badge key={keyword} variant="outline">#{keyword}</Badge>)}
            </div>}
          </header>

          <Tabs defaultValue="content" className="mt-5 min-w-0">
            <TabsList>
              <TabsTrigger value="content">{t("microcourseContentTab")}</TabsTrigger>
              <TabsTrigger value="management">{t("microcourseManagementTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="mt-0">
              <TeachingPlan baseHref={selectedBaseHref} teachingPlan={detail.teachingPlan} canManage={canManage} compact />
            </TabsContent>
            <TabsContent value="management" className="mt-4">
              <div className="grid gap-4 @4xl/page:grid-cols-3">
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
            </TabsContent>
          </Tabs>
        </>}
      </section>
    </div>
    {lecturePreview}
  </ObjectWorkspace>;
}
