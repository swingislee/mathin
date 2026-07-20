import { getTranslations } from "next-intl/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { toSelectValue } from "./controls";
import { listSchoolTerms } from "./courses";
import { listStaffOptions } from "./classes";
import type { ClassroomListFilters as Filters } from "./teaching-operations/classroom-queries";
import type { ClassroomScope } from "./teaching-operations/types";

export async function ClassroomFilters({ filters, scope }: { filters: Filters; scope: ClassroomScope }) {
  const [t, staff, terms] = await Promise.all([
    getTranslations("school.classes"),
    listStaffOptions(),
    listSchoolTerms(),
  ]);

  return <form className="mt-5 rounded-2xl border border-line bg-card p-4">
    <Input type="hidden" name="scope" value={scope} aria-hidden="true" className="hidden" tabIndex={-1} />
    <div className="grid gap-3 md:grid-cols-[minmax(14rem,1fr)_9rem_auto] md:items-end">
      <Input name="q" defaultValue={filters.q} maxLength={80} placeholder={t("searchClasses")} aria-label={t("searchClasses")} />
      <Select name="grade" defaultValue={toSelectValue(filters.grade?.toString() ?? "")}><SelectTrigger><SelectValue placeholder={t("allGrades")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allGrades")}</SelectItem>{Array.from({ length: 12 }, (_, index) => index + 1).map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}</SelectContent></Select>
      <Button type="submit" size="sm" className="h-10">{t("filter")}</Button>
    </div>
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-sm text-muted hover:text-ink">{t("moreFilters")}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select name="teacherId" defaultValue={toSelectValue(filters.teacherId ?? "")}><SelectTrigger><SelectValue placeholder={t("allTeachers")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allTeachers")}</SelectItem>{staff.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent></Select>
        <Select name="supportId" defaultValue={toSelectValue(filters.supportId ?? "")}><SelectTrigger><SelectValue placeholder={t("allSupport")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allSupport")}</SelectItem>{staff.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent></Select>
        <Select name="schoolTermId" defaultValue={toSelectValue(filters.schoolTermId ?? "")}><SelectTrigger><SelectValue placeholder={t("allSchoolTerms")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allSchoolTerms")}</SelectItem>{terms.map((term) => <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>)}</SelectContent></Select>
        <Select name="operationalStatus" defaultValue={toSelectValue(filters.operationalStatus ?? "")}><SelectTrigger><SelectValue placeholder={t("allOperationalStatuses")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allOperationalStatuses")}</SelectItem><SelectItem value="planning">{t("planning")}</SelectItem><SelectItem value="active">{t("operationalActive")}</SelectItem><SelectItem value="completed">{t("completed")}</SelectItem></SelectContent></Select>
        <Select name="purpose" defaultValue={toSelectValue(filters.purpose ?? "")}><SelectTrigger><SelectValue placeholder={t("allPurposes")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allPurposes")}</SelectItem><SelectItem value="production">{t("production")}</SelectItem><SelectItem value="test">{t("test")}</SelectItem></SelectContent></Select>
        <Select name="readiness" defaultValue={toSelectValue(filters.readiness ?? "")}><SelectTrigger><SelectValue placeholder={t("allReadiness")} /></SelectTrigger><SelectContent><SelectItem value={toSelectValue("")}>{t("allReadiness")}</SelectItem><SelectItem value="ready">{t("ready")}</SelectItem><SelectItem value="incomplete">{t("incomplete")}</SelectItem></SelectContent></Select>
      </div>
    </details>
    <div className="mt-3 flex justify-end"><Link href={`/dashboard/classes?scope=${scope}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9")}>{t("clearFilters")}</Link></div>
  </form>;
}
