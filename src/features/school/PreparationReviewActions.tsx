"use client";

import { Check, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { reviewSessionPreparationArtifactAction } from "./actions/classes";
import type { PrepArtifactKind } from "./session-preparation-artifacts";

export function PreparationReviewActions({
  sessionId,
  artifactKind,
}: {
  sessionId: string;
  artifactKind: PrepArtifactKind;
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [note, setNote] = useState("");
  const review = useAction(reviewSessionPreparationArtifactAction, {
    successMessage: t("prepReviewDecisionSaved"),
    errorMessage: {
      REVIEW_ALREADY_DECIDED: t("prepReviewAlreadyDecided"),
      REVIEW_NOTE_REQUIRED: t("prepReviewNoteRequired"),
      default: t("actionFailed"),
    },
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="mt-4 space-y-2 border-t border-line pt-3">
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        maxLength={1000}
        placeholder={t("prepReviewNotePlaceholder")}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={review.pending || !note.trim()}
          onClick={() => review.run({ sessionId, artifactKind, decision: "changes_requested", note })}
        >
          <RotateCcw size={14} />{t("prepReviewRequestChanges")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={review.pending}
          onClick={() => review.run({ sessionId, artifactKind, decision: "approved", note })}
        >
          <Check size={14} />{t("prepReviewApprove")}
        </Button>
      </div>
    </div>
  );
}
