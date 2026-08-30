"use client";

import { BookOpen, FolderPen, GitBranch, History, LoaderCircle, Play, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { TeacherMicrocourseBrowserCourse } from "./teacher-microcourse-browser";

export function TeacherMicrocourseQuickPreview({ familyId, course, loadState, canCreateBranch, onRetry, onEditScope }: {
  familyId: string;
  course: TeacherMicrocourseBrowserCourse | null;
  loadState: "idle" | "loading" | "ready" | "error";
  canCreateBranch: boolean;
  onRetry?: () => void;
  onEditScope?: () => void;
}) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  if (!course) return <section className="h-full" data-teacher-microcourse-quick-preview><header className="px-3 py-2.5"><h2 className="text-sm font-medium">{t("quickPreview")}</h2></header><p className="px-3 py-8 text-sm leading-6 text-muted">{t("selectCourseHint")}</p></section>;
  const firstReleasedLecture = course.preview.lectures.find((lecture) => lecture.currentReleaseId);
  return <section className="h-full min-w-0" data-teacher-microcourse-quick-preview>
    <header className="px-3 py-2.5"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-medium">{t("quickPreview")}</h2><div className="flex items-center gap-1"><Badge variant="outline">{t("currentDefault")}</Badge><Badge variant={course.ready ? "secondary" : "outline"}>{course.ready ? t("ready") : t("incomplete")}</Badge></div></div></header>
    <div className="min-w-0 px-3 py-3">
      <h3 className="font-display text-lg leading-tight">{course.title}</h3>
      <div className="mt-1 flex items-start justify-between gap-2">
        <p className="min-w-0 text-xs leading-5 text-muted">{course.sceneNames.length ? course.sceneNames.join(" · ") : t("unclassified")}</p>
        {onEditScope && <Button variant="ghost" size="sm" className="h-auto shrink-0 px-1.5 py-0.5 text-xs" onClick={onEditScope}><FolderPen className="h-3.5 w-3.5" />{course.sceneNames.length ? t("editClassification") : t("addClassification")}</Button>}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">{course.gradeLabel} · {course.termLabel} · {course.classLabel}</p>
      {loadState === "loading" ? <div role="status" aria-live="polite" className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm text-muted"><LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" /><div><p className="font-medium text-ink">{t("previewLoading")}</p><p className="mt-1 text-xs leading-5">{t("previewLoadingHint")}</p></div></div>
        : loadState === "error" ? <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-8 text-center"><div><p className="text-sm font-medium text-ink">{t("previewFailed")}</p><p className="mt-1 text-xs leading-5 text-muted">{t("previewFailedHint")}</p></div>{onRetry && <Button variant="secondary" size="sm" onClick={onRetry}><RotateCw className="h-4 w-4" />{t("retryPreview")}</Button>}</div>
          : <><dl className="mt-3 grid grid-cols-3 py-2 text-center"><div><dt className="text-[11px] text-muted">{t("lectures")}</dt><dd className="font-medium tabular-nums">{course.lectureCount}</dd></div><div><dt className="text-[11px] text-muted">{t("released")}</dt><dd className="font-medium tabular-nums">{course.releasedLectureCount}</dd></div><div><dt className="text-[11px] text-muted">{t("branches")}</dt><dd className="font-medium tabular-nums">{course.branchCount}</dd></div></dl>
            <ol className="mt-2 space-y-1">
              {course.preview.lectures.slice(0, 12).map((lecture) => <li key={lecture.id} data-preview-cache-key={lecture.cacheKey} className="py-2"><div className="flex items-start justify-between gap-2"><h4 className="text-sm font-medium leading-5">{lecture.no}. {lecture.name}</h4><span className="shrink-0 text-[11px] text-muted">{lecture.releaseNo ? `R${lecture.releaseNo}` : t("draft")} · {t("pageCount", { count: lecture.pageCount })}</span></div><p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">{lecture.objectives || t("noObjectives")}</p></li>)}
              {course.preview.lectures.length > 12 && <li className="py-2 text-xs text-muted">{t("moreLectures", { count: course.preview.lectures.length - 12 })}</li>}
            </ol></>}
      <div className="mt-3 grid gap-1 pt-3">
        <Link href={`/dashboard/courses/${familyId}/microcourses/${course.id}`} className={cn(buttonVariants({ size: "sm" }))}><BookOpen className="h-4 w-4" />{t("openFullCourse")}</Link>
        {firstReleasedLecture && <Link href={`/dashboard/courseware/lectures/${firstReleasedLecture.id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><Play className="h-4 w-4" />{t("useNow")}</Link>}
        {canCreateBranch && <Link href={`/dashboard/courses/${familyId}/microcourses/${course.id}?tab=maintenance`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}><GitBranch className="h-4 w-4" />{t("createMaintenanceBranch")}</Link>}
        <Link href={`/dashboard/courses/${familyId}/microcourses/${course.id}?tab=history`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}><History className="h-4 w-4" />{t("maintenanceHistory")}</Link>
      </div>
    </div>
  </section>;
}
