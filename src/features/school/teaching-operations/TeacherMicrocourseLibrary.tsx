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
  return `/dashboard/courses/${familyId}?${params.toString()}`;
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
  const structureGroups = (["single", "short", "series"] as const).map((structure) => ({
    structure,
    entries: filteredEntries.filter((entry) => teacherMicrocourseStructure(entry.lectureCount) === structure),
  })).filter((group) => group.entries.length > 0);

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
    <section className="min-w-0" aria-labelledby="microcourse-results-heading">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 id="microcourse-results-heading" className="font-display text-2xl text-ink">{t("microcourseCatalog")}</h2>
          <p className="mt-1 text-sm text-muted">{t("microcourseResultCount", { count: filteredEntries.length })}</p>
        </div>
        {filteredEntries.length !== entries.length && <span className="text-xs tabular-nums text-muted">{filteredEntries.length}/{entries.length}</span>}
      </div>

      {filteredEntries.length === 0 ? <DashboardEmptyCard>{t("microcourseNoResults")}</DashboardEmptyCard> : <div className="space-y-7">
        {structureGroups.map((group) => <section key={group.structure} aria-labelledby={`microcourse-${group.structure}-heading`}>
          <div className="mb-3 flex items-center gap-3">
            <h3 id={`microcourse-${group.structure}-heading`} className="text-sm font-medium text-ink">{t(`microcourseStructure_${group.structure}`)}</h3>
            <span className="text-xs tabular-nums text-muted">{group.entries.length}</span>
            <span className="h-px flex-1 bg-line/70" aria-hidden />
          </div>
          <div className="grid min-w-0 gap-3 @3xl/page:grid-cols-2 @6xl/page:grid-cols-3">
            {group.entries.map((entry) => {
              const ready = teacherMicrocourseIsReady(entry);
              const ReadyIcon = ready ? CheckCircle2 : CircleDashed;
              const topic = entry.topics[0];
              return <Link
                key={entry.id}
                href={entryHref(detail.family.id, entry.id, filters, returnTo)}
                aria-label={`${t("microcourseViewDetails")}：${entry.title}`}
                className="group flex min-h-44 min-w-0 flex-col rounded-2xl border border-line bg-card px-5 py-4 transition hover:-translate-y-0.5 hover:border-crater/60 hover:bg-paper/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crater"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h4 className="truncate font-display text-xl text-ink">{entry.title}</h4>
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

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {topic && <Badge variant="outline">{locale === "en" ? topic.titleEn : topic.titleZh}</Badge>}
                  {entry.keywords.slice(0, 2).map((keyword) => <Badge key={keyword} variant="outline">#{keyword}</Badge>)}
                </div>

                <div className="mt-auto flex items-end justify-between gap-4 pt-5 text-xs text-muted">
                  <p className="min-w-0 truncate">
                    {t("microcourseCardMeta", {
                      lectures: entry.lectureCount,
                      grade: entry.grade,
                      season: t(seasonLabelKey(entry.courseSeason)),
                    })}
                  </p>
                  <span className="shrink-0 font-medium text-ink transition group-hover:text-crater">{t("microcourseViewDetails")} →</span>
                </div>
              </Link>;
            })}
          </div>
        </section>)}
      </div>}
    </section>

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
