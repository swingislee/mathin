"use client";

import { createContext, useContext, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveActivityAssessmentAction, type ActivityAssessmentInput } from "./activity-actions";
import { savePublicClassParticipantRecordAction } from "./public-class-actions";
import { ASSESSMENT_BANDS, type StoredAssessmentBand } from "./activity-workflow-contract";
import type { AssessmentWorkbenchPublicClassRecord, AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { FollowupChoice, type FollowupTone } from "./dashboard-page/FollowupChoice";

interface EntryProps {
  row: AssessmentWorkbenchRow;
  disabled: boolean;
  onSaved: (row: AssessmentWorkbenchRow) => void;
  compact?: boolean;
}

interface AssessmentDraftState {
  aggregate: ActivityAssessmentInput;
  setAggregate: Dispatch<SetStateAction<ActivityAssessmentInput>>;
  publicClass: AssessmentWorkbenchPublicClassRecord | null;
  setPublicClass: Dispatch<SetStateAction<AssessmentWorkbenchPublicClassRecord | null>>;
  savedAggregateRef: { current: string };
  savedPublicClassRef: { current: string };
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
  const savedAggregateRef = useRef(JSON.stringify(aggregate));
  const savedPublicClassRef = useRef(JSON.stringify(publicClass));
  const savingRef = useRef(false);
  const composingRef = useRef(false);
  const [pending, setPending] = useState(false);
  return <AssessmentDraftContext.Provider value={{ aggregate, setAggregate, publicClass, setPublicClass, savedAggregateRef, savedPublicClassRef, savingRef, composingRef, pending, setPending }}>{children}</AssessmentDraftContext.Provider>;
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

function bandTone(band: string): FollowupTone {
  if (band === "x_plus" || band === "below_a") return "unhealthy";
  if (band === "g_plus") return "attention";
  return "healthy";
}

function ActivityAssessmentEntry({ row, disabled, onSaved, compact }: EntryProps) {
  const t = useTranslations("school.activities");
  const { aggregate: draft, setAggregate: setDraft, pending, setPending, savedAggregateRef: savedRef, savingRef, composingRef } = useAssessmentDraft();
  const save = async (next = draft) => {
    if (disabled || savingRef.current || composingRef.current || !row.registrationId || JSON.stringify(next) === savedRef.current) return;
    savingRef.current = true;
    setPending(true);
    try {
      const result = await saveActivityAssessmentAction(next);
      if (!result.ok) { toast.error(t("assessmentAutosaveFailed")); return; }
      savedRef.current = JSON.stringify(next);
      const updatedAt = new Date().toISOString();
      onSaved({ ...row, participationStatus: "attended", updatedAt, assessment: {
        ...next,
        id: row.assessment?.id ?? row.registrationId,
        teacherObservation: row.assessment?.teacherObservation ?? "",
        updatedAt,
      } });
      toast.success(t("autosave_saved"));
    } catch { toast.error(t("assessmentAutosaveFailed")); }
    finally { savingRef.current = false; setPending(false); }
  };
  const locked = disabled || pending;
  return <form className={compact ? "flex min-w-0 items-center gap-1.5" : "grid min-w-0 grid-cols-2 items-start gap-3 xl:grid-cols-4"}
    onClick={(event) => event.stopPropagation()}
    onCompositionStart={() => { composingRef.current = true; }}
    onCompositionEnd={() => { composingRef.current = false; }}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || composingRef.current) return;
      if (event.repeat) { if (event.key === "Enter") event.preventDefault(); return; }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); }
    }}>
    <div className={compact ? "contents" : "col-span-full flex min-w-0 flex-wrap items-end gap-3"}>
    <div className={compact ? "contents" : "w-32 shrink-0 space-y-1 text-xs text-muted"}>
    {!compact ? <span>{t("assessmentBand")}</span> : null}
    <FollowupChoice value={draft.assessmentBand ?? "none"} label={t("assessmentBand")} disabled={locked}
      className="w-28 shrink-0"
      options={[
        { value: "none", label: t("notEntered"), tone: "neutral" },
        ...(draft.assessmentBand === "below_a" ? [{ value: "below_a", label: t("band_below_a"), tone: "unhealthy" as const }] : []),
        ...ASSESSMENT_BANDS.map((band) => ({ value: band, label: t(`band_${band}`), tone: bandTone(band) })),
      ]}
      onValueChange={(value) => {
        const next = { ...draft, assessmentBand: value === "none" ? null : value as StoredAssessmentBand };
        setDraft(next);
        if (compact) void save(next);
      }} /></div>
    <label className={compact ? "contents" : "w-24 shrink-0 space-y-1 text-xs text-muted"}>
    {!compact ? <span>{t("scoreShort")}</span> : null}
    <Input aria-label={t("scoreShort")} type="number" min={0} max={10000} value={draft.score ?? ""} disabled={locked}
      placeholder={t("scoreShort")} className={compact ? "h-8 min-w-0 w-20 text-xs" : "h-8 text-xs"}
      onChange={(event) => setDraft((current) => ({ ...current, score: event.target.value === "" ? null : Number(event.target.value) }))}
      onBlur={() => { if (compact) void save(); }} /></label>
    {!compact ? <>
      <label className="min-w-40 flex-1 space-y-1 text-xs text-muted"><span>{t("recommendedClass")}</span>
        <Input value={draft.recommendedClass} maxLength={200} disabled={locked} aria-label={t("recommendedClass")} className="h-8 text-xs"
          onChange={(event) => setDraft((current) => ({ ...current, recommendedClass: event.target.value }))} />
      </label>
      <Button type="submit" disabled={locked} size="sm" className="h-8 shrink-0" aria-keyshortcuts="Control+Enter Meta+Enter">
        {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{t("save")} <kbd className="text-[10px] opacity-70">Ctrl ↵</kbd>
      </Button>
    </> : null}
    </div>
    {!compact ? <>
      {(["strengths", "focusAreas", "parentConcerns", "teacherRecommendation"] as const).map((field) => <label key={field} className="block min-w-0 space-y-1 text-xs text-muted">
        <span>{t(field)}</span>
        <Textarea rows={2} maxLength={2000} value={draft[field]} disabled={locked} aria-label={t(field)} className="min-h-20 resize-y text-xs"
          onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
      </label>)}
    </> : null}
  </form>;
}

function PublicClassAssessmentEntry({ row, disabled, onSaved, compact }: EntryProps) {
  const t = useTranslations("school.publicClass");
  const activityT = useTranslations("school.activities");
  const { publicClass, setPublicClass, pending, setPending, savedPublicClassRef: savedRef, savingRef, composingRef } = useAssessmentDraft();
  const draft = publicClass!;
  const setDraft = (update: (current: AssessmentWorkbenchPublicClassRecord) => AssessmentWorkbenchPublicClassRecord) => setPublicClass((current) => current ? update(current) : current);
  const save = async () => {
    if (disabled || savingRef.current || composingRef.current || !row.registrationId || JSON.stringify(draft) === savedRef.current) return;
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
      savedRef.current = JSON.stringify(draft);
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
    } catch { toast.error(activityT("actionFailed")); }
    finally { savingRef.current = false; setPending(false); }
  };
  const locked = disabled || pending;
  return <form className={compact ? "min-w-0" : "grid min-w-0 grid-cols-2 items-start gap-3 xl:grid-cols-4"} onClick={(event) => event.stopPropagation()}
    onCompositionStart={() => { composingRef.current = true; }}
    onCompositionEnd={() => { composingRef.current = false; }}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || composingRef.current) return;
      if (event.repeat) { if (event.key === "Enter") event.preventDefault(); return; }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey || compact)) { event.preventDefault(); void save(); }
    }}>
    {compact ? <Input value={draft.assessmentSummary} disabled={locked} maxLength={3000} className="h-8 text-xs"
      aria-label={t("assessmentSummary")} placeholder={t("assessmentSummary")}
      onChange={(event) => setDraft((current) => ({ ...current, assessmentSummary: event.target.value }))}
      onBlur={() => { void save(); }} /> : <>
      <div className="col-span-full flex min-w-0 flex-wrap items-end gap-3">
      {(["studentPresence", "guardianPresence"] as const).filter((field) => draft[field] !== "not_applicable").map((field) => <label key={field} className="block w-40 space-y-1 text-xs text-muted">
        <span>{t(field === "studentPresence" ? "studentAttendance" : "guardianAttendance")}</span>
        <FollowupChoice value={draft[field]} disabled={locked} label={t(field === "studentPresence" ? "studentAttendance" : "guardianAttendance")}
          options={(["expected", "attended", "late", "absent"] as const).map((value) => ({
            value, label: t(`presence_${value}`), tone: value === "attended" ? "healthy" : value === "absent" ? "unhealthy" : value === "late" ? "attention" : "neutral",
          }))}
          onValueChange={(value) => setDraft((current) => ({ ...current, [field]: value }))} />
      </label>)}
      <Button type="submit" disabled={locked} size="sm" className="ml-auto h-8 shrink-0" aria-keyshortcuts="Control+Enter Meta+Enter">
        {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{activityT("save")} <kbd className="text-[10px] opacity-70">Ctrl ↵</kbd>
      </Button>
      </div>
      {(["assessmentSummary", "learningObservation", "parentFeedback", "recommendation"] as const).map((field) => <label key={field} className="block min-w-0 space-y-1 text-xs text-muted">
        <span>{t(field)}</span>
        <Textarea rows={2} maxLength={3000} value={draft[field]} disabled={locked} aria-label={t(field)} className="min-h-20 resize-y text-xs"
          onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
      </label>)}
    </>}
  </form>;
}
