import { getTranslations } from "next-intl/server";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { toSelectValue } from "./controls";
import { FilterBar, FilterBarMore, FilterBarReset, FilterBarSubmit, FilterSearchInput, FilterSelectTrigger } from "./FilterBar";
import { listSchoolTerms } from "./courses";
import { listStaffOptions } from "./classes";
import type { ClassroomListFilters as Filters } from "./teaching-operations/classroom-queries";
import type { ClassroomScope } from "./teaching-operations/types";
import { schoolTermLabel } from "./school-periods";

/** scope 切换已上移到命令面板的状态区（ClassroomScopeSwitch），这里只留筛选本身。 */
export async function ClassroomFilters({ filters, scope }: { filters: Filters; scope: ClassroomScope }) {
  const [t, scheduleT, staff, terms] = await Promise.all([
    getTranslations("school.classes"),
    getTranslations("school.schedule"),
    listStaffOptions(),
    listSchoolTerms(),
  ]);

  const activeCount = [filters.q, filters.teacherId, filters.supportId, filters.grade, filters.schoolTermId, filters.operationalStatus, filters.purpose, filters.readiness].filter(Boolean).length;
  return <FilterBar aria-label={t("filter")}>
    <Input type="hidden" name="scope" value={scope} aria-hidden="true" className="hidden" tabIndex={-1} />
    <FilterSearchInput name="q" defaultValue={filters.q} maxLength={80} placeholder={t("searchClasses")} aria-label={t("searchClasses")} />
    <FilterBarMore label={t("moreFilters")} activeCount={activeCount}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select name="grade" defaultValue={toSelectValue(filters.grade?.toString() ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allGrades")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allGrades")}</SelectItem>{Array.from({ length: 12 }, (_, index) => index + 1).map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}</SelectContent></Select>
        <Select name="teacherId" defaultValue={toSelectValue(filters.teacherId ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allTeachers")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allTeachers")}</SelectItem>{staff.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent></Select>
        <Select name="supportId" defaultValue={toSelectValue(filters.supportId ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allSupport")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allSupport")}</SelectItem>{staff.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent></Select>
        <Select name="schoolTermId" defaultValue={toSelectValue(filters.schoolTermId ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allSchoolTerms")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allSchoolTerms")}</SelectItem>{terms.map((term) => <SelectItem key={term.id} value={term.id}>{schoolTermLabel(term, scheduleT(`period${term.term}`))}</SelectItem>)}</SelectContent></Select>
        <Select name="operationalStatus" defaultValue={toSelectValue(filters.operationalStatus ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allOperationalStatuses")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allOperationalStatuses")}</SelectItem><SelectItem value="planning">{t("planning")}</SelectItem><SelectItem value="active">{t("operationalActive")}</SelectItem><SelectItem value="completed">{t("completed")}</SelectItem></SelectContent></Select>
        <Select name="purpose" defaultValue={toSelectValue(filters.purpose ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allPurposes")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allPurposes")}</SelectItem><SelectItem value="production">{t("production")}</SelectItem><SelectItem value="test">{t("test")}</SelectItem></SelectContent></Select>
        <Select name="readiness" defaultValue={toSelectValue(filters.readiness ?? "")}><FilterSelectTrigger className="w-full"><SelectValue placeholder={t("allReadiness")} /></FilterSelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allReadiness")}</SelectItem><SelectItem value="ready">{t("ready")}</SelectItem><SelectItem value="incomplete">{t("incomplete")}</SelectItem></SelectContent></Select>
      </div>
    </FilterBarMore>
    <FilterBarSubmit>{t("filter")}</FilterBarSubmit>
    {activeCount > 0 && <FilterBarReset href={`/dashboard/classes?scope=${scope}`} label={t("clearFilters")} />}
  </FilterBar>;
}
