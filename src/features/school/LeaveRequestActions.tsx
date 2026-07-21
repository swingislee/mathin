"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { decideSessionLeaveRequestAction } from "./actions/classes";

/** 请假审批（doc19 §14.3）；批准后 RPC 内部会顺带生成 makeup_followup 支持任务。 */
export function LeaveRequestActions({ requestId }: { requestId: string }) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const run = useAction(decideSessionLeaveRequestAction, {
    successMessage: t("leaveDecided"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button size="sm" variant="secondary" disabled={run.pending} onClick={() => run.run(requestId, true)}>
        {t("leaveApprove")}
      </Button>
      <Button size="sm" variant="ghost" disabled={run.pending} onClick={() => run.run(requestId, false)}>
        {t("leaveReject")}
      </Button>
    </div>
  );
}
