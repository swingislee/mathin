"use client";

import { useRef, useState } from "react";
import { Check, Clock3, PencilLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ActivityAssessmentDetails } from "./ActivityAssessmentDetails";
import { AssessmentQuickEntry } from "./AssessmentQuickEntry";
import { AssessmentClassificationPanel, AssessmentFeedbackPanel, AssessmentNextContactField, AssessmentWorkflowHistory } from "./AssessmentWorkflowPanels";
import type { AssessmentEntryParts } from "./AssessmentRegistrationFields";
import { FollowupEntryFields, FollowupEntryLayout } from "./FollowupEntryFields";
import { ASSESSMENT_STAGES, assessmentStageClickWrites, currentAssessmentReportWasSent, type AssessmentStage, type AssessmentWorkflowCommand } from "./assessment-workflow-contract";
import { getAssessmentWorkflowAction, saveAssessmentWorkflowAction } from "./assessment-workflow-actions";
import { assessmentWorkbenchHasFinalResult, type AssessmentWorkbenchQueue, type AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { businessRecordMessages, isCurrentBusinessRecord } from "./business-record-state-contract";
import { uniqueBusinessFeedback } from "./business-record-notes";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { PostActivityHandoff } from "./EnrollmentHandoffButton";
import type { ActivityEnrollmentContext } from "./enrollment-workflow-contract";
import type { InvitationAssessorOption } from "./invitation-contract";
import { LearningCheckStatusIcon } from "./LearningCheckStatusIcon";
import type { QuickFollowUpSaved } from "./QuickFollowUpEntry";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { TEACHER_ASSESSMENT_OUTCOMES } from "./teacher-assessment-contract";

/** 一组阶段导航：归类前登记事实，归类后只浏览。已经打开的面板保持草稿。 */
export function AssessmentRecordDetails({
  row, stage, conclusion, locale, canAssess, canSupport, canManageAssessor, assessors, reassigning,
  onReassign, onSaved, onHandoffSaved, onSaveAndNext, canQuickEntry = canAssess, canRoute = false,
}: {
  row: AssessmentWorkbenchRow; stage: Exclude<AssessmentWorkbenchQueue, "all">; conclusion: string; locale: string;
  canAssess: boolean; canSupport: boolean; canManageAssessor: boolean; canQuickEntry?: boolean; canRoute?: boolean;
  assessors: InvitationAssessorOption[]; reassigning: boolean; onReassign: (assessorId: string) => void;
  onSaved: (row: AssessmentWorkbenchRow) => void; onNoteSaved: (entry: QuickFollowUpSaved) => void;
  onHandoffSaved: (context: ActivityEnrollmentContext) => void; onSaveAndNext?: () => void;
}) {
  const t = useTranslations("school.supportAssessment");
  const w = useTranslations("school.assessmentWorkflow");
  const assessmentT = useTranslations("school.assessments");
  const sessionT = useTranslations("school.session");
  const quickT = useTranslations("school.assessmentQuickEntry");
  const recordM = businessRecordMessages(locale);
  const current = isCurrentBusinessRecord(row.recordState);
  const completed = assessmentWorkbenchHasFinalResult(row);
  const finalized = Boolean(row.workflow?.finalizedAt);
  const canWrite = current && row.participationStatus !== "no_show" && row.participationStatus !== "cancelled" && (canAssess || canQuickEntry || canRoute);
  const [section, setSection] = useState<AssessmentStage>(stage);
  const [visited, setVisited] = useState<Set<AssessmentStage>>(() => new Set([stage]));
  const [assessorId, setAssessorId] = useState(row.assessorId ?? "");
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [revising, setRevising] = useState(false);
  const [reason, setReason] = useState("");
  const show = (value: AssessmentStage) => { setSection(value); setVisited((items) => new Set([...items, value])); };
  const save = async (command: AssessmentWorkflowCommand) => {
    if (saving.current || !canWrite) return;
    saving.current = true; setPending(true);
    try {
      const result = await saveAssessmentWorkflowAction({ registrationId: row.registrationId,
        invitationId: row.registrationId ? null : row.invitationId, expectedRevision: row.workflow?.revision ?? 0, ...command });
      if (!result.ok) {
        toast.error(w(result.code === "ASSESSMENT_WORKFLOW_CONFLICT" ? "conflict" : result.code === "ASSESSMENT_WORKFLOW_FINALIZED" ? "finalizedHint" : "saveFailed"));
        if (row.registrationId && (result.code === "ASSESSMENT_WORKFLOW_CONFLICT" || result.code === "ASSESSMENT_WORKFLOW_FINALIZED")) {
          const latest = await getAssessmentWorkflowAction(row.registrationId);
          if (latest.ok) onSaved({ ...row, workflow: latest.data });
        }
        return;
      }
      onSaved({ ...row, ...result.data, updatedAt: result.data.workflow.updatedAt });
      if (command.command === "visit") show(command.values.stage);
      if (command.command === "classify") { show("handled"); toast.success(w("classified")); }
      if (command.command === "revise") { setRevising(false); setReason(""); toast.success(w("revisionOpened")); }
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
    } catch { toast.error(w("saveFailed")); }
    finally { saving.current = false; setPending(false); }
  };
  const visit = (value: AssessmentStage) => {
    if (!assessmentStageClickWrites(row.workflow, canWrite)) { show(value); return; }
    void save({ command: "visit", values: { stage: value } });
  };
  const assessmentSaved = async (saved: AssessmentWorkbenchRow) => {
    if (saved.registrationId) {
      try {
        const result = await getAssessmentWorkflowAction(saved.registrationId);
        if (result.ok) saved = { ...saved, workflow: result.data };
      } catch { toast.error(w("reloadAfterSave")); }
    }
    onSaved(saved);
    if (assessmentWorkbenchHasFinalResult(saved) && section === "in_progress") show("feedback");
  };
  const mayReassign = current && !finalized && !row.assessmentCompletedAt && row.assessmentKind === "one_to_one" && canManageAssessor && Boolean(row.invitationId);
  const panelId = (value: AssessmentStage) => "assessment-stage-" + row.id + "-" + value;

  const evidence = <section className="min-w-0" data-assessment-evidence>
    <h3 className="text-xs font-medium">{current ? row.assessment?.resultSource === "quick_entry" ? quickT("quickEvidence") : t("teacherEvidence") : recordM.historicalFeedback}</h3>
    <p className="mt-2 whitespace-pre-wrap text-xs leading-6">{(current ? conclusion : uniqueBusinessFeedback(conclusion, row.assessment?.parentConcerns)) || t("conclusionPending")}</p>
    {row.questionSummary ? <>
      <div className="mt-3 flex flex-wrap gap-1">{TEACHER_ASSESSMENT_OUTCOMES.map((status) => {
        const count = row.questionSummary?.outcomeCounts[status] ?? 0;
        return count ? <Badge key={status} variant="outline" className={cn("gap-1 px-2 py-1 text-[10px]", LEARNING_CHECK_STATUS_STYLE[status].card, LEARNING_CHECK_STATUS_STYLE[status].icon)}>
          <LearningCheckStatusIcon status={status} size={12} />{sessionT("learningStatusShort_" + status)} {count}</Badge> : null;
      })}</div>
      <h4 className="mt-4 text-[11px] font-medium text-muted">{t("keyNotes")}</h4>
      {row.questionSummary.keyNotes.length ? <ul className="mt-1 divide-y divide-line/70">{row.questionSummary.keyNotes.map((note, index) => <li key={note.questionNo + ":" + index} className="py-2 text-[11px] leading-5">
        <span className="font-medium">{t("questionNote", { question: note.questionNo, point: note.knowledgePoint })}</span><span className="ml-2 text-muted">{note.note}</span>
      </li>)}</ul> : <p className="mt-1 text-[11px] text-muted">{t("noKeyNotes")}</p>}
    </> : null}
  </section>;

  if (!current) return <div data-assessment-workbench-detail={row.id}>{evidence}</div>;
  const renderEntry = (entry: AssessmentEntryParts) => <AssessmentClassificationPanel
    key={row.id + ":" + (row.workflow?.finalizedAt ?? "draft")} id={`assessment-classification-${row.id}`}
    workflow={row.workflow} disabled={!canWrite || finalized} pending={pending || Boolean(entry.followup.pending)} locale={locale}
    onSave={(values) => { if (!entry.dirty) void save({ command: "classify", values }); }}
    render={(classification) => {
      const classifying = section === "handled";
      const followup = classifying ? classification.followup : entry.followup;
      const blockedByAssessmentDraft = classifying && entry.dirty && !finalized;
      return <div className="min-w-0" data-assessment-workbench-detail={row.id} aria-busy={pending || entry.followup.pending}>
    <FollowupEntryLayout data-assessment-detail-layout>
    <FollowupEntryFields {...followup} layout="stage" saveDisabled={followup.saveDisabled || blockedByAssessmentDraft}
      reminderContent={classifying ? classification.followup.reminderContent : <AssessmentNextContactField
        id={`assessment-next-${row.id}`} value={classification.nextContactAt} hint={canWrite && !finalized} />}
      hint={blockedByAssessmentDraft ? w("saveAssessmentFirst") : followup.hint}
      tools={blockedByAssessmentDraft ? <Button type="button" size="sm" variant="secondary"
        disabled={entry.followup.disabled || entry.followup.pending || entry.followup.saveDisabled}
        onClick={() => entry.followup.onSave?.(false)}>{w("saveAssessmentDraft")}</Button> : undefined}
      stageHeader={
    <div data-assessment-detail-header className="col-start-1 row-start-1 min-w-0 space-y-3">
      <div data-assessment-tags className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">{entry.tags}{classification.tags}</div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <nav aria-label={t("progressLabel")}><ol data-assessment-progress className="flex min-w-0 flex-wrap items-center gap-y-2">
        {ASSESSMENT_STAGES.map((value, index) => {
          const passed = value === "pending" ? row.participationStatus === "attended" : value === "in_progress" ? completed
            : value === "feedback" ? currentAssessmentReportWasSent(row.workflow) : finalized;
          const selected = value === section;
          return <li key={value} className="flex items-center gap-1.5 text-xs">
            <button type="button" disabled={pending || entry.followup.pending} aria-current={selected ? "step" : undefined} aria-controls={panelId(value)}
              data-assessment-stage={value} onClick={() => visit(value)} className="flex min-h-8 items-center gap-1.5 rounded px-1 focus-visible:outline-2 focus-visible:outline-leaf-deep disabled:opacity-60">
              <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                selected ? "border-[var(--followup-outline)] bg-moon/25 ring-2 ring-[var(--followup-outline)]/25" : passed ? "border-leaf-deep bg-leaf/25" : "border-muted/40 bg-card text-muted")}>
                {passed ? <Check className="size-3" /> : index + 1}</span>
              <span className={selected ? "font-medium text-ink" : "text-muted"}>{w("stage_" + value)}</span>
            </button>
            {index < ASSESSMENT_STAGES.length - 1 ? <span aria-hidden className={cn("mx-1 w-5 border-t-2", passed ? "border-leaf-deep" : "border-dashed border-muted/40")} /> : null}
          </li>;
        })}
      </ol></nav>
      {finalized && canWrite ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setRevising((value) => !value)}><PencilLine className="size-3.5" />{w("revise")}</Button> : null}
      </div>
    <p className="text-[11px] text-muted">{w(finalized ? "browseHint" : canWrite ? "stageClickHint" : "readonlyHint")}</p>
    {revising && finalized ? <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void save({ command: "revise", values: { reason } }); }}>
      <Input aria-label={w("revisionReason")} placeholder={w("revisionReason")} value={reason} maxLength={500} disabled={pending} className="max-w-lg text-xs" onChange={(event) => setReason(event.target.value)} />
      <Button type="submit" size="sm" disabled={pending || !reason.trim()}>{w("confirmRevision")}</Button>
    </form> : null}
    </div>}>
    {visited.has("pending") ? <section id={panelId("pending")} hidden={section !== "pending"} className="space-y-3" data-assessment-panel="pending">
      <p className="flex items-center gap-2 text-xs"><Clock3 className="size-4 text-crater" />{w(row.participationStatus === "attended" ? "arrived" : "notArrived")}</p>
      <p className="text-xs text-muted">{w("arrivalHint")}</p>
      <div><h3 className="text-xs font-medium">{t("backgroundTitle")}</h3><p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-muted">{row.background || assessmentT("backgroundEmpty")}</p></div>
    </section> : null}
    {visited.has("in_progress") ? <section id={panelId("in_progress")} hidden={section !== "in_progress"} className="space-y-4" data-assessment-panel="in_progress">
      {row.entryActors?.length ? <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted" data-assessment-entry-actors>{row.entryActors.map((actor) => <span key={actor.kind}>
        {quickT(actor.kind === "teacher" ? "teacherRecordedBy" : "quickRecordedBy", { name: actor.name || quickT("unknownActor") })}</span>)}</div> : null}
      {mayReassign ? <div data-assessor-reassignment={row.id} className="flex max-w-lg flex-wrap items-center gap-2"><span className="text-xs text-muted">{t("assignedAssessor")}</span>
        <FollowupChoice value={assessorId} disabled={reassigning || pending || entry.followup.pending} label={t("changeAssessorFor", { name: row.name })} className="w-40" onValueChange={setAssessorId}
          options={assessors.map((assessor) => ({ value: assessor.userId, label: assessor.displayName, tone: "healthy" }))} />
        <Button type="button" size="sm" variant="secondary" disabled={pending || entry.followup.pending || reassigning || !assessorId || assessorId === row.assessorId} onClick={() => onReassign(assessorId)}>{t("confirmAssessor")}</Button></div> : null}
      {entry.fields}
      {completed ? evidence : null}
    </section> : null}
    {visited.has("feedback") ? <section id={panelId("feedback")} hidden={section !== "feedback"} className="space-y-4" data-assessment-panel="feedback">
      <AssessmentFeedbackPanel registrationId={row.registrationId} workflow={row.workflow} hasResult={completed} canWrite={canWrite} pending={pending || Boolean(entry.followup.pending)} onPrepare={() => { void save({ command: "report", values: {} }); }} />
      {completed ? evidence : null}
    </section> : null}
    {visited.has("handled") ? <section id={panelId("handled")} hidden={section !== "handled"} className="space-y-4" data-assessment-panel="handled">
      {!completed ? <p className="text-xs text-muted">{w("earlyFeedbackHint")}</p> : null}
      {classification.fields}
      {canSupport && row.registrationId && completed ? <PostActivityHandoff source={{ registrationId: row.registrationId, invitationId: null }} enrollmentOnly onSaved={onHandoffSaved} /> : null}
    </section> : null}
    </FollowupEntryFields>
    <div className="col-start-1 row-start-4 min-w-0 space-y-3 @[50rem]/followup-entry:row-start-3">
    {row.workflow && row.registrationId ? <AssessmentWorkflowHistory registrationId={row.registrationId} revision={row.workflow.revision} locale={locale} /> : null}
    {row.activityId ? <div className="flex justify-end"><Link href={"/dashboard/activities/" + row.activityId + "?" + (row.publicClassRecord ? "view=onsite&segment=" + row.publicClassRecord.segmentId : "node=assessment")}
      className="max-w-full truncate text-xs text-leaf-deep hover:underline">{row.publicClassRecord?.segmentTitle || row.activityTitle} · {t("activityWorkspace")}</Link></div> : null}
    </div>
    </FollowupEntryLayout>
  </div>;
    }} />;
  return row.assessmentKind === "one_to_one" ? <AssessmentQuickEntry row={row} disabled={!canWrite || !canQuickEntry || finalized || pending}
    canRoute={false} onSaved={(saved) => { void assessmentSaved(saved); }} onSaveAndNext={onSaveAndNext} render={renderEntry} />
    : <ActivityAssessmentDetails row={row} disabled={!canWrite || !canAssess || finalized || pending}
      onSaved={(saved) => { void assessmentSaved(saved); }} onSaveAndNext={onSaveAndNext} render={renderEntry} />;
}
