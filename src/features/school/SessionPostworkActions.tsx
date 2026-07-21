"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { completeSessionTaskAction } from "./actions/classes";

/** 通用"标记完成/跳过"；具体每类任务的专用表单留给 P4I-15，本组件只做状态位标记。 */
export function SessionTaskActions({ taskId, disabled }: { taskId: string; disabled: boolean }) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState("");

  const run = useAction(completeSessionTaskAction, {
    successMessage: t("taskUpdated"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setSkipOpen(false);
      setSkipReason("");
      router.refresh();
    },
  });

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button size="sm" variant="secondary" disabled={disabled || run.pending} onClick={() => run.run(taskId, "done", "")}>
        {t("taskMarkDone")}
      </Button>
      <Button size="sm" variant="ghost" disabled={disabled || run.pending} onClick={() => setSkipOpen(true)}>
        {t("taskSkip")}
      </Button>
      <Dialog open={skipOpen} onOpenChange={setSkipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("taskSkipDialogTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={skipReason}
            onChange={(event) => setSkipReason(event.target.value)}
            placeholder={t("taskSkipReasonPlaceholder")}
            maxLength={1000}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSkipOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              disabled={!skipReason.trim() || run.pending}
              onClick={() => run.run(taskId, "skipped", skipReason)}
            >
              {t("taskSkipConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
