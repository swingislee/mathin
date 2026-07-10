"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { deleteUnstartedSessionAction, rescheduleSessionAction } from "./actions";
import { AttendanceDrawer } from "./AttendanceDrawer";
import type { SessionRow } from "./classes";

function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SessionListPanel({
  classroomId,
  sessions,
  canMarkAttendance,
}: {
  classroomId: string;
  sessions: SessionRow[];
  canMarkAttendance: boolean;
}) {
  const t = useTranslations("school.classes");
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState(sessions);
  const [error, setError] = useState<string | null>(null);

  const reschedule = (sessionId: string, iso: string, durationMin: number) => {
    setError(null);
    startTransition(async () => {
      try {
        await rescheduleSessionAction(sessionId, iso, durationMin);
        setRows((prev) => prev.map((row) => (row.id === sessionId ? { ...row, scheduledAt: iso } : row)));
      } catch {
        setError(t("actionFailed"));
      }
    });
  };

  const remove = (sessionId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await deleteUnstartedSessionAction(sessionId);
        setRows((prev) => prev.filter((row) => row.id !== sessionId));
      } catch {
        setError(t("actionFailed"));
      }
    });
  };

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("sessions", { count: rows.length })}</h2>
      {error && <p className="mt-3 text-xs text-rose">{error}</p>}

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("emptySessions")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((row) => {
            const unstarted = !row.startedAt;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="w-10 shrink-0 font-mono text-xs text-muted">{row.no ?? "-"}</span>
                <Link href={`/classroom/${classroomId}/session/${row.id}`} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                  {row.name || t("untitledSession")}
                </Link>
                <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">
                  {row.endedAt ? t("statusEnded") : row.startedAt ? t("statusLive") : t("statusScheduled")}
                </span>
                {canMarkAttendance && !unstarted && <AttendanceDrawer sessionId={row.id} />}
                {unstarted && row.scheduledAt && (
                  <input
                    type="datetime-local"
                    disabled={pending}
                    defaultValue={toDateTimeLocalValue(row.scheduledAt)}
                    onChange={(event) => {
                      const iso = new Date(event.target.value).toISOString();
                      reschedule(row.id, iso, row.durationMin ?? 90);
                    }}
                    className="shrink-0 rounded-lg border border-line bg-background px-2 py-1 text-xs outline-none focus:border-crater"
                  />
                )}
                {unstarted && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(row.id)}
                    className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-rose disabled:opacity-40"
                  >
                    {t("deleteSession")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
