"use client";

import { CheckCircle2, CircleCheckBig, LoaderCircle, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { newId } from "@/lib/uuid";
import { closeDurableWorkItemAction, decideApprovalAction } from "../actions/work-items";
import type { WorkItemRow } from "./types";

type Mode = "close" | "approved" | "rejected";

function nextIdempotencyKey(mode: Mode) {
  return `${mode}:${newId()}`;
}

export function WorkItemDecisionActions({ item }: { item: WorkItemRow }) {
  const t = useTranslations("school.work");
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const onSuccess = () => {
    setMode(null);
    setReason("");
    router.refresh();
  };
  const close = useAction(closeDurableWorkItemAction, {
    successMessage: t("coordinationClosed"),
    errorMessage: { default: t("actionFailed") },
    onSuccess,
  });
  const decide = useAction(decideApprovalAction, {
    successMessage: t("coordinationDecided"),
    errorMessage: { default: t("actionFailed") },
    onSuccess,
  });

  if (!item.canAct || (item.actionKind !== "work_item.close" && item.actionKind !== "approval.decide")) return null;

  const open = (next: Mode) => {
    setReason("");
    setIdempotencyKey(nextIdempotencyKey(next));
    setMode(next);
  };
  const submit = () => {
    if (!mode || !reason.trim()) return;
    if (mode === "close") close.run(item.primaryObjectId, reason, idempotencyKey);
    else decide.run(item.primaryObjectId, mode, reason, idempotencyKey);
  };
  const pending = close.pending || decide.pending;

  return (
    <>
      {item.actionKind === "work_item.close" ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => open("close")}>
          <CircleCheckBig size={14} />{t("coordinationClose")}
        </Button>
      ) : (
        <>
          <Button type="button" size="sm" variant="secondary" onClick={() => open("rejected")}>
            <XCircle size={14} />{t("coordinationReject")}
          </Button>
          <Button type="button" size="sm" onClick={() => open("approved")}>
            <CheckCircle2 size={14} />{t("coordinationApprove")}
          </Button>
        </>
      )}
      <Dialog open={mode !== null} onOpenChange={(next) => { if (!next) setMode(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "close" ? t("coordinationCloseTitle") : t("coordinationDecisionTitle")}</DialogTitle>
            <DialogDescription>{t("coordinationDecisionHint")}</DialogDescription>
          </DialogHeader>
          <Label className="grid gap-1.5">
            {t("coordinationDecisionReason")}
            <Textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>{t("coordinationCancel")}</Button>
            <Button type="button" disabled={pending || !reason.trim()} onClick={submit}>
              {pending && <LoaderCircle size={15} className="animate-spin" />}
              {mode === "rejected" ? t("coordinationReject") : mode === "approved" ? t("coordinationApprove") : t("coordinationClose")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
