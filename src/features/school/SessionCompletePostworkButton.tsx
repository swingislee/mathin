"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { completeSessionPostworkAction, reopenSessionPostworkAction } from "./actions/classes";

export function SessionCompletePostworkButton({
  sessionId,
  completed,
  disabled,
}: {
  sessionId: string;
  completed: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const completeRun = useAction(completeSessionPostworkAction, {
    successMessage: t("postworkCompleted"),
    errorMessage: { TASKS_NOT_COMPLETE: t("postworkTasksNotComplete"), default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const reopenRun = useAction(reopenSessionPostworkAction, {
    successMessage: t("postworkReopened"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  if (completed) {
    return (
      <Button size="sm" variant="secondary" disabled={disabled || reopenRun.pending} onClick={() => reopenRun.run(sessionId)}>
        {t("reopenPostwork")}
      </Button>
    );
  }
  return (
    <Button size="sm" disabled={disabled || completeRun.pending} onClick={() => completeRun.run(sessionId)}>
      {t("completePostwork")}
    </Button>
  );
}
