"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { saveAssessmentQuickEntryAction } from "./assessment-quick-entry-actions";
import { hasQuickAssessmentResult, type AssessmentQuickEntryValues } from "./assessment-quick-entry-contract";
import type { AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { AssessmentEntrySurface, AssessmentRegistrationFields, type AssessmentEntryParts } from "./AssessmentRegistrationFields";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";

function initialValues(row: AssessmentWorkbenchRow): AssessmentQuickEntryValues {
  const previous = row.assessment?.resultSource !== "teacher" && !row.assessmentCompletedAt ? row.assessment : null;
  return row.quickEntry?.values ?? {
    assessmentBand: previous?.assessmentBand ?? null, score: previous?.score ?? null,
    strengths: previous?.strengths ?? "", focusAreas: previous?.focusAreas ?? "", parentConcerns: row.assessment?.parentConcerns ?? "",
    teacherRecommendation: previous?.teacherRecommendation ?? "", recommendedClass: previous?.recommendedClass ?? "",
    route: row.route?.route ?? null,
  };
}

/** 快速登记独立保存来源与版本；逐题结果由专业入口维护。 */
export function AssessmentQuickEntry({ row, disabled, canRoute, onSaved, onSaveAndNext, render }: {
  row: AssessmentWorkbenchRow; disabled: boolean; canRoute: boolean;
  onSaved: (row: AssessmentWorkbenchRow) => void; onSaveAndNext?: () => void;
  render?: (entry: AssessmentEntryParts) => ReactNode;
}) {
  const t = useTranslations("school.assessmentQuickEntry");
  const activityT = useTranslations("school.activities");
  const [draft, setDraft] = useState(() => ({ ...initialValues(row), route: canRoute ? initialValues(row).route : null }));
  const [saved, setSaved] = useState(() => JSON.stringify(draft));
  const [revision, setRevision] = useState(row.quickEntry?.revision ?? 0);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const composing = useRef(false);
  const dirty = JSON.stringify(draft) !== saved;
  const canGenerate = !row.teacherRequired && !row.assessmentCompletedAt && !row.quickEntry?.finalizedAt && hasQuickAssessmentResult(draft);
  const locked = disabled || pending;
  const teacherResult = row.assessment && (row.assessment.resultSource === "teacher" || Boolean(row.assessmentCompletedAt && row.assessment.resultSource !== "quick_entry"))
    ? row.assessment : null;
  const save = async (advance: boolean) => {
    if (disabled || saving.current || composing.current || (!dirty && !canGenerate)) return;
    saving.current = true; setPending(true);
    try {
      const result = await saveAssessmentQuickEntryAction({
        registrationId: row.registrationId, invitationId: row.registrationId ? null : row.invitationId,
        values: draft, expectedRevision: revision,
      });
      if (!result.ok) { toast.error(t(result.code === "ASSESSMENT_ENTRY_CONFLICT" ? "conflict" : "saveFailed")); return; }
      const next = result.data;
      setRevision(next.quickEntry.revision); setSaved(JSON.stringify(draft));
      onSaved({ ...row, registrationId: next.registrationId, activityId: next.activityId,
        quickEntry: next.quickEntry, teacherRequired: next.teacherRequired, participationStatus: next.participationStatus,
        assessment: next.assessment ? { ...next.assessment, recordedByName: next.assessment.resultSource === "quick_entry"
          ? next.quickEntry.recordedByName : row.assessment?.recordedByName } : null,
        route: draft.route ? { id: row.route?.id ?? next.registrationId, route: draft.route, note: draft.parentConcerns, updatedAt: next.quickEntry.updatedAt } : row.route,
        entryActors: [{ id: next.quickEntry.recordedBy, name: next.quickEntry.recordedByName, kind: "quick_entry", recordedAt: next.quickEntry.updatedAt },
          ...(row.entryActors ?? []).filter((actor) => actor.kind !== "quick_entry")],
        updatedAt: next.quickEntry.updatedAt,
      });
      toast.success(t(next.quickEntry.finalizedAt ? "resultGenerated" : "saved"));
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
      if (advance) onSaveAndNext?.();
    } catch { toast.error(t("saveFailed")); }
    finally { saving.current = false; setPending(false); }
  };
  const entry: AssessmentEntryParts = {
    dirty,
    followup: {
      id: `assessment-quick-${row.id}`, note: draft.parentConcerns, noteLabel: activityT("parentConcerns"),
      onNoteChange: (value) => setDraft((current) => ({ ...current, parentConcerns: value })),
      disabled, readOnly: disabled, pending, saveDisabled: !dirty && !canGenerate,
      onSave: (advance) => { void save(advance); }, canAdvance: Boolean(onSaveAndNext),
      hint: disabled ? t("readonly") : dirty ? t("draftHint") : row.quickEntry ? t(row.quickEntry.finalizedAt ? "generatedHint" : "recordedHint") : undefined,
    },
    tags: <AssessmentRegistrationFields value={teacherResult ?? draft} disabled={locked || Boolean(teacherResult)}
      onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
      routing={canRoute ? { value: draft.route, onChange: (route) => setDraft((current) => ({ ...current, route })) } : undefined} />,
    fields: <>
      <p className="text-xs leading-5 text-muted">{t(row.assessmentCompletedAt ? "teacherResultPreserved" : row.teacherRequired ? "requiredHint" : "optionalHint")}</p>
      <div className="grid min-w-0 gap-3 @[36rem]/followup-entry:grid-cols-2">
        {(["strengths", "focusAreas", "teacherRecommendation"] as const).map((field) => <label key={field} className="block min-w-0 space-y-1.5 text-xs text-muted">
          <span>{field === "teacherRecommendation" ? t("recommendation") : activityT(field)}</span>
          <Textarea rows={2} maxLength={2000} value={draft[field]} disabled={locked} aria-label={activityT(field)} className="min-h-20 resize-y text-xs"
            onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
        </label>)}
      </div>
    </>,
  };
  return <div data-assessment-quick-entry className="min-w-0"
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
    {render ? <AssessmentEntrySurface entry={entry} render={render} /> : <FollowupEntryFields {...entry.followup}>{entry.tags}{entry.fields}</FollowupEntryFields>}
  </div>;
}
