"use client";

import { Input } from "@/components/ui/input";

import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteUnstartedSessionAction, rescheduleSessionAction } from "./actions";
import { AttendanceDrawer } from "./AttendanceDrawer";
import type { SessionRow } from "./classes";
import { ReviewDrawer } from "./ReviewDrawer";
import { Badge } from "@/components/ui/badge";
import { SubstituteTeacherDialog } from "./SubstituteTeacherDialog";
import { SessionChangeDialog } from "./SessionChangeDialog";

function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SessionListPanel({
  classroomId,
  sessions,
  canMarkAttendance,
  canManage,
  canReview = false,
}: {
  classroomId: string;
  sessions: SessionRow[];
  canMarkAttendance: boolean;
  canManage: boolean;
  canReview?: boolean;
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();

  // 直接渲染 sessions prop；每次改动后 router.refresh() 让服务端带回最新列表
  // （删除→移出列表并进回收站、恢复→回到列表），避免本地缓存与回收站不同步。
  const rescheduleRun = useAction(rescheduleSessionAction, {
    successMessage: t("rescheduleSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const reschedule = (sessionId: string, iso: string, durationMin: number) => rescheduleRun.run(sessionId, iso, durationMin);

  const removeRun = useAction(deleteUnstartedSessionAction, {
    successMessage: t("sessionDeleted"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(), // 同步课次列表与回收站
  });
  const remove = (sessionId: string) => removeRun.run(sessionId);

  const pending = rescheduleRun.pending || removeRun.pending;

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("sessions", { count: sessions.length })}</h2>

      {sessions.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("emptySessions")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {sessions.map((row) => {
            const unstarted = !row.startedAt;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="w-10 shrink-0 font-mono text-xs text-muted">{row.no ?? "-"}</span>
                <Link href={`/classroom/${classroomId}/session/${row.id}`} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                  {row.name || t("untitledSession")}
                </Link>
                <Badge variant="secondary">
                  {row.endedAt ? t("statusEnded") : row.startedAt ? t("statusLive") : t("statusScheduled")}
                </Badge>
                {row.teacherOverrideName && <Badge variant="outline">{t("substituteBy", { name: row.teacherOverrideName })}</Badge>}
                {canMarkAttendance && !unstarted && <AttendanceDrawer sessionId={row.id} />}
                {canMarkAttendance && <SessionChangeDialog sessionId={row.id} />}
                {canReview && !unstarted && <ReviewDrawer sessionId={row.id} />}
                {canManage && unstarted && row.scheduledAt && (
                  <Input
                    type="datetime-local"
                    disabled={pending}
                    defaultValue={toDateTimeLocalValue(row.scheduledAt)}
                    onChange={(event) => {
                      const iso = new Date(event.target.value).toISOString();
                      reschedule(row.id, iso, row.durationMin ?? 90);
                    }}
                    className="shrink-0 rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-crater"
                  />
                )}
                {canManage && unstarted && (
                  <SubstituteTeacherDialog sessionId={row.id} currentTeacherId={row.teacherOverrideId} />
                )}
                {canManage && unstarted && (
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
