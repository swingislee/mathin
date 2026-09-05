"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import {
  DashboardTableColumnHeader,
  DashboardTableShell,
  type DashboardTableColumnDefinition,
  useDashboardTableView,
} from "./dashboard-page";
import { StudentRestoreButton } from "./StudentRestoreButton";
import {
  FOLLOW_UP_STATUSES,
  STUDENT_STATUSES,
  type StudentSummary,
} from "./student-list-contract";

const EMPTY_VALUE = "$empty";

type StudentTableColumn = "name" | "grade" | "status" | "followUp" | "assigned" | "nextFollowUp";

export function StudentsTable({
  students,
  locale,
  recycle,
  canDelete,
}: {
  students: StudentSummary[];
  locale: string;
  recycle: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("school.students");
  const tableT = useTranslations("school.table");
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  const columns = useMemo<Record<StudentTableColumn, DashboardTableColumnDefinition<StudentSummary>>>(() => ({
    name: {
      filterValues: (student) => ({ value: student.id, label: student.name }),
      sortValue: (student) => student.name,
    },
    grade: {
      filterValues: (student) => ({
        value: student.grade ? String(student.grade) : EMPTY_VALUE,
        label: student.grade ? t("grade", { grade: student.grade }) : tableT("emptyValue"),
      }),
      sortValue: (student) => student.grade,
    },
    status: {
      filterValues: (student) => ({ value: student.status, label: t(student.status) }),
      sortValue: (student) => STUDENT_STATUSES.indexOf(student.status),
    },
    followUp: {
      filterValues: (student) => ({ value: student.followUpStatus, label: t(student.followUpStatus) }),
      sortValue: (student) => FOLLOW_UP_STATUSES.indexOf(student.followUpStatus),
    },
    assigned: {
      filterValues: (student) => ({
        value: student.assignedName ? `owner:${student.assignedName}` : EMPTY_VALUE,
        label: student.assignedName || t("none"),
      }),
      sortValue: (student) => student.assignedName,
    },
    nextFollowUp: {
      filterValues: (student) => student.nextFollowUpAt
        ? {
            value: dateFormatter.format(new Date(student.nextFollowUpAt)),
            label: dateFormatter.format(new Date(student.nextFollowUpAt)),
          }
        : { value: EMPTY_VALUE, label: tableT("emptyValue") },
      sortValue: (student) => student.nextFollowUpAt,
    },
  }), [dateFormatter, t, tableT]);
  const table = useDashboardTableView({ rows: students, columns, locale });

  return (
    <DashboardTableShell>
      <Table className="w-full min-w-[44rem] border-collapse text-left text-sm">
        <TableHeader className="border-b border-line text-xs text-muted">
          <TableRow>
            <TableHead className="px-4 py-3 font-medium"><DashboardTableColumnHeader label={t("name")} {...table.columnProps("name")} /></TableHead>
            <TableHead className="px-4 py-3 font-medium"><DashboardTableColumnHeader label={t("gradeCol")} {...table.columnProps("grade")} /></TableHead>
            <TableHead className="px-4 py-3 font-medium"><DashboardTableColumnHeader label={t("status")} {...table.columnProps("status")} /></TableHead>
            <TableHead className="px-4 py-3 font-medium"><DashboardTableColumnHeader label={t("followUp")} {...table.columnProps("followUp")} /></TableHead>
            <TableHead className="px-4 py-3 font-medium"><DashboardTableColumnHeader label={t("assignedTo")} {...table.columnProps("assigned")} /></TableHead>
            <TableHead className="px-4 py-3 font-medium"><DashboardTableColumnHeader label={t("nextFollowUp")} {...table.columnProps("nextFollowUp")} /></TableHead>
            <TableHead className="px-4 py-3 font-medium" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.visibleRows.map((student) => (
            <TableRow key={student.id}>
              <TableCell className="px-4 py-3 font-medium">{student.name}</TableCell>
              <TableCell className="px-4 py-3">{student.grade ? t("grade", { grade: student.grade }) : "-"}</TableCell>
              <TableCell className="px-4 py-3">{t(student.status)}</TableCell>
              <TableCell className="px-4 py-3">{t(student.followUpStatus)}</TableCell>
              <TableCell className="px-4 py-3">{student.assignedName || t("none")}</TableCell>
              <TableCell className="px-4 py-3 text-muted">
                {student.nextFollowUpAt ? dateFormatter.format(new Date(student.nextFollowUpAt)) : "-"}
              </TableCell>
              <TableCell className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-3">
                  <Link href={`/dashboard/students/${student.id}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                    {t("open")}
                  </Link>
                  {recycle && canDelete ? <StudentRestoreButton studentId={student.id} /> : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {table.visibleRows.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="h-32 px-4 text-center text-sm text-muted">{tableT("filteredEmpty")}</TableCell></TableRow>
          ) : null}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}
