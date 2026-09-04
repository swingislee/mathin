"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  assessmentWorkbenchStage,
  type AssessmentWorkbenchRow,
} from "./assessment-workbench-contract";
import { DashboardTableShell } from "./dashboard-page";
import { TeacherAssessmentEntryButton } from "./TeacherAssessmentEntryButton";

export function TeacherAssessmentQueue({
  rows,
  locale,
  canAssess,
}: {
  rows: AssessmentWorkbenchRow[];
  locale: string;
  canAssess: boolean;
}) {
  const t = useTranslations("school.assessments");
  const formatDateTime = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }), [locale]);

  return (
    <DashboardTableShell data-teacher-assessment-queue>
      <Table className="min-w-[66rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-13rem)] overflow-auto">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 top-0 z-30 h-9 w-60 border-r border-line bg-card px-2">{t("personColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-56 bg-card px-2">{t("appointmentColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-28 bg-card px-2">{t("teacherStatusColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 bg-card px-2">{t("teacherContextColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-36 bg-card px-2">{t("teacherActionColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const stage = assessmentWorkbenchStage(row);
            return (
              <TableRow key={row.id} data-teacher-assessment-row={row.id}>
                <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                      {row.studentId ? (
                        <Link href={`/dashboard/students/${row.studentId}`} className="truncate font-medium text-ink hover:underline">
                          {row.name}
                        </Link>
                      ) : <span className="truncate font-medium text-ink">{row.name}</span>}
                      {row.phone ? <a href={`tel:${row.phone}`} className="font-mono text-[11px] text-muted hover:underline">{row.phone}</a> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted">
                      {row.gradeText || (row.grade ? t("gradeValue", { grade: row.grade }) : t("gradePending"))}
                      {row.studentId ? ` · ${t("identityStudent")}` : ` · ${t("identityLead")}`}
                    </p>
                  </div>
                </TableCell>
                <TableCell className="px-2 py-2">
                  <p className="whitespace-nowrap font-medium text-ink">{formatDateTime.format(new Date(row.scheduledAt))}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted" title={row.location || undefined}>
                    {row.location || t("locationPending")}
                    {row.assessorName ? ` · ${row.assessorName}` : ""}
                  </p>
                </TableCell>
                <TableCell className="px-2 py-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      stage === "pending" && "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
                      stage === "in_progress" && "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
                      stage === "completed" && "border-leaf-deep/40 bg-leaf/30 text-leaf-deep",
                    )}
                  >
                    {t(`teacherStage_${stage}`)}
                  </Badge>
                </TableCell>
                <TableCell className="px-2 py-2">
                  {row.assessment ? (
                    <div className="flex min-w-0 items-center gap-2">
                      {row.assessment.score !== null ? <span className="shrink-0 font-semibold tabular-nums text-ink">{t("teacherScore", { score: row.assessment.score })}</span> : null}
                      {row.assessment.assessmentBand ? <Badge variant="secondary">{t(`band_${row.assessment.assessmentBand}`)}</Badge> : null}
                      <span className="truncate text-[11px] text-muted">
                        {stage === "completed" ? (row.assessment.teacherRecommendation || t("teacherCompletedHint")) : t("teacherInProgressHint")}
                      </span>
                    </div>
                  ) : (
                    <p className="truncate text-[11px] text-muted" title={row.background || undefined}>
                      {row.background || t("backgroundEmpty")}
                    </p>
                  )}
                </TableCell>
                <TableCell className="px-2 py-2">
                  {canAssess
                    ? <TeacherAssessmentEntryButton registrationId={row.registrationId} invitationId={row.invitationId} />
                    : <span className="text-[11px] text-muted">{t("teacherReadOnly")}</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}
