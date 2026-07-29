"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { replayDeadJobAction } from "./actions/platform-operations";

export function JobReplayButton({ jobId }: { jobId: string }) {
  const t = useTranslations("school.operations");
  const router = useRouter();
  const replay = useAction(replayDeadJobAction, {
    successMessage: t("replaySucceeded"),
    errorMessage: { default: t("replayFailed") },
    onSuccess: () => router.refresh(),
  });
  return (
    <Button size="sm" variant="secondary" disabled={replay.pending} onClick={() => replay.run({
      jobId,
      reason: t("manualReplayReason"),
    })}>
      <RotateCcw className="size-3.5" />{t("replay")}
    </Button>
  );
}
