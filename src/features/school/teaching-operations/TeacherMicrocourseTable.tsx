"use client";

import { CheckCircle2, CircleDashed } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardTableShell } from "@/features/school/dashboard-page";
import { cn } from "@/lib/utils";
import type { TeacherMicrocourseBrowserCourse } from "./teacher-microcourse-browser";

export function TeacherMicrocourseTable({ courses, selectedCourseId, checkedIds, canManage, onSelect, onPrefetch, onCancelPrefetch, onToggle, onToggleAll }: {
  courses: TeacherMicrocourseBrowserCourse[];
  selectedCourseId: string | null;
  checkedIds: ReadonlySet<string>;
  canManage: boolean;
  onSelect: (courseId: string) => void;
  onPrefetch: (courseId: string) => void;
  onCancelPrefetch: (courseId: string) => void;
  onToggle: (courseId: string) => void;
  onToggleAll: () => void;
}) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  return <DashboardTableShell className="rounded-none border-x-0"><Table>
    <TableHeader><TableRow>
      {canManage && <TableHead className="w-10"><Checkbox checked={courses.length > 0 && courses.every((course) => checkedIds.has(course.id))} onCheckedChange={onToggleAll} aria-label={t("selectPageCourses")} /></TableHead>}
      <TableHead className="h-9">{t("courseName")}</TableHead>
      <TableHead className="h-9">{t("gradeOrStage")}</TableHead>
      <TableHead className="hidden h-9 @2xl/page:table-cell">{t("terms")}</TableHead>
      <TableHead className="hidden h-9 @4xl/page:table-cell">{t("classTypes")}</TableHead>
    </TableRow></TableHeader>
    <TableBody>
      {courses.map((course, index) => <TableRow key={course.id} className={cn(selectedCourseId === course.id && "bg-moon/25")} onMouseEnter={() => onPrefetch(course.id)} onMouseLeave={() => onCancelPrefetch(course.id)} onFocus={() => onPrefetch(course.id)} onBlur={() => onCancelPrefetch(course.id)}>
        {canManage && <TableCell className="py-2"><Checkbox checked={checkedIds.has(course.id)} onCheckedChange={() => onToggle(course.id)} aria-label={t("selectCourse", { name: course.title })} /></TableCell>}
        <TableCell className="py-2"><Button data-course-select variant="ghost" size="sm" className="h-auto max-w-full justify-start whitespace-normal px-0 py-0 text-left" onClick={() => onSelect(course.id)} onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const nextIndex = event.key === "ArrowDown" ? Math.min(courses.length - 1, index + 1) : Math.max(0, index - 1);
          if (nextIndex === index) return;
          event.preventDefault();
          onSelect(courses[nextIndex].id);
          event.currentTarget.closest("table")?.querySelectorAll<HTMLButtonElement>("[data-course-select]").item(nextIndex).focus();
        }}><span><span className="block font-medium text-ink">{course.title}</span><span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-normal text-muted">{course.ready ? <CheckCircle2 className="h-3.5 w-3.5 text-sage" /> : <CircleDashed className="h-3.5 w-3.5" />}<span>{t("lectureSummary", { released: course.releasedLectureCount, total: course.lectureCount })}</span>{course.sceneNames.length > 0 && <><span>·</span><span className="line-clamp-1">{course.sceneNames.join(" / ")}</span></>}</span></span></Button></TableCell>
        <TableCell className="max-w-44 py-2 text-sm">{course.gradeLabel}</TableCell>
        <TableCell className="hidden max-w-44 py-2 text-sm @2xl/page:table-cell">{course.termLabel}</TableCell>
        <TableCell className="hidden max-w-52 py-2 text-sm @4xl/page:table-cell">{course.classLabel}</TableCell>
      </TableRow>)}
      {courses.length === 0 && <TableRow><TableCell colSpan={canManage ? 5 : 4} className="py-16 text-center text-muted">{t("noCourses")}</TableCell></TableRow>}
    </TableBody>
  </Table></DashboardTableShell>;
}
