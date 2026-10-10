"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { newId } from "@/lib/uuid";
import { saveAssessmentTopicAction } from "./assessment-rules-actions";
import { assessmentRuleError } from "./AssessmentRuleEditor";
import type { AssessmentRulesWorkspace, AssessmentTopicDefinition } from "./assessment-rules-contract";

export function AssessmentTopicEditor({ topic, onSaved, onClose, onPendingChange }: {
  topic: AssessmentTopicDefinition | null; onSaved: (data: AssessmentRulesWorkspace) => void; onClose: () => void;
  onPendingChange: (value: boolean) => void;
}) {
  const t = useTranslations("school.assessmentRules");
  const [draft, setDraft] = useState(() => ({ id: topic?.id ?? newId(), name: topic?.name ?? "", nameEn: topic?.nameEn ?? "",
    enabled: topic?.enabled ?? true, expectedUpdatedAt: topic?.updatedAt ?? null }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function save() {
    if (lock.current) return;
    lock.current = true; setPending(true); onPendingChange(true); setError("");
    try { const result = await saveAssessmentTopicAction(draft); if (result.ok) onSaved(result.data); else setError(assessmentRuleError(result.code)); }
    catch { setError("failed"); } finally { lock.current = false; setPending(false); onPendingChange(false); }
  }
  return <form className="space-y-3 py-2" onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); }
  }}>
    <fieldset disabled={pending} className="flex flex-wrap items-end gap-3">
      <Label className="grid gap-1">{t("topicName")}<Input value={draft.name} maxLength={80} required onChange={event => setDraft({ ...draft, name: event.target.value })} /></Label>
      <Label className="grid gap-1">{t("topicNameEn")}<Input value={draft.nameEn} maxLength={80} onChange={event => setDraft({ ...draft, nameEn: event.target.value })} /></Label>
      <Label className="flex min-h-9 items-center gap-2"><Checkbox checked={draft.enabled} onCheckedChange={value => setDraft({ ...draft, enabled: value === true })} />{t("enabled")}</Label>
    </fieldset>
    <p className="text-xs text-muted">{t("topicVisibility")}</p>
    {error && <p role="alert" className="text-sm text-rose">{t(error)}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={pending} onClick={onClose}>{t("close")}</Button><Button type="submit" disabled={pending}>{t(pending ? "saving" : "save")}</Button></div>
  </form>;
}
