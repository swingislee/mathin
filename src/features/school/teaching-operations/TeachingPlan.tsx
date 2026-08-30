import { DashboardEmptyState, DashboardTableShell } from "@/features/school/dashboard-page";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { CourseFamilyDetail } from "./course-family-detail";

function previewHref(baseHref: string, lectureId: string) {
  return `${baseHref}&lecture=${lectureId}`;
}

export async function TeachingPlan({
  baseHref,
  teachingPlan,
  canManage,
  compact = false,
  showHeader = true,
}: {
  baseHref: string;
  teachingPlan: CourseFamilyDetail["teachingPlan"];
  canManage: boolean;
  compact?: boolean;
  showHeader?: boolean;
}) {
  const t = await getTranslations("school.courses");
  const lectures = canManage ? teachingPlan : teachingPlan.filter((lecture) => lecture.status !== "archived");
  const archivedCount = teachingPlan.length - lectures.length;
  const previewLink = (lecture: CourseFamilyDetail["teachingPlan"][number]) => lecture.hasRelease
    ? <Link href={previewHref(baseHref, lecture.id)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0")}>{t("preview")}</Link>
    : <span className="text-xs text-muted">{t("coursewareNotReleased")}</span>;

  return <section id="teaching-plan" className={cn(showHeader && (compact ? "mt-5" : "mt-8"), "scroll-mt-6")}>
    {showHeader ? <div className={compact ? "mb-3" : "mb-4"}><h2 className={cn("font-display text-ink", compact ? "text-xl" : "text-2xl")}>{t("teachingPlan")}</h2><p className="mt-1 text-sm text-muted">{t("teachingPlanHint")}</p></div> : null}
    {lectures.length === 0 ? <DashboardEmptyState>{t("teachingPlanEmpty")}</DashboardEmptyState> :
      <DashboardTableShell><Table><TableHeader><TableRow><TableHead>{t("lectureNo")}</TableHead><TableHead>{t("lectureName")}</TableHead><TableHead className="hidden @2xl/page:table-cell">{t("objectives")}</TableHead><TableHead className="hidden @3xl/page:table-cell">{t("pageCount")}</TableHead><TableHead>{t("readiness")}</TableHead><TableHead className="text-right">{t("preview")}</TableHead></TableRow></TableHeader><TableBody>{lectures.map((lecture) => <TableRow key={lecture.id} className={lecture.status === "archived" ? "opacity-60" : undefined}><TableCell className="font-mono text-xs text-muted">{String(lecture.no).padStart(2, "0")}</TableCell><TableCell><p className="font-medium">{lecture.name}</p><p className="mt-0.5 text-xs text-muted @2xl/page:hidden">{lecture.objectives || t("noObjectives")}</p></TableCell><TableCell className="hidden max-w-md text-muted @2xl/page:table-cell">{lecture.objectives || t("noObjectives")}</TableCell><TableCell className="hidden tabular-nums @3xl/page:table-cell">{lecture.pageCount}</TableCell><TableCell>{lecture.hasRelease ? <Badge variant="secondary">{t("published")}</Badge> : <Badge variant="outline">{t("incomplete")}</Badge>}</TableCell><TableCell className="text-right">{previewLink(lecture)}</TableCell></TableRow>)}</TableBody></Table></DashboardTableShell>}
    {archivedCount > 0 && !canManage && <p className="mt-3 text-xs text-muted">{t("archivedLectureHidden", { count: archivedCount })}</p>}
  </section>;
}
