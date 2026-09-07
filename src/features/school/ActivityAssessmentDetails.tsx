"use client";

import { createContext, useContext, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { saveActivityAssessmentAction, type ActivityAssessmentInput } from "./activity-actions";
import { savePublicClassParticipantRecordAction } from "./public-class-actions";
import type { AssessmentWorkbenchPublicClassRecord, AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { AssessmentRegistrationFields } from "./AssessmentRegistrationFields";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";

interface EntryProps {
  row: AssessmentWorkbenchRow;
  disabled: boolean;
  onSaved: (row: AssessmentWorkbenchRow) => void;
  onSaveAndNext?: () => void;
}

interface AssessmentDraftState {
  aggregate: ActivityAssessmentInput;
  setAggregate: Dispatch<SetStateAction<ActivityAssessmentInput>>;
  publicClass: AssessmentWorkbenchPublicClassRecord | null;
  setPublicClass: Dispatch<SetStateAction<AssessmentWorkbenchPublicClassRecord | null>>;
  savedAggregate: string;
  setSavedAggregate: Dispatch<SetStateAction<string>>;
  savedPublicClass: string;
  setSavedPublicClass: Dispatch<SetStateAction<string>>;
  savingRef: { current: boolean };
  composingRef: { current: boolean };
  pending: boolean;
  setPending: Dispatch<SetStateAction<boolean>>;
}

const AssessmentDraftContext = createContext<AssessmentDraftState | null>(null);

/** 主行和展开行共用同一份草稿与保存状态，避免相互覆盖。 */
export function ActivityAssessmentDraftProvider({ row, children }: { row: AssessmentWorkbenchRow; children: ReactNode }) {
  const [aggregate, setAggregate] = useState<ActivityAssessmentInput>(() => ({
    registrationId: row.registrationId!,
    assessmentBand: row.assessment?.assessmentBand ?? null,
    score: row.assessment?.score ?? null,
    strengths: row.assessment?.strengths ?? "",
    focusAreas: row.assessment?.focusAreas ?? "",
    parentConcerns: row.assessment?.parentConcerns ?? "",
    teacherRecommendation: row.assessment?.teacherRecommendation ?? "",
    recommendedClass: row.assessment?.recommendedClass ?? "",
  }));
  const [publicClass, setPublicClass] = useState(row.publicClassRecord);
  const [savedAggregate, setSavedAggregate] = useState(() => JSON.stringify(aggregate));
  const [savedPublicClass, setSavedPublicClass] = useState(() => JSON.stringify(publicClass));
  const savingRef = useRef(false);
  const composingRef = useRef(false);
  const [pending, setPending] = useState(false);
  return <AssessmentDraftContext.Provider value={{ aggregate, setAggregate, publicClass, setPublicClass, savedAggregate, setSavedAggregate, savedPublicClass, setSavedPublicClass, savingRef, composingRef, pending, setPending }}>{children}</AssessmentDraftContext.Provider>;
}

function useAssessmentDraft() {
  const state = useContext(AssessmentDraftContext);
  if (!state) throw new Error("ActivityAssessmentDetails requires ActivityAssessmentDraftProvider");
  return state;
}

export function ActivityAssessmentDetails(props: EntryProps) {
  return props.row.publicClassRecord
    ? <PublicClassAssessmentEntry {...props} />
    : <ActivityAssessmentEntry {...props} disabled={props.disabled || !props.row.studentId} />;
}

function ActivityAssessmentEntry({ row, disabled, onSaved, onSaveAndNext }: EntryProps) {
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
  return <div data-assessment-entry="activity" className="min-w-0"
    onClick={(event) => event.stopPropagation()}
    onCompositionStart={() => { composingRef.current = true; }}
    onCompositionEnd={() => { composingRef.current = false; }}
    >
    <FollowupEntryFields id={`assessment-entry-${row.id}`} note={draft.parentConcerns} noteLabel={t("parentConcerns")}
      onNoteChange={(value) => setDraft((current) => ({ ...current, parentConcerns: value }))}
      disabled={disabled} readOnly={disabled} pending={pending} saveDisabled={!dirty}
      onSave={(advance) => { void save(advance); }} canAdvance={Boolean(onSaveAndNext)}
      hint={disabled ? entryT("readonlyHint") : dirty ? entryT("draftHint") : hasSaved ? entryT("savedInSession") : undefined}>
    <AssessmentRegistrationFields value={draft} disabled={locked}
      onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />
    <div className="grid min-w-0 gap-3 @[36rem]/followup-entry:grid-cols-2">
      {(["strengths", "focusAreas", "teacherRecommendation"] as const).map((field) => <label key={field} className="block min-w-0 space-y-1.5 text-xs text-muted">
        <span>{t(field)}</span>
        <Textarea rows={2} maxLength={2000} value={draft[field]} disabled={locked} aria-label={t(field)} className="min-h-20 resize-y text-xs"
          onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
      </label>)}
    </div>
    </FollowupEntryFields>
  </div>;
}

function PublicClassAssessmentEntry({ row, disabled, onSaved, onSaveAndNext }: EntryProps) {
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
  return <div data-assessment-entry="public-class" className="min-w-0" onClick={(event) => event.stopPropagation()}
    onCompositionStart={() => { composingRef.current = true; }}
    onCompositionEnd={() => { composingRef.current = false; }}
    >
    <FollowupEntryFields id={`assessment-entry-${row.id}`} note={draft.parentFeedback} noteLabel={t("parentFeedback")} noteMaxLength={3000}
      onNoteChange={(value) => setDraft((current) => ({ ...current, parentFeedback: value }))}
      disabled={disabled} readOnly={disabled} pending={pending} saveDisabled={!dirty}
      onSave={(advance) => { void save(advance); }} canAdvance={Boolean(onSaveAndNext)}
      hint={disabled ? entryT("readonlyHint") : dirty ? entryT("draftHint") : hasSaved ? entryT("savedInSession") : undefined}>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
      {(["studentPresence", "guardianPresence"] as const).filter((field) => draft[field] !== "not_applicable").map((field) => <label key={field} className="block w-40 space-y-1 text-xs text-muted">
        <span>{t(field === "studentPresence" ? "studentAttendance" : "guardianAttendance")}</span>
        <FollowupChoice value={draft[field]} disabled={locked} label={t(field === "studentPresence" ? "studentAttendance" : "guardianAttendance")}
          options={(["expected", "attended", "late", "absent"] as const).map((value) => ({
            value, label: t(`presence_${value}`), tone: value === "attended" ? "healthy" : value === "absent" ? "unhealthy" : value === "late" ? "attention" : "neutral",
          }))}
          onValueChange={(value) => setDraft((current) => ({ ...current, [field]: value }))} />
      </label>)}
      </div>
      <div className="grid min-w-0 gap-3 @[36rem]/followup-entry:grid-cols-2">
      {(["assessmentSummary", "learningObservation", "recommendation"] as const).map((field) => <label key={field} className="block min-w-0 space-y-1.5 text-xs text-muted">
        <span>{t(field)}</span>
        <Textarea rows={2} maxLength={3000} value={draft[field]} disabled={locked} aria-label={t(field)} className="min-h-20 resize-y text-xs"
          onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
      </label>)}
      </div>
    </FollowupEntryFields>
  </div>;
}
