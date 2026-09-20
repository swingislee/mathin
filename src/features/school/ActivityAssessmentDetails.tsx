"use client";

import { useState, type ReactNode } from "react";
import { useAssessmentDraft } from "./ActivityAssessmentDraftProvider";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserRound, UsersRound } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { saveActivityAssessmentAction } from "./activity-actions";
import { savePublicClassParticipantRecordAction } from "./public-class-actions";
import type { AssessmentWorkbenchPublicClassRecord, AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { AssessmentEntrySurface, AssessmentRegistrationFields, type AssessmentEntryParts } from "./AssessmentRegistrationFields";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { FollowupFieldIcon } from "./FollowupFieldIcon";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";

interface EntryProps {
  row: AssessmentWorkbenchRow;
  disabled: boolean;
  onSaved: (row: AssessmentWorkbenchRow) => void;
  onSaveAndNext?: () => void;
  render?: (entry: AssessmentEntryParts) => ReactNode;
}

export { ActivityAssessmentDraftProvider } from "./ActivityAssessmentDraftProvider";

export function ActivityAssessmentDetails(props: EntryProps) {
  return props.row.publicClassRecord
    ? <PublicClassAssessmentEntry {...props} />
    : <ActivityAssessmentEntry {...props} disabled={props.disabled || !props.row.studentId} />;
}

function ActivityAssessmentEntry({ row, disabled, onSaved, onSaveAndNext, render }: EntryProps) {
  const t = useTranslations("school.activities");
  const entryT = useTranslations("school.supportAssessment");
  const { aggregate: draft, setAggregate: setDraft, pending, setPending, savedAggregate, setSavedAggregate, savingRef, composingRef } = useAssessmentDraft();
  const [hasSaved, setHasSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== savedAggregate;
  const save = async (advance: boolean) => {
    if (disabled || savingRef.current || composingRef.current || !row.registrationId || !dirty) return;
    const next = draft;
    savingRef.current = true;
    setPending(true);
    try {
      const result = await saveActivityAssessmentAction(next);
      if (!result.ok) { toast.error(t("assessmentAutosaveFailed")); return; }
      setSavedAggregate(JSON.stringify(next));
      setHasSaved(true);
      const updatedAt = new Date().toISOString();
      onSaved({ ...row, participationStatus: "attended", updatedAt, assessment: {
        ...next,
        id: row.assessment?.id ?? row.registrationId,
        teacherObservation: row.assessment?.teacherObservation ?? "",
        updatedAt,
      } });
      toast.success(t("autosave_saved"));
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
      if (advance) onSaveAndNext?.();
    } catch { toast.error(t("assessmentAutosaveFailed")); }
    finally { savingRef.current = false; setPending(false); }
  };
  const locked = disabled || pending;
  const entry: AssessmentEntryParts = {
    dirty,
    followup: {
      id: `assessment-entry-${row.id}`, note: draft.parentConcerns, noteLabel: t("parentConcerns"),
      onNoteChange: (value) => setDraft((current) => ({ ...current, parentConcerns: value })),
      disabled, readOnly: disabled, pending, saveDisabled: !dirty,
      onSave: (advance) => { void save(advance); }, canAdvance: Boolean(onSaveAndNext),
      hint: disabled ? entryT("readonlyHint") : dirty ? entryT("draftHint") : hasSaved ? entryT("savedInSession") : undefined,
    },
    tags: <AssessmentRegistrationFields value={draft} disabled={locked}
      onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />,
    fields: <div className="grid min-w-0 gap-3 @[36rem]/followup-entry:grid-cols-2">
      {(["strengths", "focusAreas", "teacherRecommendation"] as const).map((field) => <label key={field} className="block min-w-0 space-y-1.5 text-xs text-muted">
        <span>{t(field)}</span>
        <Textarea rows={2} maxLength={2000} value={draft[field]} disabled={locked} aria-label={t(field)} className="min-h-20 resize-y text-xs"
          onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
      </label>)}
    </div>,
  };
  return <div data-assessment-entry="activity" className="min-w-0" onClick={(event) => event.stopPropagation()}
    onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}>
    {render ? <AssessmentEntrySurface entry={entry} render={render} /> : <FollowupEntryFields {...entry.followup}>{entry.tags}{entry.fields}</FollowupEntryFields>}
  </div>;
}

function PublicClassAssessmentEntry({ row, disabled, onSaved, onSaveAndNext, render }: EntryProps) {
  const t = useTranslations("school.publicClass");
  const activityT = useTranslations("school.activities");
  const entryT = useTranslations("school.supportAssessment");
  const { publicClass, setPublicClass, pending, setPending, savedPublicClass, setSavedPublicClass, savingRef, composingRef } = useAssessmentDraft();
  const [hasSaved, setHasSaved] = useState(false);
  const draft = publicClass!;
  const setDraft = (update: (current: AssessmentWorkbenchPublicClassRecord) => AssessmentWorkbenchPublicClassRecord) => setPublicClass((current) => current ? update(current) : current);
  const dirty = JSON.stringify(draft) !== savedPublicClass;
  const save = async (advance: boolean) => {
    if (disabled || savingRef.current || composingRef.current || !row.registrationId || !dirty) return;
    savingRef.current = true;
    setPending(true);
    try {
      const result = await savePublicClassParticipantRecordAction({
        segmentId: draft.segmentId,
        registrationId: row.registrationId,
        studentPresence: draft.studentPresence,
        guardianPresence: draft.guardianPresence,
        learningObservation: draft.learningObservation,
        assessmentSummary: draft.assessmentSummary,
        parentFeedback: draft.parentFeedback,
        recommendation: draft.recommendation,
      });
      if (!result.ok) { toast.error(activityT("actionFailed")); return; }
      setSavedPublicClass(JSON.stringify(draft));
      setHasSaved(true);
      const updatedAt = new Date().toISOString();
      const completed = Boolean(draft.assessmentSummary.trim());
      onSaved({ ...row, updatedAt, publicClassRecord: { ...draft, id: result.data.recordId },
        assessmentCompletedAt: completed ? updatedAt : null,
        assessment: completed ? {
          id: result.data.recordId, assessmentBand: null, score: null, strengths: draft.learningObservation,
          focusAreas: "", parentConcerns: draft.parentFeedback, teacherRecommendation: draft.recommendation,
          recommendedClass: "", teacherObservation: draft.assessmentSummary, updatedAt,
        } : null,
      });
      toast.success(t("recordSaved"));
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
      if (advance) onSaveAndNext?.();
    } catch { toast.error(activityT("actionFailed")); }
    finally { savingRef.current = false; setPending(false); }
  };
  const locked = disabled || pending;
  const entry: AssessmentEntryParts = {
    dirty,
    followup: {
      id: `assessment-entry-${row.id}`, note: draft.parentFeedback, noteLabel: t("parentFeedback"), noteMaxLength: 3000,
      onNoteChange: (value) => setDraft((current) => ({ ...current, parentFeedback: value })),
      disabled, readOnly: disabled, pending, saveDisabled: !dirty,
      onSave: (advance) => { void save(advance); }, canAdvance: Boolean(onSaveAndNext),
      hint: disabled ? entryT("readonlyHint") : dirty ? entryT("draftHint") : hasSaved ? entryT("savedInSession") : undefined,
    },
    tags: <div className="flex min-w-0 flex-wrap items-end gap-3">
      {(["studentPresence", "guardianPresence"] as const).filter((field) => draft[field] !== "not_applicable").map((field) => <div key={field} data-assessment-field={field} className="flex min-h-8 min-w-0 items-center gap-2">
        <FollowupFieldIcon icon={field === "studentPresence" ? UserRound : UsersRound} label={t(field === "studentPresence" ? "studentAttendance" : "guardianAttendance")}
          className={field === "studentPresence" ? "fill-leaf/50 text-leaf-deep" : "fill-cheek/60 text-crater"} />
        <FollowupChoice value={draft[field]} disabled={locked} label={t(field === "studentPresence" ? "studentAttendance" : "guardianAttendance")}
          className="w-32 min-h-8 py-1"
          options={(["expected", "attended", "late", "absent"] as const).map((value) => ({
            value, label: t(`presence_${value}`), tone: value === "attended" ? "healthy" : value === "absent" ? "unhealthy" : value === "late" ? "attention" : "neutral",
          }))}
          onValueChange={(value) => setDraft((current) => ({ ...current, [field]: value }))} />
      </div>)}
      </div>,
    fields: <div className="grid min-w-0 gap-3 @[36rem]/followup-entry:grid-cols-2">
      {(["assessmentSummary", "learningObservation", "recommendation"] as const).map((field) => <label key={field} className="block min-w-0 space-y-1.5 text-xs text-muted">
        <span>{t(field)}</span>
        <Textarea rows={2} maxLength={3000} value={draft[field]} disabled={locked} aria-label={t(field)} className="min-h-20 resize-y text-xs"
          onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
      </label>)}
      </div>,
  };
  return <div data-assessment-entry="public-class" className="min-w-0" onClick={(event) => event.stopPropagation()}
    onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}>
    {render ? <AssessmentEntrySurface entry={entry} render={render} /> : <FollowupEntryFields {...entry.followup}>{entry.tags}{entry.fields}</FollowupEntryFields>}
  </div>;
}
