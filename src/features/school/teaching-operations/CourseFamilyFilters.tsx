import { getTranslations } from "next-intl/server";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { FilterBar, FilterBarMore, FilterBarReset, FilterBarSubmit, FilterSearchInput, FilterSelectTrigger } from "@/features/school/FilterBar";
import { toSelectValue } from "@/features/school/controls";
import { COURSE_SEASONS, type CourseCatalogVersionOption, type CourseFamilyFilters as Filters } from "./course-queries";

const selectTriggerClassName = "h-11 w-full min-w-0 @3xl/chrome:h-9";

// 筛选留在 GET 表单内；手机上的面板限高滚动，底部可直接提交所选条件。
export async function CourseFamilyFilters({ filters, versionOptions }: { filters: Filters; versionOptions: CourseCatalogVersionOption[] }) {
  const t = await getTranslations("school.courses");
  const activeCount = [filters.q, filters.grade, filters.courseSeason, filters.classType, filters.catalogVersion, filters.familyStatus, filters.variantStatus, filters.purpose, filters.readiness].filter(Boolean).length;
  return <FilterBar aria-label={t("filter")} className="[&_summary]:min-h-11 [&_[data-dashboard-search]_button]:size-11 @3xl/chrome:[&_summary]:min-h-9 @3xl/chrome:[&_[data-dashboard-search]_button]:size-9">
    <FilterSearchInput name="q" defaultValue={filters.q} maxLength={80} placeholder={t("searchFamilies")} aria-label={t("searchFamilies")} />
    <FilterBarMore label={t("moreFilters")} activeCount={activeCount} className="@container/course-filters max-h-[min(32rem,65dvh)] overflow-y-auto overscroll-contain p-3 @3xl/chrome:p-4">
        <div className="grid gap-3 @sm/course-filters:grid-cols-2">
          <Select name="grade" defaultValue={toSelectValue(filters.grade?.toString() ?? "")}><FilterSelectTrigger className={selectTriggerClassName} aria-label={t("gradeLabel")}><SelectValue placeholder={t("allGrades")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allGrades")}</SelectItem>{Array.from({ length: 9 }, (_, index) => index + 1).map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}</SelectContent></Select>
          <Select name="courseSeason" defaultValue={toSelectValue(filters.courseSeason?.toString() ?? "")}><FilterSelectTrigger className={selectTriggerClassName} aria-label={t("courseSeason")}><SelectValue placeholder={t("allCourseSeasons")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allCourseSeasons")}</SelectItem>{COURSE_SEASONS.map((season) => <SelectItem key={season.value} value={String(season.value)}>{t(season.labelKey)}</SelectItem>)}</SelectContent></Select>
          <Select name="classType" defaultValue={toSelectValue(filters.classType ?? "")}><FilterSelectTrigger className={selectTriggerClassName} aria-label={t("classType")}><SelectValue placeholder={t("allTypes")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allTypes")}</SelectItem>{["A", "B", "S"].map((classType) => <SelectItem key={classType} value={classType}>{classType}</SelectItem>)}</SelectContent></Select>
          {/* 只有真正发生过教材年度换代时才出现——全库都是单一版本时它是一个只有
              "全部" 一项的空筛选。 */}
          {versionOptions.length > 0 && <Select name="catalogVersion" defaultValue={toSelectValue(filters.catalogVersion ?? "")}><FilterSelectTrigger className={selectTriggerClassName} aria-label={t("catalogVersion")}><SelectValue placeholder={t("allCatalogVersions")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allCatalogVersions")}</SelectItem>{versionOptions.map((option) => <SelectItem key={option.slug} value={option.slug}>{option.title}</SelectItem>)}</SelectContent></Select>}
          <Select name="familyStatus" defaultValue={toSelectValue(filters.familyStatus ?? "")}><FilterSelectTrigger className={selectTriggerClassName} aria-label={t("allFamilyStatuses")}><SelectValue placeholder={t("allFamilyStatuses")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allFamilyStatuses")}</SelectItem><SelectItem value="draft">{t("draft")}</SelectItem><SelectItem value="enabled">{t("enabled")}</SelectItem><SelectItem value="disabled">{t("disabled")}</SelectItem></SelectContent></Select>
          <Select name="variantStatus" defaultValue={toSelectValue(filters.variantStatus ?? "")}><FilterSelectTrigger className={selectTriggerClassName} aria-label={t("allVariantStatuses")}><SelectValue placeholder={t("allVariantStatuses")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allVariantStatuses")}</SelectItem><SelectItem value="draft">{t("draft")}</SelectItem><SelectItem value="enabled">{t("enabled")}</SelectItem><SelectItem value="disabled">{t("disabled")}</SelectItem></SelectContent></Select>
          <Select name="purpose" defaultValue={toSelectValue(filters.purpose ?? "")}><FilterSelectTrigger className={selectTriggerClassName} aria-label={t("allPurposes")}><SelectValue placeholder={t("allPurposes")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allPurposes")}</SelectItem><SelectItem value="production">{t("production")}</SelectItem><SelectItem value="test">{t("test")}</SelectItem></SelectContent></Select>
          <Select name="readiness" defaultValue={toSelectValue(filters.readiness ?? "")}><FilterSelectTrigger className={selectTriggerClassName} aria-label={t("allReadiness")}><SelectValue placeholder={t("allReadiness")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allReadiness")}</SelectItem><SelectItem value="ready">{t("ready")}</SelectItem><SelectItem value="incomplete">{t("incomplete")}</SelectItem></SelectContent></Select>
        </div>
        <div className="mt-3 flex justify-end border-t border-line pt-3">
          <FilterBarSubmit className="min-h-11 w-full @sm/course-filters:w-auto @3xl/chrome:min-h-9">{t("filter")}</FilterBarSubmit>
        </div>
    </FilterBarMore>
    <FilterBarSubmit className="min-h-11 @3xl/chrome:min-h-9">{t("filter")}</FilterBarSubmit>
    {activeCount > 0 && <FilterBarReset href="/dashboard/courses" label={t("clearFilters")} className="min-h-11 @3xl/chrome:min-h-9" />}
  </FilterBar>;
}
