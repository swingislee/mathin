"use client";

import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import { useRouter } from "@/i18n/navigation";
import { getAttendanceDrawerData, saveAttendanceAction } from "./actions/attendance";
import { type AttendanceDrawerRow } from "./actions/types";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./learning";

const STATUS_TONE: Record<AttendanceStatus, string> = {
  present: "border-leaf/60 bg-leaf/15 text-leaf-deep",
  absent: "border-rose/60 bg-rose/10 text-rose",
  late: "border-amber-400/60 bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  leave: "border-sky-400/60 bg-sky-100 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100",
};

export function AttendanceDrawer({
  sessionId,
  appearance = "link",
  mode = "initial",
  onSaved,
}: {
  sessionId: string;
  appearance?: "link" | "primary";
  mode?: "initial" | "amend";
  onSaved?: () => void;
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AttendanceDrawerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const label = mode === "amend" ? t("amendAttendance") : t("markAttendance");

  const openDrawer = () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    void getAttendanceDrawerData(sessionId)
      .then((result) => {
        if (result.ok) setRows(result.data);
        else setError(t("actionFailed"));
      })
      .finally(() => setLoading(false));
  };

  const updateRow = (studentId: string, patch: Partial<AttendanceDrawerRow>) => {
    setRows((prev) => prev.map((row) => (row.studentId === studentId ? { ...row, ...patch } : row)));
  };

  const { run: save, pending } = useAction((records: AttendanceDrawerRow[]) => saveAttendanceAction(sessionId, records), {
    successMessage: t("attendanceSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setOpen(false);
      onSaved?.();
      router.refresh();
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className={appearance === "primary"
          ? cn(buttonVariants({ size: "sm" }), "shrink-0")
          : "shrink-0 text-xs text-muted underline underline-offset-2 hover:text-ink"}
      >
        {label}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-dvh overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>

          {mode === "amend" && <p className="text-xs text-muted">{t("amendAttendanceHint")}</p>}
          {error && <p className="text-xs text-rose">{error}</p>}

          {loading ? (
            <p className="py-4 text-sm text-muted">{t("loading")}</p>
          ) : rows.length === 0 ? (
            <p className="py-4 text-sm text-muted">{t("emptyRoster")}</p>
          ) : (
            <ul className="grid max-h-[70dvh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {rows.map((row) => (
                <li key={row.studentId} className="rounded-xl border border-line bg-card p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.studentName}</span>
                    {row.marked && <span className="text-[11px] text-muted">{t("attendanceRecorded")}</span>}
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1">
                    {ATTENDANCE_STATUSES.map((status) => (
                      <button
                        key={status}
                        type="button"
                        aria-pressed={row.status === status}
                        onClick={() => updateRow(row.studentId, { status })}
                        className={cn(
                          "min-h-11 rounded-lg border px-1 text-xs font-medium transition-transform active:scale-95",
                          STATUS_TONE[status],
                          row.status === status && "ring-2 ring-ink/45 ring-offset-1 ring-offset-card",
                        )}
                      >
                        {t(status)}
                      </button>
                    ))}
                  </div>
                  <Input
                    value={row.note}
                    onChange={(event) => updateRow(row.studentId, { note: event.target.value })}
                    placeholder={t("attendanceNote")}
                    className="mt-2 h-9 w-full px-2 py-1 text-xs"
                  />
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              {t("cancel")}
            </button>
            <button type="button" disabled={pending || loading || rows.length === 0} onClick={() => save(rows)} className={cn(buttonVariants({ size: "sm" }))}>
              {t("confirm")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}