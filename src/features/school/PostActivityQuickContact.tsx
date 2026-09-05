"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { newId } from "@/lib/uuid";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { savePostActivityContactAction } from "./enrollment-workflow-actions";
import { type ActivityEnrollmentContext } from "./enrollment-workflow-contract";

export function PostActivityQuickContact({ row, onSaved, onDetails, expanded, detailsId }: {
  row: ActivityEnrollmentContext;
  onSaved: (row: ActivityEnrollmentContext) => void;
  onDetails: () => void;
  expanded?: boolean;
  detailsId?: string;
}) {
  const t = useTranslations("school.enrollmentWorkflow");
  const [outcome, setOutcome] = useState<"connected" | "unreachable">("connected");
  const [note, setNote] = useState("");
  const requestId = useRef(newId());
  const run = useAction(savePostActivityContactAction, { successMessage: t("contactSaved"), errorMessage: { default: t("errorSave") }, onSuccess: (context) => {
    if (context) onSaved(context);
    setNote(""); requestId.current = newId();
  } });
  const disabled = !row.canContact || Boolean(row.enrollmentId) || row.route === "closed";
  const submit = () => {
    if (disabled || run.pending) return;
    run.run({ registrationId: row.registrationId, requestId: requestId.current, channel: row.contacts[0]?.channel ?? "phone", outcome,
      route: row.route ?? "continue_follow_up", note, nextContactAt: row.contacts[0]?.nextContactAt ?? null });
  };
  return <div className="flex items-center gap-1.5" onKeyDown={(event) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.repeat) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); }
    if (!event.ctrlKey && !event.metaKey && !(event.target as HTMLElement).closest("input,textarea,[role='combobox']")) {
      if (event.key === "1") { event.preventDefault(); setOutcome("connected"); }
      if (event.key === "2") { event.preventDefault(); setOutcome("unreachable"); }
    }
  }}>
    <FollowupChoice label={t("outcome")} value={outcome} onValueChange={(value) => setOutcome(value as typeof outcome)} disabled={disabled || run.pending}
      className="shrink-0 flex-nowrap" options={[{ value: "connected", label: `${t("connected")} · 1`, tone: "healthy" }, { value: "unreachable", label: `${t("unreachable")} · 2`, tone: "unhealthy" }]} />
    <Input value={note} onChange={(event) => setNote(event.target.value)} aria-label={t("contactNote")} placeholder={t("contactPlaceholder")} maxLength={2000} disabled={disabled || run.pending} className="h-8 min-w-0 flex-1 text-xs" />
    <Button size="sm" variant="secondary" className="h-8 shrink-0 px-2" onClick={submit} disabled={disabled || run.pending} aria-label={t("saveContact")} title={`${t("saveContact")} · Ctrl ↵`} aria-keyshortcuts="Control+Enter Meta+Enter">{run.pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}</Button>
    <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2" onClick={onDetails} aria-label={t("continueContact")} aria-expanded={expanded} aria-controls={detailsId}>{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button>
  </div>;
}
