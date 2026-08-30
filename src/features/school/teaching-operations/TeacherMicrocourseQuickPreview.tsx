"use client";

import { BookOpen, GitBranch, History, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { TeacherMicrocourseBrowserCourse } from "./teacher-microcourse-browser";

export function TeacherMicrocourseQuickPreview({ familyId, course, canCreateBranch }: {
  familyId: string;
  course: TeacherMicrocourseBrowserCourse | null;
  canCreateBranch: boolean;
}) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  if (!course) return <Card className="h-full"><CardHeader><CardTitle>{t("quickPreview")}</CardTitle><CardDescription>{t("selectCourseHint")}</CardDescription></CardHeader></Card>;
  const firstReleasedLecture = course.preview.lectures.find((lecture) => lecture.currentReleaseId);
  return <Card className="h-full" data-teacher-microcourse-quick-preview>
    <CardHeader>
      <div className="flex flex-wrap items-center gap-2"><Badge variant={course.ready ? "secondary" : "outline"}>{course.ready ? t("ready") : t("incomplete")}</Badge><Badge variant="outline">{t("currentDefault")}</Badge></div>
      <CardTitle className="pt-2 font-display text-xl">{course.title}</CardTitle>
      <CardDescription>{course.sceneNames.length ? course.sceneNames.join(" · ") : t("unclassified")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-moon/15 p-3 text-center"><div><dt className="text-xs text-muted">{t("lectures")}</dt><dd className="mt-1 font-medium">{course.lectureCount}</dd></div><div><dt className="text-xs text-muted">{t("released")}</dt><dd className="mt-1 font-medium">{course.releasedLectureCount}</dd></div><div><dt className="text-xs text-muted">{t("branches")}</dt><dd className="mt-1 font-medium">{course.branchCount}</dd></div></dl>
      <div className="space-y-3">
        {course.preview.lectures.slice(0, 8).map((lecture) => <article key={lecture.id} data-preview-cache-key={lecture.cacheKey} className="rounded-xl border border-line p-3"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-medium">{lecture.no}. {lecture.name}</h3>{lecture.releaseNo ? <Badge variant="outline">R{lecture.releaseNo}</Badge> : <Badge variant="outline">{t("draft")}</Badge>}</div><p className="mt-2 line-clamp-3 text-xs leading-5 text-muted">{lecture.objectives || t("noObjectives")}</p><p className="mt-2 text-xs text-muted">{t("pageCount", { count: lecture.pageCount })}</p></article>)}
        {course.preview.lectures.length > 8 && <p className="text-xs text-muted">{t("moreLectures", { count: course.preview.lectures.length - 8 })}</p>}
      </div>
      <div className="grid gap-2">
        <Link href={`/dashboard/courses/${familyId}/microcourses/${course.id}`} className={cn(buttonVariants({ size: "sm" }))}><BookOpen className="h-4 w-4" />{t("openFullCourse")}</Link>
        {firstReleasedLecture && <Link href={`/dashboard/courseware/lectures/${firstReleasedLecture.id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><Play className="h-4 w-4" />{t("useNow")}</Link>}
        {canCreateBranch && <Link href={`/dashboard/courses/${familyId}/microcourses/${course.id}?tab=maintenance`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><GitBranch className="h-4 w-4" />{t("createMaintenanceBranch")}</Link>}
        <Link href={`/dashboard/courses/${familyId}/microcourses/${course.id}?tab=history`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}><History className="h-4 w-4" />{t("maintenanceHistory")}</Link>
      </div>
    </CardContent>
  </Card>;
}
