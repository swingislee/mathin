"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAction } from "@/components/action-form";
import { Link, useRouter } from "@/i18n/navigation";
import type { SessionCapabilities } from "./teaching-operations/types";
import {
  deleteUnstartedSessionAction,
  restoreSessionAction,
  updateClassSessionAction,
  voidSessionAction,
} from "./actions/classes";
import type { SessionRow } from "./classes";
import { withReturnTo } from "./object-workspace/return-target";
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
  classroomName,
  classroomRoom,
  closeHref,
}: {
  session: SessionRow | null;
  classroomName: string;
  classroomRoom: string;
  closeHref: string;
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState(session?.name ?? "");
  const [scheduledAt, setScheduledAt] = useState(session?.scheduledAt ? toDateTimeLocalValue(session.scheduledAt) : "");
  const [durationMin, setDurationMin] = useState(String(session?.durationMin ?? 90));

  const close = () => router.replace(closeHref);

  const updateRun = useAction(updateClassSessionAction, {
    successMessage: t("sessionSaved"),
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

  const pending = updateRun.pending || cancelRun.pending || restoreRun.pending || voidRun.pending;
  const capabilities: SessionCapabilities | undefined = session?.capabilities;
  const duration = Number(durationMin);
  const scheduleValid = title.trim().length > 0
    && title.trim().length <= 100
    && scheduledAt !== ""
    && Number.isInteger(duration)
    && duration >= 1
    && duration <= 600;

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
                {classroomName && <span>· {classroomName}</span>}
              </div>
              {/* doc23 §18：抽屉可能开在班级详情，也可能开在课表。带上来源，
                  课次工作区的返回才会回到刚才那一页，而不是永远回班级。 */}
              <Link href={withReturnTo(`/dashboard/sessions/${session.id}`, closeHref)} className="text-sm font-medium text-crater transition hover:underline">
                {t("openFullSession")}
              </Link>
            </SheetHeader>

            <section className="grid gap-2">
              <h3 className="text-xs font-medium uppercase text-muted">{t("zoneSchedule")}</h3>
              {capabilities.canReschedule ? (
                <div className="grid gap-3">
                  <div>
                    <Label htmlFor="edit-session-title" className="text-xs font-normal text-muted">{t("sessionTitle")}</Label>
                    <Input id="edit-session-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} disabled={pending} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="edit-session-time" className="text-xs font-normal text-muted">{t("sessionScheduledAt")}</Label>
                    <DateTimePicker id="edit-session-time" mode="datetime" disabled={pending} value={scheduledAt} onValueChange={setScheduledAt} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="edit-session-duration" className="text-xs font-normal text-muted">{t("sessionDuration")}</Label>
                    <Input id="edit-session-duration" type="number" min={1} max={600} step={5} value={durationMin} onChange={(event) => setDurationMin(event.target.value)} disabled={pending} className="mt-1" />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!scheduleValid || pending}
                    onClick={() => updateRun.run(session.id, {
                      title: title.trim(),
                      scheduledAt: new Date(scheduledAt).toISOString(),
                      durationMin: duration,
                    })}
                  >
                    {t("saveSession")}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted">{session.scheduledAt ? new Date(session.scheduledAt).toLocaleString() : t("notApplicable")}</p>
              )}
              <p className="text-sm text-muted">{classroomRoom || t("notApplicable")}</p>
              {capabilities.canAssignSubstitute && (
                <SubstituteTeacherDialog sessionId={session.id} currentTeacherId={session.teacherOverrideId} />
              )}
              {capabilities.canMarkAttendance && <SessionChangeDialog sessionId={session.id} />}
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
