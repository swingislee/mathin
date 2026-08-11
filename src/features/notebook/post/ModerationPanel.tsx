"use client";

import { CheckCircle2, Eye, EyeOff, LoaderCircle, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import {
  moderatePostAction,
  reviewNotebookPostAction,
  type NotebookPublicationActionCode,
} from "../actions";

export function ModerationPanel({
  postId,
  lifecycleStatus,
  reviewStatus,
  moderationStatus,
}: {
  postId: string;
  lifecycleStatus: string;
  reviewStatus: string;
  moderationStatus: string;
}) {
  const t = useTranslations("notebook.public");
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" } | { kind: "error"; code: NotebookPublicationActionCode } | null>(null);
  const [pending, startTransition] = useTransition();
  const awaitingReview = lifecycleStatus === "review" && reviewStatus === "pending";
  const platformHidden = moderationStatus === "hidden";

  const review = (decision: "approved" | "rejected") => {
    startTransition(async () => {
      const result = await reviewNotebookPostAction({ postId, decision, reason });
      if (result.ok) {
        setFeedback({ kind: "success" });
        setReason("");
        router.refresh();
      } else {
        setFeedback({ kind: "error", code: result.code });
      }
    });
  };

  const moderate = (status: "approved" | "hidden") => {
    startTransition(async () => {
      const result = await moderatePostAction({ postId, status, reason });
      if (result.ok) {
        setFeedback({ kind: "success" });
        setReason("");
        router.refresh();
      } else {
        setFeedback({ kind: "error", code: result.code });
      }
    });
  };

  return (
    <aside className="mt-8 rounded-2xl border border-rose/30 bg-rose/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{t("moderationTitle")}</p>
        <Badge variant="outline">{t(`lifecycle.${lifecycleStatus}`)}</Badge>
        <Badge variant={platformHidden ? "danger" : "secondary"}>{t(`moderation.${moderationStatus}`)}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted">
        {awaitingReview
          ? t("reviewPendingHelp")
          : platformHidden
            ? t("moderationHidden")
            : t("moderationVisible")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          className="min-w-56 flex-1"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
          placeholder={awaitingReview ? t("reviewReason") : t("moderationReason")}
        />
        {awaitingReview ? <>
          <Button type="button" disabled={pending} onClick={() => review("approved")}>
            {pending ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <CheckCircle2 size={14} />}
            {t("approveRevision")}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => review("rejected")}>
            <RotateCcw size={14} />
            {t("returnRevision")}
          </Button>
        </> : (lifecycleStatus === "published" || platformHidden) && (
          <Button
            type="button"
            variant={platformHidden ? "primary" : "secondary"}
            disabled={pending}
            onClick={() => moderate(platformHidden ? "approved" : "hidden")}
          >
            {pending
              ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />
              : platformHidden
                ? <Eye size={14} />
                : <EyeOff size={14} />}
            {platformHidden ? t("restorePost") : t("hidePost")}
          </Button>
        )}
      </div>
      {feedback && (
        <p role={feedback.kind === "error" ? "alert" : "status"} className={`mt-2 text-xs ${feedback.kind === "error" ? "text-rose" : "text-leaf-deep"}`}>
          {feedback.kind === "error" ? t(`actionErrors.${feedback.code}`) : t("moderationSucceeded")}
        </p>
      )}
    </aside>
  );
}
