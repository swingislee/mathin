import { getTranslations } from "next-intl/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { toSelectValue } from "@/features/school/controls";
import { COURSE_SEASONS, type CourseFamilyFilters as Filters } from "./course-queries";

/** 紧凑搜索（P4I-9）：默认只露出搜索框 + 提交 + 展开筛选把手，其余 7 个字段全部收进折叠区。 */
export async function CourseFamilyFilters({ filters }: { filters: Filters }) {
  const t = await getTranslations("school.courses");
  return <form className="mt-5 rounded-2xl border border-line bg-card p-4">
    <div className="flex flex-wrap items-center gap-3">
      <Input name="q" defaultValue={filters.q} maxLength={80} placeholder={t("searchFamilies")} aria-label={t("searchFamilies")} className="min-w-0 flex-1 sm:max-w-sm" />
      <Button type="submit" size="sm" className="h-10">{t("filter")}</Button>
    </div>
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-sm text-muted hover:text-ink">{t("moreFilters")}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select name="grade" defaultValue={toSelectValue(filters.grade?.toString() ?? "")}><SelectTrigger><SelectValue placeholder={t("allGrades")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allGrades")}</SelectItem>{Array.from({ length: 9 }, (_, index) => index + 1).map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}</SelectContent></Select>
        <Select name="courseSeason" defaultValue={toSelectValue(filters.courseSeason?.toString() ?? "")}><SelectTrigger><SelectValue placeholder={t("allCourseSeasons")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allCourseSeasons")}</SelectItem>{COURSE_SEASONS.map((season) => <SelectItem key={season.value} value={String(season.value)}>{t(season.labelKey)}</SelectItem>)}</SelectContent></Select>
        <Select name="classType" defaultValue={toSelectValue(filters.classType ?? "")}><SelectTrigger><SelectValue placeholder={t("allTypes")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allTypes")}</SelectItem>{["A", "B", "S"].map((classType) => <SelectItem key={classType} value={classType}>{classType}</SelectItem>)}</SelectContent></Select>
        <Select name="familyStatus" defaultValue={toSelectValue(filters.familyStatus ?? "")}><SelectTrigger><SelectValue placeholder={t("allFamilyStatuses")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allFamilyStatuses")}</SelectItem><SelectItem value="draft">{t("draft")}</SelectItem><SelectItem value="enabled">{t("enabled")}</SelectItem><SelectItem value="disabled">{t("disabled")}</SelectItem></SelectContent></Select>
        <Select name="variantStatus" defaultValue={toSelectValue(filters.variantStatus ?? "")}><SelectTrigger><SelectValue placeholder={t("allVariantStatuses")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allVariantStatuses")}</SelectItem><SelectItem value="draft">{t("draft")}</SelectItem><SelectItem value="enabled">{t("enabled")}</SelectItem><SelectItem value="disabled">{t("disabled")}</SelectItem></SelectContent></Select>
        <Select name="purpose" defaultValue={toSelectValue(filters.purpose ?? "")}><SelectTrigger><SelectValue placeholder={t("allPurposes")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allPurposes")}</SelectItem><SelectItem value="production">{t("production")}</SelectItem><SelectItem value="test">{t("test")}</SelectItem></SelectContent></Select>
        <Select name="readiness" defaultValue={toSelectValue(filters.readiness ?? "")}><SelectTrigger><SelectValue placeholder={t("allReadiness")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allReadiness")}</SelectItem><SelectItem value="ready">{t("ready")}</SelectItem><SelectItem value="incomplete">{t("incomplete")}</SelectItem></SelectContent></Select>
      </div>
    </details>
    <div className="mt-3 flex justify-end"><Link href="/dashboard/courses" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9")}>{t("clearFilters")}</Link></div>
  </form>;
}
