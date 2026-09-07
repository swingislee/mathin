"use client";

import { Fragment, useState } from "react";
import { Check, Clock3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ActivityAssessmentDetails } from "./ActivityAssessmentDetails";
import { AssessmentQuickEntry } from "./AssessmentQuickEntry";
import { assessmentWorkbenchHasFinalResult, type AssessmentWorkbenchQueue, type AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { businessRecordMessages, isCurrentBusinessRecord } from "./business-record-state-contract";
import { uniqueBusinessFeedback } from "./business-record-notes";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { PostActivityHandoff } from "./EnrollmentHandoffButton";
import type { ActivityEnrollmentContext } from "./enrollment-workflow-contract";
import type { InvitationAssessorOption } from "./invitation-contract";
import { LearningCheckStatusIcon } from "./LearningCheckStatusIcon";
import { QuickFollowUpEntry, type QuickFollowUpSaved } from "./QuickFollowUpEntry";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";
import { TEACHER_ASSESSMENT_OUTCOMES } from "./teacher-assessment-contract";
import { TeacherAssessmentEntryButton } from "./TeacherAssessmentEntryButton";

const STAGES = ["pending", "in_progress", "feedback", "handled"] as const;
const STAGE_LABELS = ["stageAssessmentPending", "stageInProgress", "stagePending", "stageHandled"] as const;
type EntrySection = "assessment" | "note" | "handoff";

/** 以本次测评事实展示进度；登记模块各自显式保存，切换时保持已打开模块的草稿。 */
export function AssessmentRecordDetails({
  row, stage, conclusion, locale, canAssess, canSupport, canManageAssessor, assessors, reassigning,
  onReassign, onSaved, onNoteSaved, onHandoffSaved, onSaveAndNext, canQuickEntry = canAssess, canRoute = false,
}: {
  row: AssessmentWorkbenchRow;
  stage: Exclude<AssessmentWorkbenchQueue, "all">;
  conclusion: string;
  locale: string;
  canAssess: boolean;
  canSupport: boolean;
  canManageAssessor: boolean;
  canQuickEntry?: boolean;
  canRoute?: boolean;
  assessors: InvitationAssessorOption[];
  reassigning: boolean;
  onReassign: (assessorId: string) => void;
  onSaved: (row: AssessmentWorkbenchRow) => void;
  onNoteSaved: (entry: QuickFollowUpSaved) => void;
  onHandoffSaved: (context: ActivityEnrollmentContext) => void;
  onSaveAndNext?: () => void;
}) {
  const t = useTranslations("school.supportAssessment");
  const assessmentT = useTranslations("school.assessments");
  const sessionT = useTranslations("school.session");
  const quickT = useTranslations("school.assessmentQuickEntry");
  const recordM = businessRecordMessages(locale);
  const current = isCurrentBusinessRecord(row.recordState);
  const completed = assessmentWorkbenchHasFinalResult(row);
  const [section, setSection] = useState<EntrySection>("assessment");
  const [visited, setVisited] = useState<Set<EntrySection>>(() => new Set(["assessment"]));
  const [assessorId, setAssessorId] = useState(row.assessorId ?? "");
  const mayReassign = current && !row.assessmentCompletedAt && row.assessmentKind === "one_to_one" && canManageAssessor && Boolean(row.invitationId);
  const mayTakeNote = current && Boolean(row.studentId);
  const mayHandoff = current && canSupport && Boolean(row.registrationId) && (completed || row.assessmentKind === "one_to_one");

  return <div className="min-w-0 space-y-4" data-assessment-workbench-detail={row.id}>
    {current ? <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <ol aria-label={t("progressLabel")} data-assessment-progress className="flex min-w-0 flex-wrap items-center gap-y-2">
        {STAGES.map((value, index) => {
          const passed = index < STAGES.indexOf(stage);
          const selected = value === stage;
          return <Fragment key={value}>
            <li aria-current={selected ? "step" : undefined} className="flex items-center gap-1.5 text-xs">
              <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                selected ? "border-[var(--followup-outline)] bg-moon/25 ring-2 ring-[var(--followup-outline)]/25"
                  : passed ? "border-leaf-deep bg-leaf/25" : "border-muted/40 bg-card text-muted")}>
                {passed ? <Check className="size-3" /> : index + 1}
              </span>
              <span className={selected ? "font-medium text-ink" : "text-muted"}>{t(STAGE_LABELS[index])}</span>
              {index < STAGES.length - 1 ? <span aria-hidden className={cn("mx-2 w-5 border-t-2", passed ? "border-leaf-deep" : "border-dashed border-muted/40")} /> : null}
            </li>
          </Fragment>;
        })}
      </ol>
      {row.activityId ? <Link href={`/dashboard/activities/${row.activityId}?${row.publicClassRecord ? `view=onsite&segment=${row.publicClassRecord.segmentId}` : "node=assessment"}`}
        className="max-w-full truncate text-xs text-leaf-deep hover:underline">{row.publicClassRecord?.segmentTitle || row.activityTitle} · {t("activityWorkspace")}</Link> : null}
    </div> : null}

    <Tabs value={section} onValueChange={(value) => { const next = value as EntrySection; setSection(next); setVisited((items) => new Set([...items, next])); }}>
      {mayTakeNote || mayHandoff ? <TabsList aria-label={t("entryLabel")} className="mb-3 h-auto flex-wrap justify-start gap-1">
        <TabsTrigger value="assessment">{t("entryAssessment")}</TabsTrigger>
        {mayTakeNote ? <TabsTrigger value="note">{t("entryNote")}</TabsTrigger> : null}
        {mayHandoff ? <TabsTrigger value="handoff">{t("entryHandoff")}</TabsTrigger> : null}
      </TabsList> : null}
      <TabsContent value="assessment" forceMount hidden={section !== "assessment"} className="mt-0 space-y-4 data-[state=inactive]:hidden">
        {current && row.assessmentKind === "one_to_one" ? <div className="flex flex-wrap items-center justify-between gap-2" data-assessment-question-entry>
          <div className="text-xs"><span className="font-medium">{quickT("questionEntry")}</span>
            <span className="ml-2 text-muted">{quickT(row.assessmentCompletedAt ? "questionCompleted" : row.assessmentStartedAt ? "questionInProgress" : row.teacherRequired ? "questionRequired" : "questionOptional")}</span></div>
          {canAssess ? <TeacherAssessmentEntryButton registrationId={row.registrationId} invitationId={row.invitationId} /> : null}
        </div> : null}
        {current && (row.entryActors?.length || row.assessment?.recordedByName) ? <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted" data-assessment-entry-actors>
          {row.entryActors?.map((actor) => <span key={actor.kind}>{quickT(actor.kind === "teacher" ? "teacherRecordedBy" : "quickRecordedBy", { name: actor.name || quickT("unknownActor") })}
            <span className="ml-1">{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(actor.recordedAt))}</span></span>)}
          {!row.entryActors?.some((actor) => actor.kind === "teacher") && row.assessment?.recordedByName && row.assessment.resultSource !== "quick_entry" ? <span>
            {quickT(row.assessmentCompletedAt ? "teacherRecordedBy" : "previousRecordedBy", { name: row.assessment.recordedByName })}</span> : null}
        </div> : null}
        {mayReassign ? <div data-assessor-reassignment={row.id} className="flex max-w-lg flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{t("assignedAssessor")}</span>
          <FollowupChoice value={assessorId} disabled={reassigning} label={t("changeAssessorFor", { name: row.name })}
            className="w-40" onValueChange={setAssessorId}
            options={assessors.map((assessor) => ({ value: assessor.userId, label: assessor.displayName, tone: "healthy" }))} />
          <Button type="button" size="sm" variant="secondary" disabled={reassigning || !assessorId || assessorId === row.assessorId}
            onClick={() => onReassign(assessorId)}>{t("confirmAssessor")}</Button>
        </div> : null}
        {current && row.assessmentKind === "one_to_one" ? <AssessmentQuickEntry row={row} disabled={!canQuickEntry} canRoute={canRoute} onSaved={onSaved} onSaveAndNext={onSaveAndNext} /> : null}
        {current && row.assessmentKind === "activity" ? <ActivityAssessmentDetails row={row} disabled={!canAssess} onSaved={onSaved} onSaveAndNext={onSaveAndNext} /> : !completed ? (
          <div className="grid min-w-0 items-start gap-4 @[50rem]/followup-entry:grid-cols-[minmax(0,1fr)_auto]">
            <section className="min-w-0"><h3 className="text-xs font-medium">{t("backgroundTitle")}</h3>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-muted">{row.background || assessmentT("backgroundEmpty")}</p></section>
            <div className="flex min-w-0 items-start gap-2"><Clock3 className="mt-0.5 size-4 shrink-0 text-crater" />
              <div className="space-y-2"><p className="text-xs">{t(stage === "pending" ? "waitingAssessment" : "assessmentInProgress")}</p>
              </div>
            </div>
          </div>
        ) : <section className="min-w-0">
          <h3 className="text-xs font-medium">{current ? row.assessment?.resultSource === "quick_entry" ? quickT("quickEvidence") : t("teacherEvidence") : recordM.historicalFeedback}</h3>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-6">{uniqueBusinessFeedback(conclusion, row.assessment?.parentConcerns) || t("conclusionPending")}</p>
          {row.questionSummary ? <>
            <div className="mt-3 flex flex-wrap gap-1">{TEACHER_ASSESSMENT_OUTCOMES.map((status) => {
              const count = row.questionSummary?.outcomeCounts[status] ?? 0;
              return count ? <Badge key={status} variant="outline" className={cn("gap-1 px-2 py-1 text-[10px]", LEARNING_CHECK_STATUS_STYLE[status].card, LEARNING_CHECK_STATUS_STYLE[status].icon)}>
                <LearningCheckStatusIcon status={status} size={12} />{sessionT(`learningStatusShort_${status}`)} {count}
              </Badge> : null;
            })}</div>
            <h4 className="mt-4 text-[11px] font-medium text-muted">{t("keyNotes")}</h4>
            {row.questionSummary.keyNotes.length ? <ul className="mt-1 divide-y divide-line/70">{row.questionSummary.keyNotes.map((note, index) => <li key={`${note.questionNo}:${index}`} className="py-2 text-[11px] leading-5">
              <span className="font-medium">{t("questionNote", { question: note.questionNo, point: note.knowledgePoint })}</span><span className="ml-2 text-muted">{note.note}</span>
            </li>)}</ul> : <p className="mt-1 text-[11px] text-muted">{t("noKeyNotes")}</p>}
          </> : null}
        </section>}
      </TabsContent>
      {mayTakeNote && visited.has("note") ? <TabsContent value="note" forceMount hidden={section !== "note"} className="mt-0 data-[state=inactive]:hidden">
        <QuickFollowUpEntry studentId={row.studentId!} layout="followup" onSaved={onNoteSaved} onSaveAndNext={onSaveAndNext} />
      </TabsContent> : null}
      {mayHandoff && visited.has("handoff") ? <TabsContent value="handoff" forceMount hidden={section !== "handoff"} className="mt-0 data-[state=inactive]:hidden">
        <PostActivityHandoff source={{ registrationId: row.registrationId, invitationId: row.registrationId ? null : row.invitationId }} onSaved={onHandoffSaved} />
      </TabsContent> : null}
    </Tabs>
  </div>;
}
