"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { approveRefundAction } from "./actions/finance";
import type { PendingRefundRow } from "./finance";

export function RefundQueuePanel({ refunds }: { refunds: PendingRefundRow[] }) {
  const t = useTranslations("school.finance");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const approve = (refundId: string, ok: boolean) => {
    startTransition(async () => {
      const result = await approveRefundAction(refundId, ok);
      if (result.ok) { toast.success(ok ? t("refundApproved") : t("refundRejected")); router.refresh(); }
      else toast.error(t("actionFailed"));
    });
  };

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("refundQueue", { count: refunds.length })}</h2>
      {refunds.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("noPendingRefunds")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {refunds.map((refund) => (
            <li key={refund.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p>{refund.studentName} · <span className="font-mono text-xs text-muted">{refund.orderNo}</span></p>
                <p className="text-xs text-muted">¥{refund.amount.toFixed(2)} · {refund.reason || t("noReason")} · {refund.requestedByName}</p>
              </div>
              <span className="flex shrink-0 gap-3 text-xs">
                <button type="button" disabled={pending} onClick={() => approve(refund.id, true)} className="text-crater underline underline-offset-2 disabled:opacity-40">{t("approve")}</button>
                <button type="button" disabled={pending} onClick={() => approve(refund.id, false)} className="text-rose underline underline-offset-2 disabled:opacity-40">{t("reject")}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
