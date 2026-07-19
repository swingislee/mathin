"use client";

import { Input } from "@/components/ui/input";

import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { deleteUnstartedSessionAction, rescheduleSessionAction } from "./actions/classes";
import { AttendanceDrawer } from "./AttendanceDrawer";
import type { SessionRow } from "./classes";
import { ReviewDrawer } from "./ReviewDrawer";
import { Badge } from "@/components/ui/badge";
import { SubstituteTeacherDialog } from "./SubstituteTeacherDialog";
import { SessionChangeDialog } from "./SessionChangeDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setSessionCoursewareTrackOverrideAction } from "./actions/classes";

function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SessionListPanel({
  sessions,
  canMarkAttendance,
  canManage,
  canReview = false,
  classroomCoursewareTrack,
}: {
  sessions: SessionRow[];
  canMarkAttendance: boolean;
  canManage: boolean;
  canReview?: boolean;
  classroomCoursewareTrack: "native-16x9" | "adapted-4x3";
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

  const trackRun = useAction(setSessionCoursewareTrackOverrideAction, {
    successMessage: t("coursewareTrackSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  const pending = rescheduleRun.pending || removeRun.pending || trackRun.pending;

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
                <span className="min-w-0 flex-1 truncate font-medium">
                  {row.name || t("untitledSession")}
                </span>
                <Badge variant="secondary">
                  {row.endedAt ? t("statusEnded") : row.startedAt ? t("statusLive") : t("statusScheduled")}
                </Badge>
                {row.teacherOverrideName && <Badge variant="outline">{t("substituteBy", { name: row.teacherOverrideName })}</Badge>}
                {row.lectureId ? <Badge variant="outline">{row.coursewareTrackOverride === "adapted-4x3" || (!row.coursewareTrackOverride && classroomCoursewareTrack === "adapted-4x3") ? t("coursewareTrackAdaptedShort") : t("coursewareTrackNativeShort")}</Badge> : null}
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
                {canManage && unstarted && row.lectureId ? (
                  <Select
                    value={row.coursewareTrackOverride ?? "inherit"}
                    disabled={pending}
                    onValueChange={(value) => trackRun.run(row.id, value === "inherit" ? null : value as "native-16x9" | "adapted-4x3")}
                  >
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">{t("coursewareTrackInherit")}</SelectItem>
                      <SelectItem value="native-16x9">{t("coursewareTrackNative")}</SelectItem>
                      <SelectItem value="adapted-4x3">{t("coursewareTrackAdapted")}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
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
