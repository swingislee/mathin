"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/action-form";
import { Link, useRouter } from "@/i18n/navigation";
import type { SessionCapabilities } from "./teaching-operations/types";
import {
  deleteUnstartedSessionAction,
  restoreSessionAction,
  resetClassSessionRoomAction,
  updateClassSessionAction,
  voidSessionAction,
} from "./actions/classes";
import type { SessionRow } from "./classes";
import { withReturnTo } from "./object-workspace/return-target";
import { SessionChangeDialog } from "./SessionChangeDialog";
import { SubstituteTeacherDialog } from "./SubstituteTeacherDialog";
import { RoomPicker } from "./RoomPicker";
import { formatRoomLocation } from "./location-format";
import type { RoomOptionV2 } from "./organization-locations";
import { dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";

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
  classroomDefaultRoomId,
  roomOptions,
  timeZone,
  closeHref,
}: {
  session: SessionRow | null;
  classroomName: string;
  classroomDefaultRoomId: string | null;
  roomOptions: RoomOptionV2[];
  timeZone: string;
  closeHref: string;
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState(session?.name ?? "");
  const [scheduledAt, setScheduledAt] = useState(session?.scheduledAt ? zonedDateTimeInputValue(new Date(session.scheduledAt), timeZone) : "");
  const [durationMin, setDurationMin] = useState(String(session?.durationMin ?? 90));
  const [roomId, setRoomId] = useState<string | null>(session?.roomId ?? null);
  const [closedDayConfirmOpen, setClosedDayConfirmOpen] = useState(false);
  const [closedDayReason, setClosedDayReason] = useState("");

  const close = () => router.replace(closeHref);

  const updateRun = useAction(updateClassSessionAction, {
    successMessage: t("sessionSaved"),
    errorMessage: { CLOSED_DAY_CONFIRMATION_REQUIRED: t("closedDayConfirmationRequired"), default: t("actionFailed") },
    onSuccess: () => router.refresh(),
    onError: (code) => { if (code === "CLOSED_DAY_CONFIRMATION_REQUIRED") setClosedDayConfirmOpen(true); },
  });
  const confirmClosedDayRun = useAction(updateClassSessionAction, {
    successMessage: t("sessionSaved"),
    errorMessage: { CLOSED_DAY_CONFIRMATION_REQUIRED: t("closedDayReasonRequired"), default: t("actionFailed") },
    onSuccess: () => { setClosedDayConfirmOpen(false); setClosedDayReason(""); router.refresh(); },
  });
  const resetRoomRun = useAction(resetClassSessionRoomAction, {
    successMessage: t("sessionRoomReset"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setRoomId(classroomDefaultRoomId); router.refresh(); },
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

  const pending = updateRun.pending || confirmClosedDayRun.pending || resetRoomRun.pending || cancelRun.pending || restoreRun.pending || voidRun.pending;
  const capabilities: SessionCapabilities | undefined = session?.capabilities;
  const duration = Number(durationMin);
  const scheduledInstant = dateTimeInputToInstant(scheduledAt, timeZone);
  const scheduleValid = title.trim().length > 0
    && title.trim().length <= 100
    && scheduledInstant !== null
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
                {session.scheduledAt && <span>{new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(session.scheduledAt))}</span>}
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
                  <div>
                    <Label htmlFor="edit-session-room" className="text-xs font-normal text-muted">{t("sessionRoom")}</Label>
                    <div className="mt-1"><RoomPicker id="edit-session-room" rooms={roomOptions} value={roomId} onValueChange={setRoomId} disabled={pending} /></div>
                    {session.roomAssignmentOrigin === "session_override" ? (
                      <Button type="button" size="sm" variant="ghost" className="mt-1" disabled={pending} onClick={() => resetRoomRun.run(session.id)}>{t("followClassDefault")}</Button>
                    ) : <p className="mt-1 text-xs text-muted">{t("usingFrozenClassDefault")}</p>}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!scheduleValid || pending}
                    onClick={() => updateRun.run(session.id, {
                      title: title.trim(),
                      scheduledAt: scheduledInstant!.toISOString(),
                      durationMin: duration,
                      roomId,
                      confirmClosedDay: false,
                      closedDayReason: "",
                    })}
                  >
                    {t("saveSession")}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted">{session.scheduledAt ? new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(session.scheduledAt)) : t("notApplicable")}</p>
              )}
              {!capabilities.canReschedule ? <p className="text-sm text-muted">{formatRoomLocation(session.roomName, session.campusName, t("roomTbd"))}</p> : null}
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
      {session ? (
        <Dialog open={closedDayConfirmOpen} onOpenChange={setClosedDayConfirmOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{t("closedDayOverrideTitle")}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted">{t("closedDayOverrideDescription")}</p>
            <Label className="grid gap-1.5 text-xs font-normal text-muted">
              {t("closedDayReason")}
              <Textarea value={closedDayReason} onChange={(event) => setClosedDayReason(event.target.value)} maxLength={500} rows={3} />
            </Label>
            <DialogFooter>
              <Button type="button" size="sm" variant="secondary" disabled={confirmClosedDayRun.pending} onClick={() => setClosedDayConfirmOpen(false)}>{t("cancel")}</Button>
              <Button type="button" size="sm" disabled={confirmClosedDayRun.pending || !closedDayReason.trim()} onClick={() => confirmClosedDayRun.run(session.id, {
                title: title.trim(),
                scheduledAt: scheduledInstant!.toISOString(),
                durationMin: duration,
                roomId,
                confirmClosedDay: true,
                closedDayReason,
              })}>{t("confirmClosedDayOverride")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Sheet>
  );
}
