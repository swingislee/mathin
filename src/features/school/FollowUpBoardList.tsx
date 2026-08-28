"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/action-form";
import { Link, useRouter } from "@/i18n/navigation";
import { withReturnTo } from "./object-workspace/return-target";
import { changeStudentStatusAction, recoverLostStudentAction } from "./actions/students";
import { FollowUpForm } from "./FollowUpForm";
import { DashboardTableShell } from "./dashboard-page";
import type { BoardGroup, BoardRow } from "./followups";
import type { StudentStatus } from "./students";

// 与 students.ts 的 STUDENT_STATUSES 同步（该模块引 server supabase，客户端不可值导入）
const STUDENT_STATUSES: readonly StudentStatus[] = ["lead", "trialing", "enrolled", "paused", "alumni", "invalid"];
const STATUS_TRANSITIONS:Record<StudentStatus,readonly StudentStatus[]>={lead:["trialing","invalid"],trialing:["lead","enrolled","invalid"],enrolled:["paused","alumni"],paused:["enrolled","alumni"],alumni:["enrolled"],invalid:["lead"]};

const FOLD_LIMIT = 8;

/**
 * 跟进工作台六档分组列表（P4C-6 §6）：每组一张卡，组内折叠前 8 行；
 * 行尾快捷动作——记跟进（弹窗复用 FollowUpForm）/ 改状态（下拉直调 RPC）/ 下单（链接 360° 财务锚点）。
 */
export function FollowUpBoardList({
  groups,
  canEditStatus,
  canOrder,
  canRecover=false,
  returnTo,
}: {
  groups: BoardGroup[];
  canEditStatus: boolean;
  canOrder: boolean;
  canRecover?:boolean;
  /**
   * 当前跟进台地址（含 scope 与时间桶）。学辅一天要在这份队列和学生档案之间来回
   * 几十趟，返回必须回到刚才那个桶，而不是队列的默认视图（doc24 §6.2）。
   */
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
    setExpanded((prev) => {
      const next = new Set(prev);
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
  const changeStatus = (row: BoardRow, status: StudentStatus) => {
    if (status === row.status) return;
    changeStatusRun.run(row.id, status);
  };

  const recoverRun = useAction(recoverLostStudentAction, {
    successMessage: t("recoverSuccess"),
    errorMessage: { default: t("changeFailed") },
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const open = expanded.has(group.status);
        const rows = open ? group.rows : group.rows.slice(0, FOLD_LIMIT);
        return (
          <DashboardTableShell key={group.status}>
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="text-sm font-medium text-ink">{studentsT(group.status)}</h2>
              <span className="rounded-full bg-crater/10 px-2 py-0.5 text-xs tabular-nums text-muted">{group.rows.length}</span>
            </header>
            {group.rows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">{t("emptyGroup")}</p>
            ) : (
              <div>
                <Table className="w-full border-collapse text-left text-sm">
                  <TableHeader className="border-b border-line text-xs text-muted">
                    <TableRow>
                      <TableHead className="px-4 py-2.5 font-medium">{studentsT("name")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{studentsT("gradeCol")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{studentsT("status")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{studentsT("lastFollowUp")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{studentsT("nextFollowUp")}</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">{t("latestNote")}</TableHead>
                      <TableHead className="px-4 py-2.5"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="px-4 py-2.5 font-medium">
                          <Link href={withReturnTo(`/dashboard/students/${row.id}`, returnTo)} className="underline-offset-2 hover:underline">
                            {row.name}
                          </Link>
                        </TableCell>
                        <TableCell className="px-4 py-2.5 whitespace-nowrap">{row.grade ? studentsT("grade", { grade: row.grade }) : "-"}</TableCell>
                        <TableCell className="px-4 py-2.5">
                          <span className="rounded-full bg-crater/10 px-2 py-0.5 text-xs whitespace-nowrap">{studentsT(row.status)}</span>
                          {row.isLost&&<span className="ml-1 text-[11px] text-rose">{t("lostDays",{days:row.lostDays})}</span>}
                        </TableCell>
                        <TableCell className="px-4 py-2.5 whitespace-nowrap text-muted">{formatAt(row.lastFollowUpAt)}</TableCell>
                        <TableCell className={`px-4 py-2.5 whitespace-nowrap ${row.overdue ? "text-rose" : "text-muted"}`}>
                          {formatAt(row.nextFollowUpAt)}
                          {row.overdue && (
                            <span className="ml-1.5 rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">{t("overdueBadge")}</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[16rem] truncate px-4 py-2.5 text-muted" title={row.latestNote || undefined}>
                          {row.latestNote || "-"}
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLogTarget({ id: row.id, name: row.name, followUpStatus: row.followUpStatus })}>
                              {t("logFollowUp")}
                            </Button>
                            {canEditStatus && (
                              <Select
                                value={row.status}
                                onValueChange={(value) => changeStatus(row, value as StudentStatus)}
                                disabled={changeStatusRun.pending}
                              >
                                <SelectTrigger aria-label={t("changeStatus")} className="h-7 py-0 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {STUDENT_STATUSES.filter((status)=>status===row.status||STATUS_TRANSITIONS[row.status].includes(status)).map((status) => (
                                    <SelectItem key={status} value={status}>{studentsT(status)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            {canOrder && (
                              <Link
                                href={withReturnTo(`/dashboard/students/${row.id}?tab=finance`, returnTo)}
                                className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                              >
                                {studentsT("placeOrder")}
                              </Link>
                            )}
                            {canRecover&&row.isLost&&<Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={recoverRun.pending} onClick={()=>recoverRun.run(row.id)}>{t("recover")}</Button>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {group.rows.length > FOLD_LIMIT && (
              <div className="border-t border-line px-4 py-2">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => toggleExpand(group.status)}>
                  {open ? t("collapse") : t("expandAll", { count: group.rows.length })}
                </Button>
              </div>
            )}
          </DashboardTableShell>
        );
      })}

      <Dialog open={logTarget !== null} onOpenChange={(next) => { if (!next) setLogTarget(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{logTarget ? t("logFollowUpFor", { name: logTarget.name }) : ""}</DialogTitle>
          </DialogHeader>
          {logTarget && <FollowUpForm studentId={logTarget.id} currentStatus={logTarget.followUpStatus} onSuccess={() => setLogTarget(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
