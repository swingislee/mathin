"use client";

import { CheckCircle2, CircleDashed } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { TeacherMicrocourseBrowserCourse } from "./teacher-microcourse-browser";

export function TeacherMicrocourseTable({ courses, selectedCourseId, checkedIds, canManage, onSelect, onToggle, onToggleAll }: {
  courses: TeacherMicrocourseBrowserCourse[];
  selectedCourseId: string | null;
  checkedIds: ReadonlySet<string>;
  canManage: boolean;
  onSelect: (courseId: string) => void;
  onToggle: (courseId: string) => void;
  onToggleAll: () => void;
}) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  return <Table>
    <TableHeader><TableRow>
      {canManage && <TableHead className="w-10"><Checkbox checked={courses.length > 0 && courses.every((course) => checkedIds.has(course.id))} onCheckedChange={onToggleAll} aria-label={t("selectPageCourses")} /></TableHead>}
      <TableHead>{t("courseName")}</TableHead>
      <TableHead>{t("gradeOrStage")}</TableHead>
      <TableHead className="hidden sm:table-cell">{t("terms")}</TableHead>
      <TableHead className="hidden md:table-cell">{t("classTypes")}</TableHead>
    </TableRow></TableHeader>
    <TableBody>
      {courses.map((course) => <TableRow key={course.id} className={cn(selectedCourseId === course.id && "bg-moon/25")}>
        {canManage && <TableCell><Checkbox checked={checkedIds.has(course.id)} onCheckedChange={() => onToggle(course.id)} aria-label={t("selectCourse", { name: course.title })} /></TableCell>}
        <TableCell><Button variant="ghost" size="sm" className="h-auto max-w-full justify-start whitespace-normal px-0 py-1 text-left" onClick={() => onSelect(course.id)}><span><span className="block font-medium text-ink">{course.title}</span><span className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-muted">{course.ready ? <CheckCircle2 className="h-3.5 w-3.5 text-sage" /> : <CircleDashed className="h-3.5 w-3.5" />}<span>{t("lectureSummary", { released: course.releasedLectureCount, total: course.lectureCount })}</span>{course.branchCount > 1 && <Badge variant="outline">{t("branchCount", { count: course.branchCount })}</Badge>}</span></span></Button></TableCell>
        <TableCell className="max-w-44 text-sm">{course.gradeLabel}</TableCell>
        <TableCell className="hidden max-w-44 text-sm sm:table-cell">{course.termLabel}</TableCell>
        <TableCell className="hidden max-w-52 text-sm md:table-cell">{course.classLabel}</TableCell>
      </TableRow>)}
      {courses.length === 0 && <TableRow><TableCell colSpan={canManage ? 5 : 4} className="py-16 text-center text-muted">{t("noCourses")}</TableCell></TableRow>}
    </TableBody>
  </Table>;
}
