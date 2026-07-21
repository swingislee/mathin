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

/**
 * 通用"标记完成/跳过"。作业任务无专用表单，两个按钮都保留；点名/课评/总结/视频审阅/跟进
 * 已在 P4I-15 接上专用表单并在保存成功后自动标记完成，这里用 hideMarkDone 只保留"跳过"
 * （例如本节课无人提交视频、无需跟进等确有其事的"没有可做"场景）。
 */
export function SessionTaskActions({ taskId, disabled, hideMarkDone = false }: { taskId: string; disabled: boolean; hideMarkDone?: boolean }) {
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
      {!hideMarkDone && (
        <Button size="sm" variant="secondary" disabled={disabled || run.pending} onClick={() => run.run(taskId, "done", "")}>
          {t("taskMarkDone")}
        </Button>
      )}
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
