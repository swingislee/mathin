import { ArrowRight, CircleAlert, School, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ClassroomListItem } from "./teaching-operations/classroom-queries";
import type { ClassroomScope } from "./teaching-operations/types";

const PRIMARY_ACTION_KEY: Record<ClassroomScope, string> = {
  teaching: "openTeaching",
  support: "openSupport",
  all: "openManagement",
  test: "openManagement",
};

export async function ClassroomList({
  classrooms,
  totalCount,
  scope,
  hasFilters,
  resetHref,
}: {
  classrooms: ClassroomListItem[];
  totalCount: number;
  scope: ClassroomScope;
  hasFilters: boolean;
  resetHref: string;
}) {
  const t = await getTranslations("school.classes");
  if (classrooms.length === 0) {
    return <div className="mt-6 rounded-2xl border border-dashed border-line bg-card p-8 text-center">
      <p className="text-sm text-muted">{t("empty")}</p>
      {hasFilters && <Link href={resetHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4")}>{t("clearFilters")}</Link>}
    </div>;
  }

  return <div className="mt-6 space-y-4">
    <p className="text-sm text-muted">{t("results", { count: totalCount })}</p>
    <div className="grid gap-4 xl:grid-cols-2">
      {classrooms.map((classroom) => <article key={classroom.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:flex-row">
        <div className="flex size-24 shrink-0 items-center justify-center rounded-xl border border-crater/40 bg-moon/30 text-crater" aria-hidden="true"><School className="size-9" strokeWidth={1.5} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-display text-xl text-ink">{classroom.name}</h2>
              <p className="mt-1 text-sm text-muted">{[classroom.courseFamilyTitle, classroom.courseTitle, classroom.courseProductCode].filter(Boolean).join(" · ") || t("freeClass")}</p>
            </div>
            <div className="flex gap-1.5">
              <Badge variant={classroom.operationalStatus === "active" ? "secondary" : "outline"}>{t(classroom.operationalStatus === "active" ? "operationalActive" : classroom.operationalStatus)}</Badge>
              {classroom.purpose === "test" && <Badge variant="outline">{t("test")}</Badge>}
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">
            {classroom.primaryTeacherName ?? t("noPrimaryTeacher")}
            {classroom.learningSupportNames.length > 0 && ` · ${t("learningSupport")}: ${classroom.learningSupportNames.join("、")}`}
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-paper p-2"><dt className="flex items-center gap-1 text-muted"><Users className="size-3.5" />{t("size")}</dt><dd className="mt-1 font-medium text-ink">{classroom.enrolledCount}{classroom.capacity ? ` / ${classroom.capacity}` : ""}</dd></div>
            <div className="rounded-lg bg-paper p-2"><dt className="text-muted">{t("sessionProgress")}</dt><dd className="mt-1 font-medium text-ink">{classroom.sessionDoneCount}/{classroom.sessionTotalCount}</dd></div>
            <div className="rounded-lg bg-paper p-2"><dt className="text-muted">{t("nextSession")}</dt><dd className="mt-1 font-medium text-ink">{classroom.nextSessionAt ? new Date(classroom.nextSessionAt).toLocaleDateString() : t("notApplicable")}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className={cn("flex items-center gap-1 text-xs", classroom.anomalyCount > 0 || classroom.readiness === "incomplete" ? "text-rose" : "text-leaf-deep")}>
              <CircleAlert className="size-3.5" />
              {classroom.anomalyCount > 0 ? t("anomalyCount", { count: classroom.anomalyCount }) : classroom.readiness === "incomplete" ? t("readinessIssue") : t("readinessComplete")}
            </p>
            <Link href={`/dashboard/classes/${classroom.id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0")}>{t(PRIMARY_ACTION_KEY[scope])}<ArrowRight className="size-4" /></Link>
          </div>
        </div>
      </article>)}
    </div>
  </div>;
}
