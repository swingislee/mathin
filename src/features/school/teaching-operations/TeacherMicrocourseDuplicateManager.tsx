"use client";

import { useTranslations } from "next-intl";
import { useAction, type ActionErrorMessages } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  return <Card><CardHeader><CardTitle>{t("duplicateReport")}</CardTitle><CardDescription>{t("duplicateReportHint")}</CardDescription></CardHeader><CardContent className="space-y-5">{report.groups.map((group) => <section key={group.normalizedName} className="rounded-xl border border-line"><div className="border-b border-line px-4 py-3"><p className="text-sm font-medium">{group.normalizedName}</p><p className="text-xs text-muted">{t("duplicateCount", { count: group.courses.length })}</p></div><Table><TableHeader><TableRow><TableHead>{t("courseName")}</TableHead><TableHead>{t("status")}</TableHead><TableHead>{t("lectures")}</TableHead><TableHead className="text-right">{t("actions")}</TableHead></TableRow></TableHeader><TableBody>{group.courses.map((course) => <TableRow key={course.courseId}><TableCell>{course.title}</TableCell><TableCell>{course.isCanonical ? <Badge variant="secondary">{t("browserCanonical")}</Badge> : <Badge variant="outline">{t("historicalDuplicate")}</Badge>}</TableCell><TableCell>{course.lectureCount}</TableCell><TableCell className="text-right">{!course.isCanonical && <Button variant="secondary" size="sm" disabled={selectCanonical.pending} onClick={() => selectCanonical.run({ courseFamilyId, courseId: course.courseId })}>{t("selectAsCanonical")}</Button>}</TableCell></TableRow>)}</TableBody></Table></section>)}{report.groups.length === 0 && <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">{t("noDuplicateCourses")}</p>}</CardContent></Card>;
}
