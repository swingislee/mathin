"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { selectClass } from "./controls";
import { enrollStudentAction, listClassroomOptions, searchStudentsForEnroll, transferStudentAction, withdrawStudentAction } from "./actions/classes";
import { type StudentSearchResult } from "./actions/types";
import type { RosterRow, RosterSignals, RosterViewerRole } from "./classes";

/** 角色默认列（doc19 §13.4）：教师看出勤/作业/学习异常，学辅看请假/欠费，主管看综合异常，其余角色沿用既有教务列。 */
function RosterSignalColumns({ role, signals }: { role: RosterViewerRole; signals: RosterSignals | undefined }) {
  const t = useTranslations("school.classes");
  if (!signals) return null;
  if (role === "teacher") {
    const anomaly = signals.recentAbsences >= 2;
    return <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
      <span>{t("rosterAttendance", { count: signals.recentAbsences })}</span>
      <span>{t("rosterSubmissions", { count: signals.pendingSubmissions })}</span>
      {anomaly && <span className="rounded-full bg-rose/10 px-2 py-0.5 text-rose">{t("rosterAnomaly")}</span>}
    </span>;
  }
  if (role === "support") {
    return <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
      {signals.pendingLeaveRequests > 0 && <span className="rounded-full bg-cheek/30 px-2 py-0.5 text-ink">{t("rosterLeaveRequests", { count: signals.pendingLeaveRequests })}</span>}
      {signals.accountBalance < 0 && <span className="rounded-full bg-rose/10 px-2 py-0.5 text-rose">{t("rosterArrears")}</span>}
    </span>;
  }
  if (role === "oversight") {
    const flags = [signals.recentAbsences >= 2, signals.pendingLeaveRequests > 0, signals.accountBalance < 0].filter(Boolean).length;
    if (flags === 0) return null;
    return <span className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs text-rose">{t("rosterCompositeAnomaly", { count: flags })}</span>;
  }
  return null;
}

export function RosterPanel({ classroomId, roster, canManage, viewerRole, signals }: {
  classroomId: string;
  roster: RosterRow[];
  canManage: boolean;
  viewerRole: RosterViewerRole;
  signals: Record<string, RosterSignals>;
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [transferTarget, setTransferTarget] = useState<RosterRow | null>(null);
  const [classroomOptions, setClassroomOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [transferTo, setTransferTo] = useState("");

  const search = async (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchStudentsForEnroll(value));
    } finally {
      setSearching(false);
    }
  };

  const enrollRun = useAction(enrollStudentAction, {
    successMessage: t("enrollSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setEnrollOpen(false); setQuery(""); setResults([]); router.refresh(); },
  });
  const enroll = (studentId: string) => enrollRun.run(classroomId, studentId, "");

  const withdrawRun = useAction(withdrawStudentAction, {
    successMessage: t("withdrawSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const withdraw = (row: RosterRow) => { if (row.enrollmentId) withdrawRun.run(row.enrollmentId, ""); };

  const openTransfer = async (row: RosterRow) => {
    setTransferTarget(row);
    setTransferTo("");
    const options = await listClassroomOptions(classroomId);
    setClassroomOptions(options);
    if (options[0]) setTransferTo(options[0].id);
  };

  const transferRun = useAction(transferStudentAction, {
    successMessage: t("transferSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setTransferTarget(null); router.refresh(); },
  });
  const confirmTransfer = () => {
    if (transferTarget && transferTo) transferRun.run(transferTarget.studentId, classroomId, transferTo, "");
  };

  const pending = enrollRun.pending || withdrawRun.pending || transferRun.pending;

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{t("roster", { count: roster.length })}</h2>
        {canManage && (
          <button type="button" onClick={() => setEnrollOpen(true)} className={cn(buttonVariants({ size: "sm" }))}>
            {t("enroll")}
          </button>
        )}
      </div>

      {roster.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("emptyRoster")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {roster.map((row) => (
            <li key={row.studentId} className="flex items-center gap-3 py-2.5 text-sm">
              <Link href={`/dashboard/students/${row.studentId}`} className="min-w-0 flex-1 truncate hover:text-crater hover:underline">
                {row.studentName}
              </Link>
              {!row.hasAccount && <span className="rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">{t("noAccount")}</span>}
              {row.hasAccount && !row.isMember && <span className="rounded-full bg-cheek/30 px-2 py-0.5 text-xs text-ink">{t("notInClassroom")}</span>}
              <RosterSignalColumns role={viewerRole} signals={signals[row.studentId]} />
              {canManage && (
                <>
                  <button type="button" disabled={pending} onClick={() => void openTransfer(row)} className="text-xs text-muted underline underline-offset-2 hover:text-ink disabled:opacity-40">
                    {t("transfer")}
                  </button>
                  <button type="button" disabled={pending} onClick={() => withdraw(row)} className="text-xs text-muted underline underline-offset-2 hover:text-rose disabled:opacity-40">
                    {t("withdraw")}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("enrollDialogTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={query}
            onChange={(event) => void search(event.target.value)}
            placeholder={t("searchStudent")}
            className={`w-full ${selectClass}`}
          />
          <div className="mt-2 max-h-64 overflow-y-auto">
            {searching && <p className="px-1 py-2 text-xs text-muted">{t("searching")}</p>}
            {!searching && query && results.length === 0 && <p className="px-1 py-2 text-xs text-muted">{t("noMatch")}</p>}
            <ul className="divide-y divide-line">
              {results.map((student) => (
                <li key={student.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    {student.name}
                    {student.grade ? ` · ${t("grade", { grade: student.grade })}` : ""}
                  </span>
                  <button type="button" disabled={pending} onClick={() => enroll(student.id)} className="text-xs text-crater underline underline-offset-2 disabled:opacity-40">
                    {t("enroll")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(transferTarget)} onOpenChange={(open) => !open && setTransferTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("transferDialogTitle", { name: transferTarget?.studentName ?? "" })}</DialogTitle>
          </DialogHeader>
          <Select value={transferTo} onValueChange={setTransferTo}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {classroomOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <button type="button" onClick={() => setTransferTarget(null)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              {t("cancel")}
            </button>
            <button type="button" disabled={pending || !transferTo} onClick={confirmTransfer} className={cn(buttonVariants({ size: "sm" }))}>
              {t("confirm")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
