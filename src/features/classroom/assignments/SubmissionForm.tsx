"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SubmissionRecord } from "../types";

export function SubmissionForm({ assignmentId, mine }: { assignmentId: string; mine: SubmissionRecord | null }) {
  const t = useTranslations("classroom.assignments");
  const router = useRouter();
  const [text, setText] = useState(mine?.content.text ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl border border-line p-5">
      <h3 className="text-sm font-medium text-muted">{t("yourSubmission")}</h3>
      {mine?.gradedAt && (
        <div className="mt-3 rounded-xl bg-moon/20 px-4 py-3 text-sm">
          <p className="font-medium">{t("statusGraded", { score: mine.score ?? "—" })}</p>
          {mine.feedback && <p className="mt-1 text-muted">{mine.feedback}</p>}
        </div>
      )}
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t("submitPlaceholder")}
        rows={8}
        className="mt-3"
      />
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={pending || !text.trim()}
          onClick={() => startTransition(async () => {
            const { submitAssignment } = await import("../actions");
            await submitAssignment(assignmentId, text);
            router.refresh();
          })}
        >
          {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : t("submit")}
        </Button>
        {mine?.submittedAt && <p className="text-xs text-muted">{t("resubmitHint")}</p>}
      </div>
    </div>
  );
}
