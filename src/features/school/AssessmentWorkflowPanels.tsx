"use client";

import { useState } from "react";
import { CalendarClock, FileText, MessageCircle, Tags } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { ASSESSMENT_PARENT_CLASSIFICATIONS, ASSESSMENT_PARENT_REASONS, currentAssessmentReportWasSent,
  type AssessmentClassificationValues, type AssessmentWorkflow, type AssessmentWorkflowEvent } from "./assessment-workflow-contract";
import { getAssessmentWorkflowHistoryAction } from "./assessment-workflow-actions";

export function AssessmentFeedbackPanel({ registrationId, workflow, hasResult, pending, canWrite, onPrepare }: {
  registrationId: string | null; workflow: AssessmentWorkflow | null | undefined; hasResult: boolean;
  pending: boolean; canWrite: boolean; onPrepare: () => void;
}) {
  const t = useTranslations("school.assessmentWorkflow");
  return <section className="space-y-3" data-assessment-feedback>
    <div className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4 text-crater" />{t("reportTitle")}</div>
    <p className="text-xs leading-6 text-muted">{t(hasResult ? "reportHint" : "reportNotReady")}</p>
    <div className="flex flex-wrap items-center gap-2">
      {canWrite && !workflow?.finalizedAt && hasResult ? <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={onPrepare}>{t(workflow?.report ? "updateReport" : "prepareReport")}</Button> : null}
      {workflow?.report && registrationId ? <Link target="_blank" rel="noopener noreferrer"
        className={buttonVariants({ variant: "secondary", size: "sm" })}
        href={`/dashboard/followups/assessments/${registrationId}/reports/${workflow.report.id}`}>
        {t("openReport", { version: workflow.report.version })}</Link> : null}
    </div>
    <p className="text-xs text-muted" data-assessment-report-send-status>{t(currentAssessmentReportWasSent(workflow) ? "reportSent" : "reportNotSent")}
      {currentAssessmentReportWasSent(workflow) && workflow?.sentByName ? ` · ${workflow.sentByName}` : ""}</p>
    {!workflow?.finalizedAt ? <p className="text-xs leading-6 text-muted">{t("advanceConfirmsSend")}</p> : null}
  </section>;
}

export function AssessmentClassificationPanel({ workflow, disabled, pending, onSave, locale }: {
  workflow: AssessmentWorkflow | null | undefined; disabled: boolean; pending: boolean; locale: string;
  onSave: (values: AssessmentClassificationValues) => void;
}) {
  const t = useTranslations("school.assessmentWorkflow");
  const [classification, setClassification] = useState<AssessmentClassificationValues["classification"] | "">(workflow?.classification ?? "");
  const [response, setResponse] = useState(workflow?.parentResponse ?? "");
  const [reasons, setReasons] = useState<AssessmentClassificationValues["reasons"]>(workflow?.reasons ?? []);
  const [nextAt, setNextAt] = useState(() => workflow?.nextContactAt ? new Date(new Date(workflow.nextContactAt).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : "");
  const locked = disabled || pending;
  return <form data-assessment-classification className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    if (locked || !classification) return;
    onSave({ classification, parentResponse: response, reasons, nextContactAt: nextAt ? new Date(`${nextAt}+08:00`).toISOString() : null });
  }}>
    <label className="block space-y-1.5 text-xs text-muted"><span className="flex items-center gap-1.5"><MessageCircle className="size-3.5 text-crater" />{t("parentResponse")}</span>
      <Textarea rows={3} maxLength={2000} value={response} disabled={locked} onChange={(event) => setResponse(event.target.value)} placeholder={t("parentResponsePlaceholder")} />
    </label>
    <div className="grid min-w-0 gap-3 @[36rem]/followup-entry:grid-cols-2">
      <div className="flex min-w-0 items-center gap-2"><Tags className="size-4 shrink-0 text-crater" />
        <FollowupChoice label={t("classification")} value={classification} disabled={locked} placeholder={t("chooseClassification")}
          onValueChange={(value) => setClassification(value as AssessmentClassificationValues["classification"])}
          options={ASSESSMENT_PARENT_CLASSIFICATIONS.map((value) => ({ value, label: t(`classification_${value}`), tone: value === "not_enrolling" ? "unhealthy" : value === "ready_to_enroll" ? "healthy" : "attention" }))} />
      </div>
      <div className="space-y-1.5"><label htmlFor={`assessment-next-${workflow?.id ?? "new"}`} className="flex items-center gap-1.5 text-xs text-muted"><CalendarClock className="size-3.5 text-crater" />{t("nextContact")}</label>
        <DateTimePicker id={`assessment-next-${workflow?.id ?? "new"}`} mode="datetime" value={nextAt} onValueChange={setNextAt} disabled={locked} /></div>
    </div>
    <fieldset disabled={locked} className="flex flex-wrap gap-x-4 gap-y-2"><legend className="mb-2 text-xs text-muted">{t("reasons")}</legend>
      {ASSESSMENT_PARENT_REASONS.map((reason) => <label key={reason} className="flex items-center gap-1.5 text-xs text-muted">
        <input type="checkbox" checked={reasons.includes(reason)} onChange={(event) => setReasons((items) => event.target.checked ? [...items, reason] : items.filter((item) => item !== reason))} />{t(`reason_${reason}`)}</label>)}
    </fieldset>
    <p className="text-xs leading-5 text-muted">{t("enrollmentIsSeparate")}</p>
    {workflow?.finalizedAt ? <p className="text-xs text-leaf-deep">{t("classifiedAt", { name: workflow.updatedByName,
      time: new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(workflow.finalizedAt)) })}</p>
      : <Button type="submit" size="sm" disabled={locked || !classification}>{t(pending ? "saving" : "saveClassification")}</Button>}
  </form>;
}

export function AssessmentWorkflowHistory({ registrationId, revision, locale }: { registrationId: string; revision: number; locale: string }) {
  const t = useTranslations("school.assessmentWorkflow");
  const [events, setEvents] = useState<AssessmentWorkflowEvent[]>([]);
  const [loadedRevision, setLoadedRevision] = useState(-1);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (loading || loadedRevision === revision) return;
    setLoading(true); setError(false);
    try {
      const result = await getAssessmentWorkflowHistoryAction(registrationId);
      if (result.ok) { setEvents(result.data); setLoadedRevision(revision); } else setError(true);
    } catch { setError(true); }
    finally { setLoading(false); }
  };
  return <details className="border-t border-line pt-3 text-xs" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary className="cursor-pointer text-muted">{t("history")}</summary>
    {error ? <Button type="button" size="sm" variant="ghost" onClick={() => { void load(); }}>{t("retry")}</Button> : null}
    {loading ? <p className="py-2 text-muted">{t("loading")}</p> : <ol className="mt-2 max-h-56 space-y-2 overflow-y-auto text-[11px] leading-5 text-muted">
      {events.map((event) => <li key={event.id}>
        {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(event.recordedAt))} · {event.recordedByName} · {t(`event_${event.action}`)}
        {event.action === "visit" ? ` · ${t(`stage_${event.stage}`)}` : ""}
        {event.action === "classify" && event.classification ? ` · ${t(`classification_${event.classification}`)}` : ""}
        {event.action === "revise" ? <p className="whitespace-pre-wrap text-ink">{event.reason}</p> : null}
        {event.action === "classify" && event.parentResponse ? <p className="whitespace-pre-wrap text-ink">{event.parentResponse}</p> : null}
        {event.reportId ? <Link className="ml-2 text-leaf-deep hover:underline" target="_blank" rel="noopener noreferrer"
          href={`/dashboard/followups/assessments/${registrationId}/reports/${event.reportId}`}>{t(event.reportId === event.sentReportId ? "sentReportVersion" : "reportVersion")}</Link> : null}
      </li>)}
    </ol>}
  </details>;
}
