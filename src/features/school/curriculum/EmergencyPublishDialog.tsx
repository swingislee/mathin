"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { emergencyPublishCoursewareReviewAction } from "@/features/courseware-studio/actions";
import type { CoursewareTrack } from "@/features/courseware-studio/data";

export function EmergencyPublishDialog({ lectureId, track }: { lectureId: string; track: CoursewareTrack }) {
  const t = useTranslations("school.lecture");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const run = useAction(emergencyPublishCoursewareReviewAction, {
    successMessage: t("emergencyPublishSuccess"),
    errorMessage: { default: t("actionFailed"), REASON_REQUIRED: t("reasonRequired"), EMERGENCY_PUBLISH_DISABLED: t("emergencyPublishDisabled") },
    onSuccess: () => { setOpen(false); setReason(""); setNote(""); router.refresh(); },
  });

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button type="button" size="sm" variant="secondary" className="w-full text-rose">{t("emergencyPublish")}</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t("emergencyPublish")}</DialogTitle>
        <DialogDescription>{t("emergencyPublishHint")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("emergencyReasonPlaceholder")} rows={2} />
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("publishNotePlaceholder")} rows={2} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={run.pending} onClick={() => setOpen(false)}>{t("cancel")}</Button>
        <Button type="button" disabled={run.pending || !reason.trim()} onClick={() => run.run(lectureId, track, reason, note)}>{t("emergencyPublishConfirm")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
