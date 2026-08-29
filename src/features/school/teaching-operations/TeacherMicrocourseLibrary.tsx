import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardEmptyCard,
} from "@/features/school/dashboard-page";
import {
  ObjectBar,
  ObjectWorkspace,
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
import { compareCourseDifficulty } from "./course-difficulty";
import {
  teacherMicrocourseIsReady,
  teacherMicrocourseLibrarySearchParams,
  type TeacherMicrocourseLibraryEntry,
  type TeacherMicrocourseLibraryFilters,
} from "./teacher-microcourse-library";
import { TeacherMicrocourseLibraryFilters as FilterControls } from "./TeacherMicrocourseLibraryFilters";
import { UsagePanel } from "./UsagePanel";
import { COURSE_SEASONS, type CourseSeason } from "./types";

function entryHref(
  familyId: string,
  entryId: string,
  filters: TeacherMicrocourseLibraryFilters,
  returnTo: string | null,
) {
  const params = teacherMicrocourseLibrarySearchParams(filters);
  params.set("variant", entryId);
  if (returnTo) params.set("returnTo", returnTo);
  return `/dashboard/courses/${familyId}?${params.toString()}`;
}

function seasonLabelKey(season: CourseSeason | null) {
  if (season === null) return "courseSeasonUnspecified";
  return ["summer", "autumn", "winter", "spring"][season - 1];
}

function coverageHref(
  familyId: string,
  grade: number,
  season: CourseSeason | null,
  returnTo: string | null,
) {
  const params = new URLSearchParams();
  params.set("mcGrade", String(grade));
  params.set("mcSeason", season === null ? "unspecified" : String(season));
  if (returnTo) params.set("returnTo", returnTo);
  return `/dashboard/courses/${familyId}?${params.toString()}#microcourse-filtered-results`;
}

function topicHref(familyId: string, topic: string, returnTo: string | null) {
  const params = new URLSearchParams();
  params.set("mcTopic", topic);
  if (returnTo) params.set("returnTo", returnTo);
  return `/dashboard/courses/${familyId}?${params.toString()}#microcourse-filtered-results`;
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
  const maxGrade = Math.max(6, ...entries.map((entry) => entry.grade));
  const coverageGrades = Array.from({ length: maxGrade > 6 ? 9 : 6 }, (_, index) => index + 1);
  const seasonalCoverageCells = coverageGrades.flatMap((grade) => COURSE_SEASONS.map((season) => ({
    grade,
    season: season.value,
    entries: entries.filter((entry) => entry.grade === grade && (entry.courseSeason === season.value || entry.courseSeason === null)),
  })));
  const coveredCellCount = seasonalCoverageCells.filter((cell) => cell.entries.length > 0).length;
  const totalCellCount = seasonalCoverageCells.length;
  const crossSeasonEntries = entries.filter((entry) => entry.courseSeason === null);
  const universalDifficultyEntries = entries.filter((entry) => entry.classType.trim() === "");
  const topicIndex = topics.map((topic) => ({
    ...topic,
    entries: entries.filter((entry) => entry.topics.some((entryTopic) => entryTopic.slug === topic.slug)),
  })).sort((left, right) => right.entries.length - left.entries.length || left.label.localeCompare(right.label));
  const hasActiveFilters = Object.values(filters).some((value) => value !== undefined);

  return <ObjectWorkspace
    objectBar={<ObjectBar
      title={detail.family.title}
      backHref={returnTo ?? "/dashboard/courses"}
      backLabel={t("backToLibrary")}
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
    <section className="min-w-0" aria-labelledby="microcourse-coverage-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h2 id="microcourse-coverage-heading" className="font-display text-2xl text-ink">{t("microcourseCoverageTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{t("microcourseCoverageHint")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-xs text-muted">
          <span>{t("microcourseCoverageCells", { covered: coveredCellCount, total: totalCellCount })}</span>
          <span>{t("microcourseCoverageGaps", { count: totalCellCount - coveredCellCount })}</span>
          <span>{t("microcourseAll")} {entries.length}</span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted" aria-label={t("microcourseCoverageLegend")}>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-crater/35" aria-hidden />{t("microcourseCoverageDirect")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-dashed border-crater" aria-hidden />{t("microcourseCoverageShared")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-dashed border-line" aria-hidden />{t("microcourseCoverageEmpty")}</span>
      </div>

      {/* doc24 §7.2：这是与 VariantMatrix 同类的具名宽矩阵，只允许矩阵内部横向滚动，
          Dashboard 主画布本身仍保持无横向溢出。 */}
      <div data-microcourse-coverage-matrix className="overflow-x-auto rounded-2xl border border-line bg-card p-3">
        <div className="grid min-w-[980px] gap-2" style={{ gridTemplateColumns: "5.5rem repeat(5, minmax(10rem, 1fr))" }}>
          <div />
          {COURSE_SEASONS.map((season) => <div key={season.value} className="px-2 py-1 text-center text-xs font-medium text-muted">{t(season.labelKey)}</div>)}
          <div className="px-2 py-1 text-center text-xs font-medium text-muted">{t("microcourseCrossSeason")}</div>

          {coverageGrades.map((grade) => <div key={grade} className="contents">
            <div className="flex items-center px-2 text-sm font-medium text-ink">{t("gradeRowLabel", { grade })}</div>
            {[...COURSE_SEASONS.map((season) => season.value), null].map((season) => {
              const directEntries = entries.filter((entry) => entry.grade === grade && entry.courseSeason === season);
              const sharedEntries = season === null
                ? directEntries
                : entries.filter((entry) => entry.grade === grade && entry.courseSeason === null);
              const cellEntries = season === null ? directEntries : [...directEntries, ...sharedEntries];
              const sharedOnly = directEntries.length === 0 && sharedEntries.length > 0;
              const crossSeasonPool = season === null && cellEntries.length > 0;
              const readyCount = cellEntries.filter(teacherMicrocourseIsReady).length;
              const difficulties = Array.from(cellEntries.reduce((counts, entry) => {
                const key = entry.classType.trim() || "__universal__";
                counts.set(key, (counts.get(key) ?? 0) + 1);
                return counts;
              }, new Map<string, number>())).sort(([left], [right]) => compareCourseDifficulty(left, right));
              const visibleEntries = cellEntries.slice(0, 2);
              return <div
                key={season ?? "cross"}
                className={cn(
                  "min-h-24 rounded-xl border p-2.5",
                  cellEntries.length === 0 && "border-dashed border-line/80 bg-paper/30",
                  (sharedOnly || crossSeasonPool) && "border-dashed border-crater/50 bg-moon/10",
                  directEntries.length > 0 && !crossSeasonPool && "border-crater/25 bg-crater/[0.06]",
                )}
              >
                {cellEntries.length === 0 ? <div className="flex h-full min-h-16 items-center justify-center text-xs text-muted/60">{t("microcourseCoverageEmpty")}</div> : <>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span>{t("microcourseCoverageCellCount", { count: cellEntries.length })}</span>
                    <span>{t("microcourseCoverageReadyCount", { count: readyCount })}</span>
                  </div>
                  {difficulties.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">
                    {difficulties.map(([difficulty, count]) => <span key={difficulty} className="rounded-full border border-line/80 px-1.5 py-0.5 text-[10px] text-muted">
                      {difficulty === "__universal__" ? t("microcourseUniversalDifficulty") : difficulty} {count}
                    </span>)}
                  </div>}
                  <div className="mt-2 space-y-1">
                    {visibleEntries.map((entry) => {
                      const ready = teacherMicrocourseIsReady(entry);
                      const ReadyIcon = ready ? CheckCircle2 : CircleDashed;
                      return <Link
                        key={entry.id}
                        href={entryHref(detail.family.id, entry.id, {}, returnTo)}
                        className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-ink transition hover:bg-paper"
                      >
                        <ReadyIcon className={cn("size-3 shrink-0", ready ? "text-emerald-600 dark:text-emerald-300" : "text-muted")} aria-hidden />
                        <span className="truncate">{entry.title}</span>
                        {entry.courseSeason === null && season !== null && <span className="shrink-0 text-[10px] text-crater">{t("microcourseCoverageSharedShort")}</span>}
                      </Link>;
                    })}
                  </div>
                  {cellEntries.length > visibleEntries.length && <Link
                    href={coverageHref(detail.family.id, grade, season, returnTo)}
                    className="mt-1.5 block text-right text-[11px] text-muted transition hover:text-ink"
                  >{t("microcourseCoverageMore", { count: cellEntries.length - visibleEntries.length })} →</Link>}
                </>}
              </div>;
            })}
          </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 @4xl/page:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 rounded-2xl border border-line bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h3 className="font-medium text-ink">{t("microcourseTopicIndex")}</h3>
              <p className="mt-1 text-xs text-muted">{t("microcourseTopicIndexHint")}</p>
            </div>
          </div>
          {topicIndex.length === 0 ? <p className="mt-3 text-xs text-muted">{t("microcourseTopicIndexEmpty")}</p> : <div className="mt-3 flex flex-wrap gap-2">
            {topicIndex.map((topic) => {
              const grades = Array.from(new Set(topic.entries.map((entry) => entry.grade))).sort((left, right) => left - right).join("、");
              const seasons = Array.from(new Set(topic.entries.map((entry) => entry.courseSeason)))
                .sort((left, right) => (left ?? 9) - (right ?? 9))
                .map((season) => t(seasonLabelKey(season))).join("、");
              return <Link
                key={topic.slug}
                href={topicHref(detail.family.id, topic.slug, returnTo)}
                className="rounded-xl border border-line px-3 py-2 transition hover:border-crater hover:bg-paper"
              >
                <span className="block text-sm font-medium text-ink">{topic.label} · {topic.entries.length}</span>
                <span className="mt-0.5 block text-[11px] text-muted">{t("microcourseTopicIndexMeta", { grades, seasons })}</span>
              </Link>;
            })}
          </div>}
        </div>
        <div className="flex min-w-56 flex-col justify-center gap-2 rounded-2xl border border-line bg-card px-4 py-3 text-xs text-muted">
          <span className="flex items-center justify-between gap-6"><span>{t("microcourseCrossSeason")}</span><strong className="font-medium tabular-nums text-ink">{crossSeasonEntries.length}</strong></span>
          <span className="flex items-center justify-between gap-6"><span>{t("microcourseUniversalDifficulty")}</span><strong className="font-medium tabular-nums text-ink">{universalDifficultyEntries.length}</strong></span>
          <span className="border-t border-line pt-2 leading-5">{t("microcourseCrossGradeNote")}</span>
        </div>
      </div>
    </section>

    {hasActiveFilters && <section id="microcourse-filtered-results" className="mt-8 scroll-mt-28" aria-labelledby="microcourse-results-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="microcourse-results-heading" className="font-display text-xl text-ink">{t("microcourseFilteredResults")}</h2>
          <p className="mt-1 text-sm text-muted">{t("microcourseResultCount", { count: filteredEntries.length })}</p>
        </div>
      </div>
      {filteredEntries.length === 0 ? <DashboardEmptyCard>{t("microcourseNoResults")}</DashboardEmptyCard> : <div className="grid gap-3 @3xl/page:grid-cols-2 @6xl/page:grid-cols-3">
        {filteredEntries.map((entry) => {
              const ready = teacherMicrocourseIsReady(entry);
              const ReadyIcon = ready ? CheckCircle2 : CircleDashed;
              const topic = entry.topics[0];
              return <Link
                key={entry.id}
                href={entryHref(detail.family.id, entry.id, filters, returnTo)}
                aria-label={`${t("microcourseViewDetails")}：${entry.title}`}
                className="group min-w-0 rounded-xl border border-line bg-card px-4 py-3 transition hover:border-crater/60 hover:bg-paper/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crater"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium text-ink">{entry.title}</h3>
                    <p className="mt-1 truncate text-xs text-muted">{t("microcourseSourceByline", {
                      author: entry.authorName,
                      classroom: entry.sourceClassroomName,
                    })}</p>
                  </div>
                  <span className={cn("flex shrink-0 items-center gap-1 text-xs", ready ? "text-emerald-700 dark:text-emerald-300" : "text-muted")}>
                    <ReadyIcon className="size-3.5" aria-hidden />
                    {ready ? t("microcourseReady") : t("microcourseNeedsWork")}
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-4 text-xs text-muted">
                  <p className="min-w-0 truncate">
                    {t("microcourseCardMeta", {
                      lectures: entry.lectureCount,
                      grade: entry.grade,
                      season: t(seasonLabelKey(entry.courseSeason)),
                    })}
                    {topic ? ` · ${locale === "en" ? topic.titleEn : topic.titleZh}` : ""}
                  </p>
                  <span className="shrink-0 font-medium text-ink transition group-hover:text-crater">{t("microcourseViewDetails")} →</span>
                </div>
              </Link>;
        })}
      </div>}
    </section>}

    {selectedEntry && selectedVariant && <Sheet defaultOpen>
      <SheetContent side="right" closeLabel={t("microcourseCloseDetails")} className="w-[min(96vw,72rem)] max-w-none p-0">
        <SheetHeader className="border-b border-line px-6 py-5 pr-16">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-3xl">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={selectedVariant.status === "enabled" ? "secondary" : "outline"}>{t(selectedVariant.status)}</Badge>
                <Badge variant={selectedReady ? "secondary" : "outline"}>{selectedReady ? t("microcourseReady") : t("microcourseNeedsWork")}</Badge>
              </div>
              <SheetTitle className="text-3xl">{selectedEntry.title}</SheetTitle>
              <SheetDescription>{t("microcourseSourceByline", {
                author: selectedEntry.authorName,
                classroom: selectedEntry.sourceClassroomName,
              })}</SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2 pr-8">
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

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{t("microcourseCardMeta", {
              lectures: selectedEntry.lectureCount,
              grade: selectedEntry.grade,
              season: t(seasonLabelKey(selectedEntry.courseSeason)),
            })}</span>
            <span aria-hidden>·</span>
            <span>{t("publishedLectures")} {selectedEntry.releasedLectureCount}/{selectedEntry.lectureCount}</span>
            <span aria-hidden>·</span>
            <span>{t("pagesLabel")} {detail.readiness.pageCount}</span>
            {canViewUsage && <><span aria-hidden>·</span><span>{t("usingClasses")} {detail.usage.length}</span></>}
          </div>

          {(selectedEntry.topics.length > 0 || selectedEntry.keywords.length > 0) && <div className="flex flex-wrap gap-1.5">
            {selectedEntry.topics.map((topic) => <Badge key={topic.slug} variant="outline">{locale === "en" ? topic.titleEn : topic.titleZh}</Badge>)}
            {selectedEntry.keywords.slice(0, 4).map((keyword) => <Badge key={keyword} variant="outline">#{keyword}</Badge>)}
          </div>}
        </SheetHeader>

        <div className="@container/detail px-6 py-5">
          <Tabs defaultValue="content" className="min-w-0">
            <TabsList>
              <TabsTrigger value="content">{t("microcourseContentTab")}</TabsTrigger>
              <TabsTrigger value="management">{t("microcourseManagementTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="mt-0">
              <TeachingPlan baseHref={selectedBaseHref} teachingPlan={detail.teachingPlan} canManage={canManage} compact />
            </TabsContent>
            <TabsContent value="management" className="mt-4">
              <div className="grid gap-4 @4xl/detail:grid-cols-3">
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
        </div>
      </SheetContent>
    </Sheet>}
    {lecturePreview}
  </ObjectWorkspace>;
}
