"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ASSESSMENT_BANDS, ACTIVITY_ROUTES } from "./activity-workflow-contract";
import { saveAssessmentQuickEntryAction } from "./assessment-quick-entry-actions";
import { hasQuickAssessmentResult, type AssessmentQuickEntryValues } from "./assessment-quick-entry-contract";
import type { AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";

function initialValues(row: AssessmentWorkbenchRow): AssessmentQuickEntryValues {
  const previous = row.assessment?.resultSource !== "teacher" && !row.assessmentCompletedAt ? row.assessment : null;
  return row.quickEntry?.values ?? {
    assessmentBand: previous?.assessmentBand ?? null, score: previous?.score ?? null,
    strengths: previous?.strengths ?? "", focusAreas: previous?.focusAreas ?? "", parentConcerns: previous?.parentConcerns ?? "",
    teacherRecommendation: previous?.teacherRecommendation ?? "", recommendedClass: previous?.recommendedClass ?? "",
    route: row.route?.route ?? null,
  };
}

/** 快速登记独立保存来源与版本；逐题结果由专业入口维护。 */
export function AssessmentQuickEntry({ row, disabled, canRoute, onSaved, onSaveAndNext }: {
  row: AssessmentWorkbenchRow; disabled: boolean; canRoute: boolean;
  onSaved: (row: AssessmentWorkbenchRow) => void; onSaveAndNext?: () => void;
}) {
  const t = useTranslations("school.assessmentQuickEntry");
  const activityT = useTranslations("school.activities");
  const routeT = useTranslations("school.enrollmentWorkflow");
  const [draft, setDraft] = useState(() => ({ ...initialValues(row), route: canRoute ? initialValues(row).route : null }));
  const [saved, setSaved] = useState(() => JSON.stringify(draft));
  const [revision, setRevision] = useState(row.quickEntry?.revision ?? 0);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const composing = useRef(false);
  const dirty = JSON.stringify(draft) !== saved;
  const canGenerate = !row.teacherRequired && !row.assessmentCompletedAt && !row.quickEntry?.finalizedAt && hasQuickAssessmentResult(draft);
  const locked = disabled || pending;
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
  return <div data-assessment-quick-entry className="min-w-0 space-y-2"
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
    <p className="text-xs leading-5 text-muted">{t(row.assessmentCompletedAt ? "teacherResultPreserved" : row.teacherRequired ? "requiredHint" : "optionalHint")}</p>
    <FollowupEntryFields id={`assessment-quick-${row.id}`} note={draft.parentConcerns} noteLabel={activityT("parentConcerns")}
      onNoteChange={(value) => setDraft((current) => ({ ...current, parentConcerns: value }))}
      disabled={disabled} readOnly={disabled} pending={pending} saveDisabled={!dirty && !canGenerate}
      onSave={(advance) => { void save(advance); }} canAdvance={Boolean(onSaveAndNext)}
      hint={disabled ? t("readonly") : dirty ? t("draftHint") : row.quickEntry ? t(row.quickEntry.finalizedAt ? "generatedHint" : "recordedHint") : undefined}>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="w-32 space-y-1.5 text-xs text-muted"><span>{activityT("assessmentBand")}</span>
          <FollowupChoice value={draft.assessmentBand ?? "none"} label={activityT("assessmentBand")} disabled={locked}
            options={[{ value: "none", label: activityT("notEntered") },
              ...(draft.assessmentBand === "below_a" ? [{ value: "below_a", label: activityT("band_below_a") }] : []),
              ...ASSESSMENT_BANDS.map((band) => ({ value: band, label: activityT(`band_${band}`) }))]}
            onValueChange={(value) => setDraft((current) => ({ ...current, assessmentBand: value === "none" ? null : value as AssessmentQuickEntryValues["assessmentBand"] }))} />
        </label>
        <label className="w-24 space-y-1.5 text-xs text-muted"><span>{activityT("scoreShort")}</span>
          <Input type="number" min={0} max={10000} value={draft.score ?? ""} disabled={locked} aria-label={activityT("scoreShort")} className="h-8 text-xs"
            onChange={(event) => setDraft((current) => ({ ...current, score: event.target.value === "" ? null : Number(event.target.value) }))} />
        </label>
        <label className="min-w-40 flex-1 space-y-1.5 text-xs text-muted"><span>{activityT("recommendedClass")}</span>
          <Input value={draft.recommendedClass} maxLength={200} disabled={locked} aria-label={activityT("recommendedClass")} className="h-8 text-xs"
            onChange={(event) => setDraft((current) => ({ ...current, recommendedClass: event.target.value }))} />
        </label>
        {canRoute ? <label className="min-w-48 flex-1 space-y-1.5 text-xs text-muted"><span>{routeT("nextStep")}</span>
          <FollowupChoice value={draft.route ?? "none"} label={routeT("nextStep")} disabled={locked}
            options={[{ value: "none", label: t("routeUnchanged") }, ...ACTIVITY_ROUTES.filter((route) => route !== "enrollment_pending" || draft.route === route)
              .map((route) => ({ value: route, label: routeT(`route_${route}`) }))]}
            onValueChange={(value) => setDraft((current) => ({ ...current, route: value === "none" ? null : value as AssessmentQuickEntryValues["route"] }))} />
        </label> : null}
      </div>
      <div className="grid min-w-0 gap-3 @[36rem]/followup-entry:grid-cols-2">
        {(["strengths", "focusAreas", "teacherRecommendation"] as const).map((field) => <label key={field} className="block min-w-0 space-y-1.5 text-xs text-muted">
          <span>{field === "teacherRecommendation" ? t("recommendation") : activityT(field)}</span>
          <Textarea rows={2} maxLength={2000} value={draft[field]} disabled={locked} aria-label={activityT(field)} className="min-h-20 resize-y text-xs"
            onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
        </label>)}
      </div>
    </FollowupEntryFields>
  </div>;
}
