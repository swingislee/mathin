"use client";

import { Fragment, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { assignStudentAction, changeStudentStatusAction, recoverLostStudentAction } from "./actions/students";
import { fromSelectValue, toSelectValue } from "./controls";
import { DashboardTableShell } from "./dashboard-page";
import { FollowUpForm } from "./FollowUpForm";
import type { BoardGroup, BoardRow } from "./followups";
import { withReturnTo } from "./object-workspace/return-target";
import type { StudentStatus } from "./students";

const STUDENT_STATUSES: readonly StudentStatus[] = ["lead", "trialing", "enrolled", "paused", "alumni", "invalid"];
const STATUS_TRANSITIONS: Record<StudentStatus, readonly StudentStatus[]> = {
  lead: ["trialing", "invalid"],
  trialing: ["lead", "enrolled", "invalid"],
  enrolled: ["paused", "alumni"],
  paused: ["enrolled", "alumni"],
  alumni: ["enrolled"],
  invalid: ["lead"],
};
const FOLD_LIMIT = 8;

interface AssigneeOption {
  userId: string;
  displayName: string;
}

export function FollowUpBoardList({
  groups,
  canEditStatus,
  canAssign,
  assignees,
  canOrder,
  canRecover = false,
  returnTo,
}: {
  groups: BoardGroup[];
  canEditStatus: boolean;
  canAssign: boolean;
  assignees: AssigneeOption[];
  canOrder: boolean;
  canRecover?: boolean;
  returnTo: string;
}) {
  const t = useTranslations("school.followups");
  const studentsT = useTranslations("school.students");
  const locale = useLocale();
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [logTarget, setLogTarget] = useState<{ id: string; name: string; followUpStatus: BoardRow["followUpStatus"] } | null>(null);

  const formatAt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "-";
  const toggleExpand = (status: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const changeStatusRun = useAction(changeStudentStatusAction, {
    successMessage: studentsT("statusChanged"),
    errorMessage: { default: t("changeFailed") },
    onSuccess: () => router.refresh(),
  });
  const assignRun = useAction(assignStudentAction, {
    successMessage: studentsT("assignSuccess"),
    errorMessage: { default: t("assignFailed") },
    onSuccess: () => router.refresh(),
  });
  const recoverRun = useAction(recoverLostStudentAction, {
    successMessage: t("recoverSuccess"),
    errorMessage: { default: t("changeFailed") },
    onSuccess: () => router.refresh(),
  });
  const pending = changeStatusRun.pending || assignRun.pending || recoverRun.pending;

  return (
    <>
      <DashboardTableShell>
        <Table className="w-full min-w-[72rem] border-collapse text-left text-sm">
          <TableHeader className="border-b border-line text-xs text-muted">
            <TableRow>
              <TableHead className="px-4 py-2.5 font-medium">{studentsT("name")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{studentsT("gradeCol")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{studentsT("status")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{studentsT("assignedTo")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{studentsT("lastFollowUp")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{studentsT("nextFollowUp")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("latestNote")}</TableHead>
              <TableHead className="px-4 py-2.5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const open = expanded.has(group.status);
              const rows = open ? group.rows : group.rows.slice(0, FOLD_LIMIT);
              return (
                <Fragment key={group.status}>
                  <TableRow className="border-t border-line first:border-t-0">
                    <TableCell colSpan={8} className="px-4 py-2.5">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-ink">{studentsT(group.status)}</span>
                          <span className="text-xs tabular-nums text-muted">{group.rows.length}</span>
                        </div>
                        {group.rows.length > FOLD_LIMIT ? (
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => toggleExpand(group.status)}>
                            {open ? t("collapse") : t("expandAll", { count: group.rows.length })}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="px-4 py-3 text-xs text-muted">{t("emptyGroup")}</TableCell>
                    </TableRow>
                  ) : rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="px-4 py-2.5 font-medium">
                        <Link href={withReturnTo(`/dashboard/students/${row.id}`, returnTo)} className="underline-offset-2 hover:underline">
                          {row.name}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-2.5">{row.grade ? studentsT("grade", { grade: row.grade }) : "-"}</TableCell>
                      <TableCell className="px-4 py-2.5">
                        <span className="whitespace-nowrap text-xs">{studentsT(row.status)}</span>
                        {row.isLost ? <span className="ml-1 text-[11px] text-rose">{t("lostDays", { days: row.lostDays })}</span> : null}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        {canAssign ? (
                          <Select
                            value={toSelectValue(row.assignedTo ?? "")}
                            disabled={pending}
                            onValueChange={(value) => {
                              const owner = fromSelectValue(value);
                              if (owner && owner !== row.assignedTo) assignRun.run(row.id, owner);
                            }}
                          >
                            <SelectTrigger aria-label={studentsT("assignOwner")} className="h-8 min-w-32 py-1 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={toSelectValue("")}>{studentsT("assignOwner")}</SelectItem>
                              {assignees.map((person) => <SelectItem key={person.userId} value={person.userId}>{person.displayName}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : <span className="whitespace-nowrap text-xs text-muted">{row.assignedName || studentsT("none")}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-4 py-2.5 text-muted">{formatAt(row.lastFollowUpAt)}</TableCell>
                      <TableCell className={row.overdue ? "whitespace-nowrap px-4 py-2.5 text-rose" : "whitespace-nowrap px-4 py-2.5 text-muted"}>
                        {formatAt(row.nextFollowUpAt)}
                        {row.overdue ? <span className="ml-1.5 text-xs text-rose">{t("overdueBadge")}</span> : null}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate px-4 py-2.5 text-muted" title={row.latestNote || undefined}>
                        {row.latestNote || "-"}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLogTarget({ id: row.id, name: row.name, followUpStatus: row.followUpStatus })}>
                            {t("logFollowUp")}
                          </Button>
                          {canEditStatus ? (
                            <Select
                              value={row.status}
                              onValueChange={(value) => {
                                const status = value as StudentStatus;
                                if (status !== row.status) changeStatusRun.run(row.id, status);
                              }}
                              disabled={pending}
                            >
                              <SelectTrigger aria-label={t("changeStatus")} className="h-7 py-0 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {STUDENT_STATUSES.filter((status) => status === row.status || STATUS_TRANSITIONS[row.status].includes(status)).map((status) => (
                                  <SelectItem key={status} value={status}>{studentsT(status)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}
                          {canOrder ? (
                            <Link href={withReturnTo(`/dashboard/students/${row.id}?tab=finance`, returnTo)} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                              {studentsT("placeOrder")}
                            </Link>
                          ) : null}
                          {canRecover && row.isLost ? (
                            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => recoverRun.run(row.id)}>
                              {t("recover")}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </DashboardTableShell>

      <Dialog open={logTarget !== null} onOpenChange={(next) => { if (!next) setLogTarget(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{logTarget ? t("logFollowUpFor", { name: logTarget.name }) : ""}</DialogTitle>
          </DialogHeader>
          {logTarget ? <FollowUpForm studentId={logTarget.id} currentStatus={logTarget.followUpStatus} onSuccess={() => setLogTarget(null)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
