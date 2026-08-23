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
import { useRouter } from "@/i18n/navigation";
import { createClassSessionAction } from "./actions/classes";

function nextHourValue() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SessionCreateDialog({ classroomId }: { classroomId: string }) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState(nextHourValue);
  const [durationMin, setDurationMin] = useState("90");
  const duration = Number(durationMin);
  const valid = title.trim().length > 0
    && title.trim().length <= 100
    && scheduledAt !== ""
    && Number.isInteger(duration)
    && duration >= 1
    && duration <= 600;

  const createRun = useAction(createClassSessionAction, {
    successMessage: t("sessionCreated"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setOpen(false);
      setTitle("");
      setScheduledAt(nextHourValue());
      setDurationMin("90");
      router.refresh();
    },
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
              <Label htmlFor="new-session-time" className="text-xs font-normal text-muted">{t("sessionScheduledAt")}</Label>
              <DateTimePicker id="new-session-time" mode="datetime" value={scheduledAt} onValueChange={setScheduledAt} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="new-session-duration" className="text-xs font-normal text-muted">{t("sessionDuration")}</Label>
              <Input id="new-session-duration" type="number" min={1} max={600} step={5} value={durationMin} onChange={(event) => setDurationMin(event.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button
              type="button"
              disabled={!valid || createRun.pending}
              onClick={() => createRun.run(classroomId, {
                title: title.trim(),
                scheduledAt: new Date(scheduledAt).toISOString(),
                durationMin: duration,
              })}
            >
              {t("addSession")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
