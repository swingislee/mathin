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
import { cn } from "@/lib/utils";
import { useRouter } from "@/i18n/navigation";
import { getAttendanceDrawerData, saveAttendanceAction } from "./actions/attendance";
import { type AttendanceDrawerRow } from "./actions/types";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "./learning";

export function AttendanceDrawer({ sessionId }: { sessionId: string }) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AttendanceDrawerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const { run: save, pending } = useAction((rows: AttendanceDrawerRow[]) => saveAttendanceAction(sessionId, rows), {
    successMessage: t("attendanceSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setOpen(false);
      // P4I-15：保存后课后 tab 的"点名"任务可能已被服务端顺带标记完成，刷新以反映最新状态。
      router.refresh();
    },
  });

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
                  <Select value={row.status} onValueChange={(value) => updateRow(row.studentId, { status: value as AttendanceStatus })}>
                    <SelectTrigger className="h-8 shrink-0 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ATTENDANCE_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {t(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
            <button type="button" disabled={pending || loading || rows.length === 0} onClick={() => save(rows)} className={cn(buttonVariants({ size: "sm" }))}>
              {t("confirm")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
