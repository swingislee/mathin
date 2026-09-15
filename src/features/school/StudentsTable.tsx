"use client";

import { Fragment, useMemo, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { QuickFollowUpEntry } from "./QuickFollowUpEntry";
import { Student360Trigger } from "./Student360Sheet";

const EMPTY_VALUE = "$empty";

type StudentTableColumn = "name" | "grade" | "status" | "followUp" | "assigned" | "nextFollowUp";

export function StudentsTable({
  students,
  locale,
  recycle,
  canDelete,
  canWriteFollowup,
}: {
  students: StudentSummary[];
  locale: string;
  recycle: boolean;
  canDelete: boolean;
  canWriteFollowup: boolean;
}) {
  const t = useTranslations("school.students");
  const tableT = useTranslations("school.table");
  const [rows, setRows] = useState(students);
  const [activeId, setActiveId] = useState<string | null>(null);
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
  const table = useDashboardTableView({ rows, columns, locale });

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
          {table.visibleRows.map((student) => {
            const active = activeId === student.id;
            return <Fragment key={student.id}>
            <TableRow key={student.id} data-followup-active={active} aria-expanded={active} aria-controls={active ? `student-quick-entry-${student.id}` : undefined}>
              <TableCell className="px-4 py-3 font-medium">
                <Student360Trigger
                  subject={{ studentId: student.id, leadId: null }}
                  fallback={{ name: student.name, grade: student.grade }}
                  className="truncate"
                >
                  {student.name}
                </Student360Trigger>
              </TableCell>
              <TableCell className="px-4 py-3">{student.grade ? t("grade", { grade: student.grade }) : "-"}</TableCell>
              <TableCell className="px-4 py-3">{t(student.status)}</TableCell>
              <TableCell className="px-4 py-3">
                <span>{t(student.followUpStatus)}</span>
                {student.lastFollowUpContent ? <p className="mt-1 line-clamp-2 max-w-[18rem] text-xs leading-4 text-muted" title={student.lastFollowUpContent}>{student.lastFollowUpContent}</p> : null}
              </TableCell>
              <TableCell className="px-4 py-3">{student.assignedName || t("none")}</TableCell>
              <TableCell className="px-4 py-3 text-muted">
                {student.nextFollowUpAt ? dateFormatter.format(new Date(student.nextFollowUpAt)) : "-"}
              </TableCell>
              <TableCell className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-3">
                  <Link href={`/dashboard/students/${student.id}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                    {t("open")}
                  </Link>
                  {canWriteFollowup && !recycle ? <Button
                    type="button"
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs"
                    aria-expanded={active}
                    aria-controls={active ? `student-quick-entry-${student.id}` : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveId((current) => current === student.id ? null : student.id);
                    }}
                  >
                    <MessageSquarePlus className="size-3.5" />
                    {t("quickEntry")}
                  </Button> : null}
                  {recycle && canDelete ? <StudentRestoreButton studentId={student.id} /> : null}
                </div>
              </TableCell>
            </TableRow>
            {active ? <FollowupInlineDetails
              open
              onOpenChange={(open) => { if (!open) setActiveId(null); }}
              title={`${student.name} · ${t("quickEntry")}`}
              colSpan={7}
              id={`student-quick-entry-${student.id}`}
            >
              <QuickFollowUpEntry
                studentId={student.id}
                onSaved={(entry) => setRows((current) => current.map((row) => row.id === student.id ? {
                  ...row,
                  lastFollowUpContent: entry.content,
                  lastFollowUpAt: entry.createdAt,
                } : row))}
              />
            </FollowupInlineDetails> : null}
          </Fragment>;
          })}
          {table.visibleRows.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="h-32 px-4 text-center text-sm text-muted">{tableT("filteredEmpty")}</TableCell></TableRow>
          ) : null}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}
