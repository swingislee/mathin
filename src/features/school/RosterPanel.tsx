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
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { selectClass } from "./controls";
import {
  enrollStudentAction,
  listClassroomOptions,
  searchStudentsForEnroll,
  transferStudentAction,
  withdrawStudentAction,
  type StudentSearchResult,
} from "./actions";
import type { RosterRow } from "./classes";

export function RosterPanel({ classroomId, roster, canManage }: { classroomId: string; roster: RosterRow[]; canManage: boolean }) {
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
              <span className="min-w-0 flex-1 truncate">{row.studentName}</span>
              {!row.hasAccount && <span className="rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">{t("noAccount")}</span>}
              {row.hasAccount && !row.isMember && <span className="rounded-full bg-cheek/30 px-2 py-0.5 text-xs text-ink">{t("notInClassroom")}</span>}
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
