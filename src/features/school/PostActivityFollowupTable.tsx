"use client";

import { Fragment, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { DashboardTableColumnHeader, DashboardTableShell, useDashboardTableView, type DashboardTableColumnDefinition } from "./dashboard-page";
import { PostActivityHandoff } from "./EnrollmentHandoffButton";
import { followupState, type ActivityEnrollmentContext } from "./enrollment-workflow-contract";
import { Student360Trigger } from "./Student360Sheet";

export function PostActivityFollowupTable({ initialRows, query = "" }: { initialRows: ActivityEnrollmentContext[]; query?: string }) {
  const t = useTranslations("school.enrollmentWorkflow");
  const locale = useLocale();
  const [overrides, setOverrides] = useState<Record<string, ActivityEnrollmentContext>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const rows = initialRows.map((row) => overrides[row.registrationId] ?? row).filter((row) => row.eligible &&
    [row.name, row.phone, row.activityTitle, row.routeNote, row.recommendation, row.contacts[0]?.note ?? ""].join(" ").toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
  const formatAt = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value));
  const columns = useMemo<Record<string, DashboardTableColumnDefinition<ActivityEnrollmentContext>>>(() => ({
    student: { sortValue: (row) => row.name, filterValues: (row) => ({ value: row.name, label: row.name }) },
    activity: { sortValue: (row) => row.activityAt, filterValues: (row) => ({ value: row.activityId, label: row.activityTitle }) },
    state: { sortValue: (row) => followupState(row), filterValues: (row) => [
      { value: followupState(row), label: t(`state_${followupState(row)}`) },
      ...(!["enrolled", "closed"].includes(followupState(row)) ? [{ value: "open", label: t("activeFollowups") }] : []),
    ] },
    next: { sortValue: (row) => row.contacts[0]?.nextContactAt ?? "9999", filterValues: (row) => ({ value: row.contacts[0]?.nextContactAt ? "scheduled" : "unscheduled", label: t(row.contacts[0]?.nextContactAt ? "scheduled" : "unscheduled") }) },
  }), [t]);
  const table = useDashboardTableView({ rows, columns, locale, initialFilters: { state: "open" } });
  return <DashboardTableShell>
    <Table className="min-w-[60rem] text-xs" containerClassName="max-h-[calc(100dvh-13rem)] overflow-auto">
      <TableHeader><TableRow>
        <TableHead className="sticky left-0 top-0 z-30 min-w-48 border-r border-line bg-card"><DashboardTableColumnHeader label={t("student")} {...table.columnProps("student")} /></TableHead>
        <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("source")} {...table.columnProps("activity")} /></TableHead>
        <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("followupStatus")} {...table.columnProps("state")} /></TableHead>
        <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("nextContact")} {...table.columnProps("next")} /></TableHead>
        <TableHead className="sticky top-0 z-20 bg-card">{t("latestContact")}</TableHead>
        <TableHead className="sticky top-0 z-20 bg-card">{t("action")}</TableHead>
      </TableRow></TableHeader>
      <TableBody>{table.visibleRows.map((row) => <Fragment key={row.registrationId}>
        <TableRow className={cn(expandedId === row.registrationId && "bg-moon/10")}>
          <TableCell className="sticky left-0 z-10 border-r border-line bg-card"><Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={row}>{row.name}</Student360Trigger><p className="mt-1 text-muted">{row.phone}</p></TableCell>
          <TableCell><Link href={`/dashboard/activities/${row.activityId}?view=review&node=assessment`} className="hover:underline">{row.activityTitle}</Link><p className="mt-1 text-muted">{formatAt(row.activityAt)}</p></TableCell>
          <TableCell><Badge variant="outline">{t(`state_${followupState(row)}`)}</Badge></TableCell>
          <TableCell className={cn(row.contacts[0]?.nextContactAt && new Date(row.contacts[0].nextContactAt).getTime() < now && !row.enrollmentId && row.route !== "closed" && "text-rose")}>
            {row.contacts[0]?.nextContactAt ? formatAt(row.contacts[0].nextContactAt) : t("unscheduled")}
          </TableCell>
          <TableCell className="max-w-80"><p className="truncate" title={row.contacts[0]?.note || row.routeNote}>{row.contacts[0]?.note || row.routeNote || "—"}</p></TableCell>
          <TableCell><Button size="sm" variant="ghost" aria-expanded={expandedId === row.registrationId} onClick={() => setExpandedId((value) => value === row.registrationId ? null : row.registrationId)}>{expandedId === row.registrationId ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}{t("continueContact")}</Button></TableCell>
        </TableRow>
        {expandedId === row.registrationId ? <TableRow><TableCell colSpan={6} className="p-4"><PostActivityHandoff source={{ registrationId: row.registrationId, invitationId: null }} initialContext={row} onSaved={(next) => setOverrides((values) => ({ ...values, [next.registrationId]: next }))} /></TableCell></TableRow> : null}
      </Fragment>)}
      {!table.visibleRows.length ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted">{t("noFollowups")}</TableCell></TableRow> : null}</TableBody>
    </Table>
  </DashboardTableShell>;
}
