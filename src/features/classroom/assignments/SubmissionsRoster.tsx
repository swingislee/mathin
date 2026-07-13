"use client";

import { Input } from "@/components/ui/input";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, LoaderCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SubmissionRecord } from "../types";

function SubmissionRow({ row }: { row: SubmissionRecord }) {
  const t = useTranslations("classroom.assignments");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(row.score === null ? "" : String(row.score));
  const [feedback, setFeedback] = useState(row.feedback);
  const [pending, startTransition] = useTransition();
  const submitted = Boolean(row.id);

  const statusLabel = !submitted
    ? t("statusNotSubmitted")
    : row.gradedAt
      ? t("statusGraded", { score: row.score ?? "—" })
      : t("statusSubmitted");

  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => submitted && setOpen((value) => !value)}
        disabled={!submitted}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors",
          submitted ? "hover:bg-moon/20" : "cursor-default opacity-60",
        )}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{row.displayName || t("anonymous")}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs",
            row.gradedAt ? "bg-leaf/15 text-leaf-deep" : submitted ? "bg-moon/40 text-ink" : "bg-line/50 text-muted",
          )}
        >
          {statusLabel}
        </span>
        {submitted && (open ? <ChevronUp size={15} className="shrink-0 text-muted" /> : <ChevronDown size={15} className="shrink-0 text-muted" />)}
      </button>
      {open && submitted && (
        <div className="space-y-3 px-4 pb-4">
          <p className="whitespace-pre-wrap rounded-xl bg-moon/15 p-3 text-sm">{row.content.text}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted">
              {t("scoreLabel")}
              <Input
                type="number"
                min={0}
                max={100}
                value={score}
                onChange={(event) => setScore(event.target.value)}
                className="mt-1 block w-24 rounded-lg border border-line bg-transparent px-2 py-1 text-sm outline-none focus:border-ink/40"
              />
            </label>
            <div className="min-w-0 flex-1">
              <label className="text-xs text-muted">{t("feedbackLabel")}</label>
              <Textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                rows={2}
                className="mt-1"
              />
            </div>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => startTransition(async () => {
                const { gradeSubmission } = await import("../actions");
                const parsed = score.trim() === "" ? null : Number(score);
                await gradeSubmission(row.id, parsed === null || Number.isNaN(parsed) ? null : parsed, feedback);
                router.refresh();
              })}
            >
              {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : t("gradeSave")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function SubmissionsRoster({ rows }: { rows: SubmissionRecord[] }) {
  const t = useTranslations("classroom.assignments");
  return (
    <div className="rounded-2xl border border-line">
      <p className="border-b border-line px-4 py-2.5 text-sm font-medium text-muted">{t("rosterTitle")}</p>
      <ul>
        {rows.map((row) => <SubmissionRow key={row.userId} row={row} />)}
      </ul>
    </div>
  );
}
