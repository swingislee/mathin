import { getTranslations } from "next-intl/server";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { FilterBar, FilterBarMore, FilterBarReset, FilterBarSubmit, FilterSearchInput, FilterSelectTrigger } from "@/features/school/FilterBar";
import { toSelectValue } from "@/features/school/controls";
import { COURSE_SEASONS, type CourseCatalogVersionOption, type CourseFamilyFilters as Filters } from "./course-queries";

/**
 * 压缩单行搜索：搜索框+提交+清除都在一行；6 个次要 Select 收进一个 `<details>`
 * 下拉面板（`absolute` 定位悬浮展开，不占额外行高）。这里不用 `Popover`——
 * Radix Popover 用 Portal 把内容挪到 `<form>` 之外，会导致 Portal 里的
 * `<Select>` 隐藏原生 select 一起被挪出表单 DOM 子树，GET 表单提交时这些
 * 字段值会丢失；`<details>` 留在原地不 Portal，没有这个问题。
 */
export async function CourseFamilyFilters({ filters, versionOptions }: { filters: Filters; versionOptions: CourseCatalogVersionOption[] }) {
  const t = await getTranslations("school.courses");
  const activeCount = [filters.q, filters.grade, filters.courseSeason, filters.classType, filters.catalogVersion, filters.familyStatus, filters.variantStatus, filters.purpose, filters.readiness].filter(Boolean).length;
  return <FilterBar aria-label={t("filter")}>
    <FilterSearchInput name="q" defaultValue={filters.q} maxLength={80} placeholder={t("searchFamilies")} aria-label={t("searchFamilies")} />
    <FilterBarMore label={t("moreFilters")} activeCount={activeCount}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select name="grade" defaultValue={toSelectValue(filters.grade?.toString() ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allGrades")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allGrades")}</SelectItem>{Array.from({ length: 9 }, (_, index) => index + 1).map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}</SelectContent></Select>
          <Select name="courseSeason" defaultValue={toSelectValue(filters.courseSeason?.toString() ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allCourseSeasons")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allCourseSeasons")}</SelectItem>{COURSE_SEASONS.map((season) => <SelectItem key={season.value} value={String(season.value)}>{t(season.labelKey)}</SelectItem>)}</SelectContent></Select>
          <Select name="classType" defaultValue={toSelectValue(filters.classType ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allTypes")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allTypes")}</SelectItem>{["A", "B", "S"].map((classType) => <SelectItem key={classType} value={classType}>{classType}</SelectItem>)}</SelectContent></Select>
          {/* 只有真正发生过教材年度换代时才出现——全库都是单一版本时它是一个只有
              "全部" 一项的空筛选。 */}
          {versionOptions.length > 0 && <Select name="catalogVersion" defaultValue={toSelectValue(filters.catalogVersion ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allCatalogVersions")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allCatalogVersions")}</SelectItem>{versionOptions.map((option) => <SelectItem key={option.slug} value={option.slug}>{option.title}</SelectItem>)}</SelectContent></Select>}
          <Select name="familyStatus" defaultValue={toSelectValue(filters.familyStatus ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allFamilyStatuses")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allFamilyStatuses")}</SelectItem><SelectItem value="draft">{t("draft")}</SelectItem><SelectItem value="enabled">{t("enabled")}</SelectItem><SelectItem value="disabled">{t("disabled")}</SelectItem></SelectContent></Select>
          <Select name="variantStatus" defaultValue={toSelectValue(filters.variantStatus ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allVariantStatuses")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allVariantStatuses")}</SelectItem><SelectItem value="draft">{t("draft")}</SelectItem><SelectItem value="enabled">{t("enabled")}</SelectItem><SelectItem value="disabled">{t("disabled")}</SelectItem></SelectContent></Select>
          <Select name="purpose" defaultValue={toSelectValue(filters.purpose ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allPurposes")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allPurposes")}</SelectItem><SelectItem value="production">{t("production")}</SelectItem><SelectItem value="test">{t("test")}</SelectItem></SelectContent></Select>
          <Select name="readiness" defaultValue={toSelectValue(filters.readiness ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allReadiness")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allReadiness")}</SelectItem><SelectItem value="ready">{t("ready")}</SelectItem><SelectItem value="incomplete">{t("incomplete")}</SelectItem></SelectContent></Select>
        </div>
    </FilterBarMore>
    <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
    {activeCount > 0 && <FilterBarReset href="/dashboard/courses" label={t("clearFilters")} />}
  </FilterBar>;
}
