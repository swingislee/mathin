"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { updateSupportTaskRecipientAction } from "./actions/classes";
import type { SessionSupportTaskRecipientRow } from "./classes";

type RecipientStatus = SessionSupportTaskRecipientRow["status"];
type UpdatableStatus = "sent" | "confirmed" | "failed" | "waived";

/** 与 update_support_task_recipient 的 valid_transition 校验对齐；waived 是任意态可达的终态。 */
const NEXT_STATUS: Record<RecipientStatus, UpdatableStatus[]> = {
  pending: ["sent", "failed", "waived"],
  sent: ["confirmed", "failed", "waived"],
  confirmed: ["waived"],
  failed: ["waived"],
  waived: [],
};

/** 支持任务逐人明细（doc19 §16.3）：家庭通知/回访对象的发送-确认状态追踪。 */
export function SupportTaskRecipientList({ recipients }: { recipients: SessionSupportTaskRecipientRow[] }) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const run = useAction(updateSupportTaskRecipientAction, {
    successMessage: t("recipientUpdated"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  return (
    <ul className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
      {recipients.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-ink">
            {row.studentName}
            {row.guardianName ? ` · ${row.guardianName}` : ""}
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{t(`recipientStatus_${row.status}`)}</Badge>
            {NEXT_STATUS[row.status].map((next) => (
              <Button
                key={next}
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={run.pending}
                onClick={() => run.run(row.id, next, "")}
              >
                {t(`recipientAction_${next}`)}
              </Button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
