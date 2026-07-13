"use client";

import { Input } from "@/components/ui/input";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getAttendanceDrawerData, saveAttendanceAction, type AttendanceDrawerRow } from "./actions";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./learning";

export function AttendanceDrawer({ sessionId }: { sessionId: string }) {
  const t = useTranslations("school.classes");
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AttendanceDrawerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const openDrawer = () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    void getAttendanceDrawerData(sessionId)
      .then(setRows)
      .catch(() => setError(t("actionFailed")))
      .finally(() => setLoading(false));
  };

  const updateRow = (studentId: string, patch: Partial<AttendanceDrawerRow>) => {
    setRows((prev) => prev.map((row) => (row.studentId === studentId ? { ...row, ...patch } : row)));
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await saveAttendanceAction(sessionId, rows);
        setOpen(false);
      } catch {
        setError(t("actionFailed"));
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-ink"
      >
        {t("markAttendance")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("markAttendance")}</DialogTitle>
          </DialogHeader>

          {error && <p className="text-xs text-rose">{error}</p>}

          {loading ? (
            <p className="py-4 text-sm text-muted">{t("loading")}</p>
          ) : rows.length === 0 ? (
            <p className="py-4 text-sm text-muted">{t("emptyRoster")}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {rows.map((row) => (
                <li key={row.studentId} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{row.studentName}</span>
                  <select
                    value={row.status}
                    onChange={(event) => updateRow(row.studentId, { status: event.target.value as AttendanceStatus })}
                    className="shrink-0 rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-crater"
                  >
                    {ATTENDANCE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(status)}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={row.note}
                    onChange={(event) => updateRow(row.studentId, { note: event.target.value })}
                    placeholder={t("attendanceNote")}
                    className="w-28 shrink-0 px-2 py-1 text-xs"
                  />
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              {t("cancel")}
            </button>
            <button type="button" disabled={pending || loading || rows.length === 0} onClick={save} className={cn(buttonVariants({ size: "sm" }))}>
              {t("confirm")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
