"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { createClassSessionAction } from "./actions/classes";
import { dateTimeInputToInstant, zonedDateParts } from "./schedule";

function nextHourValue(timeZone: string) {
  const parts = zonedDateParts(new Date(), timeZone);
  const next = new Date(Date.UTC(parts.year, parts.month, parts.day, parts.hour + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}T${String(next.getUTCHours()).padStart(2, "0")}:00`;
}

export function SessionCreateDialog({
  classroomId,
  defaultDurationMinutes,
  timeZone,
}: {
  classroomId: string;
  defaultDurationMinutes: number;
  timeZone: string;
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => nextHourValue(timeZone));
  const [durationMin, setDurationMin] = useState(String(defaultDurationMinutes));
  const [closedDayOpen, setClosedDayOpen] = useState(false);
  const [closedDayReason, setClosedDayReason] = useState("");
  const duration = Number(durationMin);
  const scheduledInstant = dateTimeInputToInstant(scheduledAt, timeZone);
  const valid = title.trim().length > 0
    && title.trim().length <= 100
    && scheduledInstant !== null
    && Number.isInteger(duration)
    && duration >= 1
    && duration <= 600;

  const reset = () => {
    setTitle("");
    setScheduledAt(nextHourValue(timeZone));
    setDurationMin(String(defaultDurationMinutes));
    setClosedDayReason("");
  };
  const createRun = useAction(createClassSessionAction, {
    successMessage: t("sessionCreated"),
    errorMessage: { CLOSED_DAY_CONFIRMATION_REQUIRED: t("closedDayConfirmationRequired"), default: t("actionFailed") },
    onSuccess: () => { setOpen(false); reset(); router.refresh(); },
    onError: (code) => {
      if (code === "CLOSED_DAY_CONFIRMATION_REQUIRED") {
        setOpen(false);
        setClosedDayOpen(true);
      }
    },
  });
  const confirmRun = useAction(createClassSessionAction, {
    successMessage: t("sessionCreated"),
    errorMessage: { CLOSED_DAY_CONFIRMATION_REQUIRED: t("closedDayReasonRequired"), default: t("actionFailed") },
    onSuccess: () => { setClosedDayOpen(false); setOpen(false); reset(); router.refresh(); },
  });

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {t("addSession")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("addSessionTitle")}</DialogTitle>
            <DialogDescription>{t("addSessionDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="new-session-title" className="text-xs font-normal text-muted">{t("sessionTitle")}</Label>
              <Input id="new-session-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="new-session-time" className="text-xs font-normal text-muted">{t("sessionScheduledAt")} · {timeZone}</Label>
              <DateTimePicker id="new-session-time" mode="datetime" value={scheduledAt} onValueChange={setScheduledAt} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="new-session-duration" className="text-xs font-normal text-muted">{t("sessionDuration")}</Label>
              <Input id="new-session-duration" type="number" min={1} max={600} step={5} value={durationMin} onChange={(event) => setDurationMin(event.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button type="button" disabled={!valid || createRun.pending} onClick={() => createRun.run(classroomId, {
              title: title.trim(),
              scheduledAt: scheduledInstant!.toISOString(),
              durationMin: duration,
              confirmClosedDay: false,
              closedDayReason: "",
            })}>{t("addSession")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={closedDayOpen} onOpenChange={(next) => {
        setClosedDayOpen(next);
        if (!next) setOpen(true);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("closedDayOverrideTitle")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted">{t("closedDayOverrideDescription")}</p>
          <Label className="grid gap-1.5 text-xs font-normal text-muted">
            {t("closedDayReason")}
            <Textarea value={closedDayReason} onChange={(event) => setClosedDayReason(event.target.value)} maxLength={500} rows={3} />
          </Label>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={confirmRun.pending} onClick={() => {
              setClosedDayOpen(false);
              setOpen(true);
            }}>{t("cancel")}</Button>
            <Button type="button" disabled={confirmRun.pending || !closedDayReason.trim()} onClick={() => confirmRun.run(classroomId, {
              title: title.trim(),
              scheduledAt: scheduledInstant!.toISOString(),
              durationMin: duration,
              confirmClosedDay: true,
              closedDayReason,
            })}>{t("confirmClosedDayOverride")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
