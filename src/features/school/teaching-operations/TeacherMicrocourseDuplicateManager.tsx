"use client";

import { useTranslations } from "next-intl";
import { useAction, type ActionErrorMessages } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardSection, DashboardTableShell } from "@/features/school/dashboard-page";
import { useRouter } from "@/i18n/navigation";
import { selectTeacherMicrocourseDuplicateCanonicalAction } from "../actions/teacher-microcourse-maintenance";
import type { TeacherMicrocourseDuplicateReport } from "./teacher-microcourse-maintenance";

export function TeacherMicrocourseDuplicateManager({ courseFamilyId, report }: { courseFamilyId: string; report: TeacherMicrocourseDuplicateReport }) {
  const t = useTranslations("school.teacherMicrocourseBrowser");
  const router = useRouter();
  const errors: ActionErrorMessages = { FORBIDDEN: t("forbidden"), default: t("actionFailed") };
  const selectCanonical = useAction(selectTeacherMicrocourseDuplicateCanonicalAction, {
    successMessage: t("duplicateCanonicalChanged"), errorMessage: errors, onSuccess: () => router.refresh(),
  });
  if (!report.canManage) return null;
  const rows = report.groups.flatMap((group) => group.courses.map((course) => ({
    ...course,
    normalizedName: group.normalizedName,
    groupCount: group.courses.length,
  })));
  return <DashboardSection title={t("duplicateReport")} description={t("duplicateReportHint")}>
    <DashboardTableShell><Table><TableHeader><TableRow><TableHead>{t("duplicateReport")}</TableHead><TableHead>{t("courseName")}</TableHead><TableHead>{t("status")}</TableHead><TableHead>{t("lectures")}</TableHead><TableHead className="text-right">{t("actions")}</TableHead></TableRow></TableHeader><TableBody>
      {rows.map((course, index) => <TableRow key={course.courseId}><TableCell><p className="font-medium">{course.normalizedName}</p>{index === 0 || rows[index - 1]?.normalizedName !== course.normalizedName ? <p className="text-xs text-muted">{t("duplicateCount", { count: course.groupCount })}</p> : null}</TableCell><TableCell>{course.title}</TableCell><TableCell>{course.isCanonical ? <Badge variant="secondary">{t("browserCanonical")}</Badge> : <Badge variant="outline">{t("historicalDuplicate")}</Badge>}</TableCell><TableCell>{course.lectureCount}</TableCell><TableCell className="text-right">{!course.isCanonical ? <Button variant="secondary" size="sm" disabled={selectCanonical.pending} onClick={() => selectCanonical.run({ courseFamilyId, courseId: course.courseId })}>{t("selectAsCanonical")}</Button> : null}</TableCell></TableRow>)}
      {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted">{t("noDuplicateCourses")}</TableCell></TableRow> : null}
    </TableBody></Table></DashboardTableShell>
  </DashboardSection>;
}
