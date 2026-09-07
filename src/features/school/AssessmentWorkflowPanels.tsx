"use client";

import { useState, type ReactNode } from "react";
import { CalendarClock, FileText, Signpost } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { ASSESSMENT_PARENT_CLASSIFICATIONS, ASSESSMENT_PARENT_REASONS, currentAssessmentReportWasSent,
  type AssessmentClassificationValues, type AssessmentWorkflow, type AssessmentWorkflowEvent } from "./assessment-workflow-contract";
import { getAssessmentWorkflowHistoryAction } from "./assessment-workflow-actions";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";
import { FollowupFieldIcon } from "./FollowupFieldIcon";
import type { AssessmentEntryParts } from "./AssessmentRegistrationFields";

export function AssessmentNextContactField({ id, value, disabled = false, onChange, hint }: {
  id: string; value: string | null | undefined; disabled?: boolean; onChange?: (value: string | null) => void; hint?: boolean;
}) {
  const t = useTranslations("school.assessmentWorkflow");
  return <div className="w-full max-w-72 space-y-1.5">
    <Label htmlFor={id} className="flex items-center gap-1.5 text-xs text-muted"><CalendarClock className="size-3.5 text-crater" />{t("nextContact")}</Label>
    <DateTimePicker id={id} mode="datetime" value={value ? zonedDateTimeInputValue(new Date(value), "Asia/Shanghai") : ""}
      disabled={disabled || !onChange} className="h-auto min-h-9 whitespace-normal text-xs"
      onValueChange={(next) => onChange?.(next ? dateTimeInputToInstant(next, "Asia/Shanghai")?.toISOString() ?? null : null)} />
    {hint ? <p className="text-[11px] leading-5 text-muted">{t("nextContactInClassification")}</p> : null}
  </div>;
}

export function AssessmentFeedbackPanel({ registrationId, workflow, hasResult, pending, canWrite, onPrepare }: {
  registrationId: string | null; workflow: AssessmentWorkflow | null | undefined; hasResult: boolean;
  pending: boolean; canWrite: boolean; onPrepare: () => void;
}) {
  const t = useTranslations("school.assessmentWorkflow");
  return <section className="space-y-3" data-assessment-feedback>
    <div className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4 text-crater" />{t("reportTitle")}</div>
    <p className="text-xs leading-6 text-muted">{t(hasResult ? "reportHint" : "reportNotReady")}</p>
    <div className="flex flex-wrap items-center gap-2">
      {canWrite && hasResult ? <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={onPrepare}>{t(workflow?.report ? "updateReport" : "prepareReport")}</Button> : null}
      {workflow?.report && registrationId ? <Link target="_blank" rel="noopener noreferrer"
        className={buttonVariants({ variant: "secondary", size: "sm" })}
        href={`/dashboard/followups/assessments/${registrationId}/reports/${workflow.report.id}`}>
        {t("openReport", { version: workflow.report.version })}</Link> : null}
    </div>
    <p className="text-xs text-muted" data-assessment-report-send-status>{t(currentAssessmentReportWasSent(workflow) ? "reportSent" : "reportNotSent")}
      {currentAssessmentReportWasSent(workflow) && workflow?.sentByName ? ` · ${workflow.sentByName}` : ""}</p>
    <p className="text-xs leading-6 text-muted">{t("advanceConfirmsSend")}</p>
  </section>;
}

export function AssessmentClassificationPanel({ id, workflow, disabled, pending, onSave, locale, render, initialResponse = "" }: {
  id: string;
  workflow: AssessmentWorkflow | null | undefined; disabled: boolean; pending: boolean; locale: string;
  onSave: (values: AssessmentClassificationValues) => void;
  initialResponse?: string;
  render?: (entry: AssessmentEntryParts & { nextContactAt: string | null }) => ReactNode;
}) {
  const t = useTranslations("school.assessmentWorkflow");
  const [classification, setClassification] = useState<NonNullable<AssessmentClassificationValues["classification"]> | "">(workflow?.classification ?? "");
  const [response, setResponse] = useState(workflow?.parentResponse || (!workflow?.classification && !workflow?.contactedAt ? initialResponse : ""));
  const [reasons, setReasons] = useState<AssessmentClassificationValues["reasons"]>(workflow?.reasons ?? []);
  const [nextAt, setNextAt] = useState(workflow?.nextContactAt ?? null);
  const [trialIntent, setTrialIntent] = useState(workflow?.trialIntent ?? false);
  const [sharedReportId, setSharedReportId] = useState<string | null>(null);
  const locked = disabled || pending;
  const dirty = classification !== (workflow?.classification ?? "") || response !== (workflow?.parentResponse ?? "")
    || nextAt !== (workflow?.nextContactAt ?? null) || JSON.stringify(reasons) !== JSON.stringify(workflow?.reasons ?? [])
    || trialIntent !== (workflow?.trialIntent ?? false) || sharedReportId !== null;
  const meaningful = Boolean(classification || response.trim() || trialIntent || sharedReportId || workflow?.contactedAt);
  const submit = () => {
    if (locked || !dirty || !meaningful) return;
    onSave({ classification: classification || null, parentResponse: response, reasons, nextContactAt: nextAt, trialIntent, sharedReportId });
  };
  const entry: AssessmentEntryParts & { nextContactAt: string | null } = {
    dirty,
    nextContactAt: nextAt,
    followup: {
      id, note: response, onNoteChange: setResponse, noteLabel: t("parentResponse"), placeholder: t("parentResponsePlaceholder"),
      disabled, readOnly: disabled, pending, saveDisabled: !dirty || !meaningful, onSave: submit, saveLabel: t("saveClassification"),
      reminderContent: <AssessmentNextContactField id={`${id}-next`} value={nextAt} onChange={setNextAt} disabled={locked} />,
      hint: workflow?.contactedAt ? t("classifiedAt", { name: workflow.updatedByName,
        time: new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(workflow.contactedAt)) }) : undefined,
    },
    tags: <div data-assessment-field="classification" className="flex min-h-8 min-w-0 max-w-full flex-wrap items-center gap-2">
        <FollowupFieldIcon icon={Signpost} label={t("classification")} className="fill-moon text-crater" />
        <FollowupChoice label={t("classification")} value={classification} disabled={locked} placeholder={t("chooseClassification")}
          className="w-40 min-h-8 py-1"
          onValueChange={(value) => setClassification(value as NonNullable<AssessmentClassificationValues["classification"]> | "")}
          options={[{ value: "", label: t("chooseClassification"), tone: "attention" }, ...ASSESSMENT_PARENT_CLASSIFICATIONS.map((value) => ({ value, label: t(`classification_${value}`), tone: value === "not_enrolling" ? "unhealthy" as const : "attention" as const }))]} />
        <label className="flex items-center gap-1.5 text-xs" data-assessment-trial-intent>
          <Checkbox checked={trialIntent} disabled={locked} onCheckedChange={(checked) => setTrialIntent(checked === true)} />{t("trialIntent")}
        </label>
      </div>,
    fields: <>
    {workflow?.report ? <label className="flex items-center gap-2 text-xs" data-assessment-report-shared>
      <Checkbox checked={currentAssessmentReportWasSent(workflow) || sharedReportId === workflow.report.id}
        disabled={locked || currentAssessmentReportWasSent(workflow)}
        onCheckedChange={(checked) => setSharedReportId(checked === true ? workflow.report!.id : null)} />{t("sharedReport", { version: workflow.report.version })}
    </label> : null}
    <fieldset disabled={locked} className="flex flex-wrap gap-x-4 gap-y-2"><legend className="mb-2 text-xs text-muted">{t("reasons")}</legend>
      {ASSESSMENT_PARENT_REASONS.map((reason) => <label key={reason} className="flex items-center gap-1.5 text-xs text-muted">
        <Checkbox checked={reasons.includes(reason)} disabled={locked} onCheckedChange={(checked) => setReasons((items) => checked === true ? [...items, reason] : items.filter((item) => item !== reason))} />{t(`reason_${reason}`)}</label>)}
    </fieldset>
    <p className="text-xs leading-5 text-muted">{t("enrollmentIsSeparate")}</p>
    </>,
  };
  return <div data-assessment-classification className="min-w-0">
    {render ? render(entry) : <FollowupEntryFields {...entry.followup}>{entry.tags}{entry.fields}</FollowupEntryFields>}
  </div>;
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
        {event.action === "classify" && event.trialIntent ? ` · ${t("trialIntent")}` : ""}
        {event.action === "revise" ? <p className="whitespace-pre-wrap text-ink">{event.reason}</p> : null}
        {event.action === "classify" && event.parentResponse ? <p className="whitespace-pre-wrap text-ink">{event.parentResponse}</p> : null}
        {event.reportId ? <Link className="ml-2 text-leaf-deep hover:underline" target="_blank" rel="noopener noreferrer"
          href={`/dashboard/followups/assessments/${registrationId}/reports/${event.reportId}`}>{t(event.reportId === event.sentReportId ? "sentReportVersion" : "reportVersion")}</Link> : null}
      </li>)}
    </ol>}
  </details>;
}
