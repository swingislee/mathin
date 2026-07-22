import { SlidersHorizontal } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { toSelectValue } from "@/features/school/controls";
import { COURSE_SEASONS, type CourseFamilyFilters as Filters } from "./course-queries";

/**
 * 压缩单行搜索：搜索框+提交+清除都在一行；6 个次要 Select 收进一个 `<details>`
 * 下拉面板（`absolute` 定位悬浮展开，不占额外行高）。这里不用 `Popover`——
 * Radix Popover 用 Portal 把内容挪到 `<form>` 之外，会导致 Portal 里的
 * `<Select>` 隐藏原生 select 一起被挪出表单 DOM 子树，GET 表单提交时这些
 * 字段值会丢失；`<details>` 留在原地不 Portal，没有这个问题。
 */
export async function CourseFamilyFilters({ filters }: { filters: Filters }) {
  const t = await getTranslations("school.courses");
  return <form className="relative mt-5 flex flex-wrap items-center gap-2 border-b border-line pb-4">
    <Input name="q" defaultValue={filters.q} maxLength={80} placeholder={t("searchFamilies")} aria-label={t("searchFamilies")} className="min-w-0 flex-1 sm:max-w-sm" />
    <Button type="submit" size="sm" className="h-10">{t("filter")}</Button>
    <details className="relative">
      <summary className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-10 cursor-pointer list-none")}>
        <SlidersHorizontal className="size-4" />{t("moreFilters")}
      </summary>
      <div className="absolute right-0 top-full z-10 mt-2 w-80 rounded-2xl border border-line bg-card p-4 shadow-md">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select name="grade" defaultValue={toSelectValue(filters.grade?.toString() ?? "")}><SelectTrigger><SelectValue placeholder={t("allGrades")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allGrades")}</SelectItem>{Array.from({ length: 9 }, (_, index) => index + 1).map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}</SelectContent></Select>
          <Select name="courseSeason" defaultValue={toSelectValue(filters.courseSeason?.toString() ?? "")}><SelectTrigger><SelectValue placeholder={t("allCourseSeasons")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allCourseSeasons")}</SelectItem>{COURSE_SEASONS.map((season) => <SelectItem key={season.value} value={String(season.value)}>{t(season.labelKey)}</SelectItem>)}</SelectContent></Select>
          <Select name="classType" defaultValue={toSelectValue(filters.classType ?? "")}><SelectTrigger><SelectValue placeholder={t("allTypes")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allTypes")}</SelectItem>{["A", "B", "S"].map((classType) => <SelectItem key={classType} value={classType}>{classType}</SelectItem>)}</SelectContent></Select>
          <Select name="familyStatus" defaultValue={toSelectValue(filters.familyStatus ?? "")}><SelectTrigger><SelectValue placeholder={t("allFamilyStatuses")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allFamilyStatuses")}</SelectItem><SelectItem value="draft">{t("draft")}</SelectItem><SelectItem value="enabled">{t("enabled")}</SelectItem><SelectItem value="disabled">{t("disabled")}</SelectItem></SelectContent></Select>
          <Select name="variantStatus" defaultValue={toSelectValue(filters.variantStatus ?? "")}><SelectTrigger><SelectValue placeholder={t("allVariantStatuses")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allVariantStatuses")}</SelectItem><SelectItem value="draft">{t("draft")}</SelectItem><SelectItem value="enabled">{t("enabled")}</SelectItem><SelectItem value="disabled">{t("disabled")}</SelectItem></SelectContent></Select>
          <Select name="purpose" defaultValue={toSelectValue(filters.purpose ?? "")}><SelectTrigger><SelectValue placeholder={t("allPurposes")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allPurposes")}</SelectItem><SelectItem value="production">{t("production")}</SelectItem><SelectItem value="test">{t("test")}</SelectItem></SelectContent></Select>
          <Select name="readiness" defaultValue={toSelectValue(filters.readiness ?? "")}><SelectTrigger><SelectValue placeholder={t("allReadiness")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allReadiness")}</SelectItem><SelectItem value="ready">{t("ready")}</SelectItem><SelectItem value="incomplete">{t("incomplete")}</SelectItem></SelectContent></Select>
        </div>
      </div>
    </details>
    <Link href="/dashboard/courses" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9")}>{t("clearFilters")}</Link>
  </form>;
}
