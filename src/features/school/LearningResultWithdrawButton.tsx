"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import {
  withdrawLearningResultAction,
  withdrawSessionLearningResultsAction,
  withdrawSessionReviewsAction,
} from "./learning-result-actions";

export function LearningResultWithdrawButton({
  mode,
  targetId,
  disabled = false,
  onSuccess,
}: {
  mode: "head" | "session" | "sessionReviews";
  targetId: string;
  disabled?: boolean;
  onSuccess?: () => void;
}) {
  const t = useTranslations("school.learningResults");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useAction(
    (value: string) => {
      if (mode === "head") return withdrawLearningResultAction(targetId, value);
      if (mode === "sessionReviews") return withdrawSessionReviewsAction(targetId, value);
      return withdrawSessionLearningResultsAction(targetId, value);
    },
    {
      successMessage: t("withdrawnToast"),
      errorMessage: { default: t("actionFailed") },
      onSuccess: () => {
        setOpen(false);
        setReason("");
        onSuccess?.();
        router.refresh();
      },
    },
  );

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className="text-rose"
        disabled={disabled || action.pending}
        onClick={() => setOpen(true)}
      >
        {t("withdraw")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("withdrawTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("withdrawReason")}
            maxLength={1000}
            rows={4}
          />
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              variant="secondary"
              className="text-rose"
              disabled={!reason.trim() || action.pending}
              onClick={() => action.run(reason)}
            >
              {t("withdrawConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
