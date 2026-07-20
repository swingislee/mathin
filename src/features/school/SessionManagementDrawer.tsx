"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import type { SessionCapabilities } from "./teaching-operations/types";
import {
  deleteUnstartedSessionAction,
  rescheduleSessionAction,
  restoreSessionAction,
  setSessionCoursewareTrackOverrideAction,
  voidSessionAction,
} from "./actions/classes";
import { AttendanceDrawer } from "./AttendanceDrawer";
import type { SessionRow } from "./classes";
import { ReviewDrawer } from "./ReviewDrawer";
import { SessionChangeDialog } from "./SessionChangeDialog";
import { SubstituteTeacherDialog } from "./SubstituteTeacherDialog";

function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function reasonText(t: ReturnType<typeof useTranslations>, code: string | undefined): string | undefined {
  if (!code) return undefined;
  switch (code) {
    case "FORBIDDEN_SCOPE": return t("reasonForbiddenScope");
    case "SESSION_ALREADY_STARTED": return t("reasonSessionAlreadyStarted");
    case "SESSION_NOT_CANCELLED": return t("reasonSessionNotCancelled");
    default: return t("reasonForbidden");
  }
}

export function SessionManagementDrawer({
  session,
  classroomCoursewareTrack,
  closeHref,
}: {
  session: SessionRow | null;
  classroomCoursewareTrack: "native-16x9" | "adapted-4x3";
  closeHref: string;
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [reason, setReason] = useState("");

  const close = () => router.replace(closeHref);

  const rescheduleRun = useAction(rescheduleSessionAction, {
    successMessage: t("rescheduleSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const trackRun = useAction(setSessionCoursewareTrackOverrideAction, {
    successMessage: t("coursewareTrackSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const cancelRun = useAction(deleteUnstartedSessionAction, {
    successMessage: t("sessionCancelled"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const restoreRun = useAction(restoreSessionAction, {
    successMessage: t("sessionRestored"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const voidRun = useAction(voidSessionAction, {
    successMessage: t("sessionVoided"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  const pending = rescheduleRun.pending || trackRun.pending || cancelRun.pending || restoreRun.pending || voidRun.pending;
  const capabilities: SessionCapabilities | undefined = session?.capabilities;

  const stateLabel = session && (
    session.state === "ended" ? t("statusEnded")
      : session.state === "started" ? t("statusLive")
      : session.state === "cancelled" ? t("statusCancelled")
      : session.state === "voided" ? t("statusVoided")
      : t("statusScheduled")
  );

  return (
    <Sheet open={session !== null} onOpenChange={(next) => { if (!next) close(); }}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-md" closeLabel={t("cancel")}>
        {session && capabilities && (
          <>
            <SheetHeader>
              <SheetTitle>{session.name || t("untitledSession")}</SheetTitle>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <Badge variant="secondary">{stateLabel}</Badge>
                {session.scheduledAt && <span>{new Date(session.scheduledAt).toLocaleString()}</span>}
              </div>
            </SheetHeader>

            <section className="grid gap-2">
              <h3 className="text-xs font-medium uppercase text-muted">{t("zoneSchedule")}</h3>
              {capabilities.canReschedule && session.scheduledAt ? (
                <Input
                  type="datetime-local"
                  disabled={pending}
                  defaultValue={toDateTimeLocalValue(session.scheduledAt)}
                  onChange={(event) => {
                    const iso = new Date(event.target.value).toISOString();
                    rescheduleRun.run(session.id, iso, session.durationMin ?? 90);
                  }}
                  className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm"
                />
              ) : (
                <p className="text-sm text-muted">{session.scheduledAt ? new Date(session.scheduledAt).toLocaleString() : t("notApplicable")}</p>
              )}
              {capabilities.canAssignSubstitute && (
                <SubstituteTeacherDialog sessionId={session.id} currentTeacherId={session.teacherOverrideId} />
              )}
            </section>

            <section className="grid gap-2">
              <h3 className="text-xs font-medium uppercase text-muted">{t("zoneCourseware")}</h3>
              {capabilities.canReschedule && session.lectureId ? (
                <Select
                  value={session.coursewareTrackOverride ?? "inherit"}
                  disabled={pending}
                  onValueChange={(value) => trackRun.run(session.id, value === "inherit" ? null : value as "native-16x9" | "adapted-4x3")}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t("coursewareTrackInherit")}</SelectItem>
                    <SelectItem value="native-16x9">{t("coursewareTrackNative")}</SelectItem>
                    <SelectItem value="adapted-4x3">{t("coursewareTrackAdapted")}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline">
                  {session.coursewareTrackOverride === "adapted-4x3" || (!session.coursewareTrackOverride && classroomCoursewareTrack === "adapted-4x3")
                    ? t("coursewareTrackAdaptedShort") : t("coursewareTrackNativeShort")}
                </Badge>
              )}
            </section>

            <section className="grid gap-2">
              <h3 className="text-xs font-medium uppercase text-muted">{t("zoneAttendance")}</h3>
              <div className="flex flex-wrap gap-2">
                {capabilities.canMarkAttendance && <AttendanceDrawer sessionId={session.id} />}
                {capabilities.canMarkAttendance && <SessionChangeDialog sessionId={session.id} />}
                {!capabilities.canMarkAttendance && <p className="text-sm text-muted">{reasonText(t, capabilities.reasons.attendance) ?? t("notApplicable")}</p>}
              </div>
            </section>

            <section className="grid gap-2">
              <h3 className="text-xs font-medium uppercase text-muted">{t("zoneReview")}</h3>
              {capabilities.canWriteReview ? (
                <ReviewDrawer sessionId={session.id} />
              ) : (
                <p className="text-sm text-muted">{reasonText(t, capabilities.reasons.review) ?? t("notApplicable")}</p>
              )}
            </section>

            <section className="grid gap-2 border-t border-line pt-4">
              <h3 className="text-xs font-medium uppercase text-muted">{t("zoneLifecycle")}</h3>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("lifecycleReasonPlaceholder")}
                maxLength={1000}
                className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!capabilities.canCancel || pending}
                  title={reasonText(t, capabilities.reasons.cancel)}
                  onClick={() => cancelRun.run(session.id, reason)}
                >
                  {t("cancelSession")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!capabilities.canRestore || pending}
                  title={reasonText(t, capabilities.reasons.restore)}
                  onClick={() => restoreRun.run(session.id)}
                >
                  {t("restore")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!capabilities.canVoid || pending}
                  title={reasonText(t, capabilities.reasons.void)}
                  onClick={() => voidRun.run(session.id, reason)}
                >
                  {t("voidSession")}
                </Button>
              </div>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
