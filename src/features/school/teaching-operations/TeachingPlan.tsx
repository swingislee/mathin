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
}: {
  baseHref: string;
  teachingPlan: CourseFamilyDetail["teachingPlan"];
  canManage: boolean;
}) {
  const t = await getTranslations("school.courses");
  const lectures = canManage ? teachingPlan : teachingPlan.filter((lecture) => lecture.status !== "archived");
  const archivedCount = teachingPlan.length - lectures.length;
  const previewLink = (lecture: CourseFamilyDetail["teachingPlan"][number]) => lecture.hasRelease
    ? <Link href={previewHref(baseHref, lecture.id)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0")}>{t("preview")}</Link>
    : <span className="text-xs text-muted">{t("coursewareNotReleased")}</span>;

  return <section id="teaching-plan" className="mt-8 scroll-mt-6">
    <div className="mb-4"><h2 className="font-display text-2xl text-ink">{t("teachingPlan")}</h2><p className="mt-1 text-sm text-muted">{t("teachingPlanHint")}</p></div>
    {lectures.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-card p-6 text-sm text-muted">{t("teachingPlanEmpty")}</p> : <>
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-card md:block"><Table><TableHeader><TableRow><TableHead>{t("lectureNo")}</TableHead><TableHead>{t("lectureName")}</TableHead><TableHead>{t("objectives")}</TableHead><TableHead>{t("pageCount")}</TableHead><TableHead>{t("readiness")}</TableHead><TableHead className="text-right">{t("preview")}</TableHead></TableRow></TableHeader><TableBody>{lectures.map((lecture) => <TableRow key={lecture.id} className={lecture.status === "archived" ? "opacity-60" : undefined}><TableCell className="font-mono text-xs text-muted">{String(lecture.no).padStart(2, "0")}</TableCell><TableCell className="font-medium">{lecture.name}</TableCell><TableCell className="max-w-md text-muted">{lecture.objectives || t("noObjectives")}</TableCell><TableCell className="tabular-nums">{lecture.pageCount}</TableCell><TableCell>{lecture.hasRelease ? <Badge variant="secondary">{t("published")}</Badge> : <Badge variant="outline">{t("incomplete")}</Badge>}</TableCell><TableCell className="text-right">{previewLink(lecture)}</TableCell></TableRow>)}</TableBody></Table></div>
      <div className="space-y-3 md:hidden">{lectures.map((lecture) => <article key={lecture.id} className="rounded-2xl border border-line bg-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-muted">{String(lecture.no).padStart(2, "0")}</p><h3 className="mt-1 font-medium text-ink">{lecture.name}</h3></div>{lecture.hasRelease ? <Badge variant="secondary">{t("published")}</Badge> : <Badge variant="outline">{t("incomplete")}</Badge>}</div><p className="mt-3 text-sm text-muted">{lecture.objectives || t("noObjectives")}</p><div className="mt-4 flex items-center justify-between gap-3"><span className="text-xs text-muted">{t("pageCountValue", { count: lecture.pageCount })}</span>{previewLink(lecture)}</div></article>)}</div>
    </>}
    {archivedCount > 0 && !canManage && <p className="mt-3 text-xs text-muted">{t("archivedLectureHidden", { count: archivedCount })}</p>}
  </section>;
}
