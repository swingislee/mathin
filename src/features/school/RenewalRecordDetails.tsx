"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarRange, MessagesSquare, Pencil, Signpost } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createTeacherProfessionalSignalAction } from "./actions/renewals";
import { BusinessRecordRevisionButton } from "./BusinessRecordRevisionButton";
import { HistoricalRecordBadge } from "./BusinessRecordStateFilter";
import { businessRecordMessages, isCurrentBusinessRecord, type BusinessRecordState } from "./business-record-state-contract";
import { FollowupEntryFields, FollowupEntryLayout } from "./FollowupEntryFields";
import { FollowupFieldIcon } from "./FollowupFieldIcon";
import { FollowupChoice, followupToneClasses, type FollowupTone } from "./dashboard-page/FollowupChoice";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { FollowupPersonCell } from "./dashboard-page/FollowupPersonCell";
import { inlineEntryCommand } from "./dashboard-page/inline-entry-keyboard";
import { TEACHER_PROFESSIONAL_SIGNAL_TYPES, type TeacherProfessionalSignalType } from "./renewal-contract";
import { renewalHealthLevel, type RenewalHealthSignal } from "./renewal-health-contract";
import type { HealthRuleKey, RenewalHealthPolicy } from "./renewal-health-policy";
import { saveRenewalWorkbenchAction } from "./renewal-workbench-actions";
import { RENEWAL_CONTACT_METHODS, RENEWAL_PANELS, RENEWAL_PAYMENT_METHODS, RENEWAL_RESULTS, RENEWAL_SEASONS,
  renewalDraftIsValid, renewalResult, renewalResultAllowsNextContact, renewalResultCanBeSelected,
  type RenewalPanel, type RenewalPayment, type RenewalResult, type RenewalWorkbenchDraft, type RenewalWorkbenchRecord, type RenewalWorkbenchSaved,
} from "./renewal-workbench-contract";
import { dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";

export interface RenewalPoolRow {
  id: string;
  membershipId: string | null;
  studentId: string;
  name: string;
  phone: string;
  grade: number | null;
  classroom: string;
  teacher: string;
  owner: string;
  stage: string;
  note: string;
  opportunityId: string | null;
  targetCourse: string;
  nextContactAt: string | null;
  updatedAt: string | null;
  record?: RenewalWorkbenchRecord;
  payment?: RenewalPayment;
  recordState?: BusinessRecordState;
}

export const renewalResultTone = (value: string): FollowupTone => ["paid", "registered"].includes(value) ? "healthy"
  : value === "not_enrolled" ? "unhealthy" : ["payment_pending", "nurturing"].includes(value) ? "attention" : "neutral";
const healthTone = (level: string): FollowupTone => level === "attention" ? "unhealthy" : level === "observed" ? "healthy" : "neutral";
const localDateTime = (value: string | null, locale: string) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "—";
const draftFor = (row: RenewalPoolRow): RenewalWorkbenchDraft => ({
  result: renewalResult(row.stage, row.payment) === "unprepared" ? "considering" : renewalResult(row.stage, row.payment) as RenewalResult,
  contactMethod: row.record?.contactMethod ?? null, seasons: row.record?.seasons ?? [],
  note: row.payment?.note ?? row.note, nextContactAt: row.nextContactAt,
  periodCount: row.payment ? String(row.payment.period_count) : "", paidAmount: row.payment ? String(row.payment.paid_amount) : "",
  paidOn: row.record?.paidOn ?? "", paymentMethod: row.record?.paymentMethod ?? null,
});

/** 摘要读取已保存事实；常驻草稿跨阶段、收起和继续下一位保留。 */
export function RenewalEntryRow({ row, cycleId, cycleName, targetTerm, health, healthAvailable, policy, observation, now,
  sampleMode, canWrite, canEnroll, canObserve, active, busy, canAdvance, onBusy, onActivate, onClose, onSaved, onObservationSaved,
}: {
  row: RenewalPoolRow; cycleId: string; cycleName: string; targetTerm: string;
  health: RenewalHealthSignal[]; healthAvailable: boolean; policy: RenewalHealthPolicy; observation?: string; now: number;
  sampleMode: boolean; canWrite: boolean; canEnroll: boolean; canObserve: boolean;
  active: boolean; busy: boolean; canAdvance: boolean; onBusy: (value: boolean) => void;
  onActivate: () => void; onClose: () => void;
  onSaved: (value: RenewalWorkbenchSaved, advance: boolean) => void; onObservationSaved: () => void;
}) {
  const t = useTranslations("school.renewals.workbench");
  const pool = useTranslations("school.renewals.poolV2");
  const legacy = useTranslations("school.renewals");
  const policyT = useTranslations("school.renewals.healthSettings");
  const locale = useLocale(), recordM = businessRecordMessages(locale);
  const historical = !isCurrentBusinessRecord(row.recordState);
  const savedResult = historical ? (row.stage === "enrolled" ? "registered" : row.stage) : renewalResult(row.stage, row.payment);
  const writable = canWrite && (!['registered', 'paid'].includes(savedResult) || canEnroll);
  const [draft, setDraft] = useState(() => draftFor(row));
  const [draftBaseline, setDraftBaseline] = useState(() => draftFor(row));
  const [revision, setRevision] = useState(row.record?.revision ?? 0);
  const [section, setSection] = useState<RenewalPanel>(sampleMode || !canWrite ? "learning" : "communication");
  const [visited, setVisited] = useState(false);
  const [conflict, setConflict] = useState(false);
  const sourceDraft = draftFor(row);
  const sourceKey = JSON.stringify([sourceDraft, row.record?.revision ?? 0]);
  const [acceptedSource, setAcceptedSource] = useState(sourceKey);
  const [observationType, setObservationType] = useState<TeacherProfessionalSignalType>("renewal_recommendation");
  const [observationNote, setObservationNote] = useState("");
  const [savedObservation, setSavedObservation] = useState<string | null>(null);
  const advanceRef = useRef(false);
  const currentObservation = savedObservation ?? observation;
  const paid = draft.result === "paid";
  const nextAllowed = renewalResultAllowsNextContact(draft.result);
  const detailId = `renewal-entry-${row.id}`;
  const valid = renewalDraftIsValid(draft, canEnroll);
  if (acceptedSource !== sourceKey) {
    setAcceptedSource(sourceKey);
    // 只更新未编辑的草稿；未保存修改继续使用原版本，交给并发检查保护。
    if (JSON.stringify(draft) === JSON.stringify(draftBaseline)) {
      setDraft(sourceDraft); setDraftBaseline(sourceDraft); setRevision(row.record?.revision ?? 0); setConflict(false);
    }
  }
  if (active && !visited) setVisited(true);
  const patch = (value: Partial<RenewalWorkbenchDraft>) => setDraft(current => ({ ...current, ...value }));

  const save = useAction(async (input: Parameters<typeof saveRenewalWorkbenchAction>[0]) => {
    onBusy(true);
    try { return await saveRenewalWorkbenchAction(input); }
    catch { return { ok: false as const, code: "UNKNOWN" }; }
    finally { onBusy(false); }
  }, { successMessage: t("saved"), errorMessage: {
    default: legacy("actionFailed"), RENEWAL_WORKBENCH_CONFLICT: t("conflict"),
    INVALID_CYCLE_STATE: legacy("invalidCycleState"), OPPORTUNITY_ENROLLED: t("enrollmentLocked"),
    FORBIDDEN: t("permissionChanged"), FORBIDDEN_SCOPE: t("permissionChanged"),
    COURSE_REQUIRED: legacy("courseRequired"), OWNER_NOT_AVAILABLE: legacy("ownerUnavailable"),
  }, onSuccess: value => {
    setRevision(value.record.revision); setConflict(false);
    const nextDraft = draftFor({ ...row, stage: value.stage, note: value.note, nextContactAt: value.nextContactAt, record: value.record, payment: value.payment ?? undefined });
    setDraft(nextDraft); setDraftBaseline(nextDraft);
    onSaved(value, advanceRef.current);
  }, onError: code => { if (code === "RENEWAL_WORKBENCH_CONFLICT") setConflict(true); } });
  const observe = useAction(async (input: Parameters<typeof createTeacherProfessionalSignalAction>[0]) => {
    onBusy(true);
    try { return await createTeacherProfessionalSignalAction(input); }
    catch { return { ok: false as const, code: "UNKNOWN" }; }
    finally { onBusy(false); }
  }, { successMessage: t("observationSaved"), errorMessage: { default: legacy("actionFailed") }, onSuccess: () => {
    setSavedObservation(observationNote); setObservationNote(""); onObservationSaved();
  } });
  const pending = busy || save.pending || observe.pending;
  const submit = (advance: boolean) => {
    if (!writable || historical || !row.membershipId || pending || !valid || conflict) return;
    advanceRef.current = advance;
    save.run({ cycleId, membershipId: row.membershipId, expectedRevision: revision,
      result: draft.result, note: draft.note, contactMethod: draft.contactMethod, seasons: draft.seasons,
      nextContactAt: nextAllowed ? draft.nextContactAt : null,
      periodCount: paid ? Number(draft.periodCount) : null, paidAmount: paid ? Number(draft.paidAmount) : null,
      paidOn: paid ? draft.paidOn : null, paymentMethod: paid ? draft.paymentMethod : null });
  };
  const submitObservation = () => {
    if (!canObserve || historical || !row.membershipId || pending || !observationNote.trim()) return;
    observe.run({ studentId: row.studentId, sourceMembershipId: row.membershipId, sourceSessionId: null,
      signalType: observationType, recommendation: observationNote, suggestedCourseId: null, targetTermId: null });
  };
  const choose = (value: RenewalResult) => {
    if (!writable || pending || !renewalResultCanBeSelected(value, savedResult, canEnroll)) return;
    patch({ result: value });
    setSection(["registered", "paid"].includes(value) ? "registration" : "communication");
    onActivate();
  };
  const show = (value: RenewalPanel) => { if (!pending) { setSection(value); onActivate(); } };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (pending || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
    const target = event.target as HTMLElement;
    if (target.closest("[role='listbox'],[role='menu'],[role='dialog']")) return;
    if (event.target === event.currentTarget && event.currentTarget.tagName === "TR" && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); if (active) onClose(); else onActivate(); return;
    }
    const command = inlineEntryCommand({ ...event, isComposing: event.nativeEvent.isComposing }, !!target.closest("input,textarea,select,[contenteditable='true'],[role='combobox']"));
    if (command?.type === "choice" && RENEWAL_RESULTS[command.index] && writable) {
      event.preventDefault(); choose(RENEWAL_RESULTS[command.index]);
    } else if (command?.type === "submit" && active) { event.preventDefault(); submit(false); }
  };
  const resultLabel = savedResult === "unknown" ? recordM.outcomeUnknown : t(`result_${savedResult}`);
  const grade = row.grade === null ? "" : t("grade", { grade: row.grade });
  const open = () => { if (!pending) { if (active) onClose(); else onActivate(); } };

  return <>
    <TableRow data-record-state={row.recordState ?? "current"} data-renewal-pool-row={row.id} data-followup-row-key={row.id} aria-busy={pending}
      data-followup-active={active} data-followup-expanded={active} tabIndex={0} aria-expanded={active} aria-controls={detailId}
      className="cursor-pointer [&>td]:px-2 [&>td]:py-2" onKeyDown={keyDown}
      onClick={event => { if (!(event.target as HTMLElement).closest("button,a,input,textarea,select,[role='combobox']")) open(); }}>
      <TableCell className="sticky left-0 z-10 border-r border-line align-top">
        {sampleMode ? <Button size="sm" variant="ghost" className="h-auto whitespace-normal px-1 text-xs" aria-expanded={active} onClick={open}>{row.name}</Button>
          : <FollowupPersonCell name={row.name} phone={row.phone} grade={grade} owner={row.owner} expanded={active} detailsId={detailId} onToggle={open}
            subject={{ studentId: row.studentId, leadId: null }} studentGrade={row.grade} />}
        {historical ? <HistoricalRecordBadge locale={locale} /> : null}
      </TableCell>
      <TableCell className="align-top"><p className="line-clamp-2 leading-5" title={row.classroom}>{row.classroom || "—"}</p><p className="mt-1 truncate text-[11px] text-muted">{row.teacher || t("teacherMissing")}</p></TableCell>
      <TableCell className="align-top"><p className="leading-5">{row.record?.seasons.length ? row.record.seasons.map(value => t(`season_${value}`)).join(" / ") : "—"}</p><p className="mt-1 text-[11px] text-muted">{row.record?.contactMethod ? t(`contact_${row.record.contactMethod}`) : "—"}</p></TableCell>
      <TableCell className="align-top"><Button type="button" size="sm" variant="ghost" disabled={pending} className="h-auto w-full justify-start whitespace-normal px-0 text-left text-xs" onClick={() => show("learning")}>
        <span className="line-clamp-2 leading-5">{currentObservation || (historical ? "—" : pool("noObservation"))}</span></Button>
        {!historical ? <p className={cn("mt-1 text-[11px]", followupToneClasses[healthTone(renewalHealthLevel(health))])}>{healthAvailable ? pool(renewalHealthLevel(health)) : pool("unavailable")}</p> : null}
      </TableCell>
      <TableCell className="align-top"><Badge variant="outline" className={cn("max-w-full whitespace-normal text-[11px]", followupToneClasses[renewalResultTone(savedResult)])}>{resultLabel}</Badge>
        {!historical ? <div className="mt-1.5 flex items-center gap-1" aria-label={t("progress")}>
          {RENEWAL_PANELS.map((value, index) => <Button key={value} type="button" size="sm" variant="ghost" className="size-6 rounded-full p-0 text-[10px]" disabled={pending}
            title={t(`panel_${value}`)} aria-label={t(`panel_${value}`)} onClick={() => show(value)}>
            <span className={cn("flex size-4 items-center justify-center rounded-full border", active && section === value ? "border-crater bg-moon/60" : "border-line text-muted")}>{index + 1}</span>
          </Button>)}
        </div> : null}</TableCell>
      <TableCell className="align-top">{row.payment ? <><p className="font-medium tabular-nums text-leaf-deep">{pool("paidSummary", { periods: row.payment.period_count, amount: Number(row.payment.paid_amount).toFixed(2) })}</p>
        <p className="mt-1 text-[11px] text-muted">{row.record?.paidOn ?? t("paymentDateMissing")}</p><p className="mt-0.5 text-[11px] text-muted">{row.record?.paymentMethod ? t(`payment_${row.record.paymentMethod}`) : t("paymentMethodMissing")}</p></>
        : <span className="text-muted">{savedResult === "registered" ? t("paymentNotRecorded") : "—"}</span>}</TableCell>
      <TableCell className="align-top"><p className={cn("text-[11px] tabular-nums", row.nextContactAt && Date.parse(row.nextContactAt) <= now ? "text-rose" : "text-muted")}>{localDateTime(row.nextContactAt, locale)}</p>
        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11px] leading-5 text-muted" title={row.payment?.note ?? row.note}>{row.payment?.note ?? row.note}</p>
      </TableCell>
    </TableRow>
    <FollowupInlineDetails open={active} keepMounted={visited} hideTitle title={`${row.name} · ${t("details")}`} colSpan={7} id={detailId} pending={pending}
      onOpenChange={value => { if (!value && !pending) onClose(); }} onSubmit={() => submit(false)}>
      <div data-renewal-entry-detail onKeyDown={keyDown}>
        <FollowupEntryLayout data-renewal-detail-layout>
          <FollowupEntryFields id={detailId} layout="stage" note={historical ? row.note : draft.note} onNoteChange={note => patch({ note })}
            noteLabel={t("note")} placeholder={t("notePlaceholder")} readOnly={!writable || historical} pending={pending}
            onSave={submit} saveDisabled={!valid || conflict} canAdvance={canAdvance} saveLabel={t("save")}
            hint={conflict ? t("conflict") : paid && !valid ? t("paymentRequired") : t("keys")}
            reminderContent={<div className="space-y-1.5"><Label htmlFor={`${detailId}-next`} className="text-xs text-muted">{t("nextContact")}</Label>
              {historical ? <p className="text-xs">{localDateTime(row.nextContactAt, locale)}</p> : <DateTimePicker id={`${detailId}-next`} mode="datetime" disabled={!writable || pending || !nextAllowed}
                value={draft.nextContactAt ? zonedDateTimeInputValue(new Date(draft.nextContactAt), "Asia/Shanghai") : ""}
                onValueChange={value => patch({ nextContactAt: value ? dateTimeInputToInstant(value, "Asia/Shanghai")?.toISOString() ?? null : null })}
                className="h-auto min-h-9 w-full whitespace-normal bg-card text-xs" />}
              {!historical && !nextAllowed ? <p className="text-[11px] text-muted">{t("nextContactClosed")}</p> : null}
            </div>}
            tools={historical ? <><BusinessRecordRevisionButton kind="renewal" recordId={row.opportunityId!} subject={row.name} />
              <Link href={`/dashboard/students/${row.studentId}?tab=history&history=renewal`} className="text-xs underline">{recordM.viewStudent}</Link></> : undefined}
            stageHeader={<div data-renewal-detail-header className="col-start-1 row-start-1 min-w-0 space-y-3">
              <div data-renewal-tags className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex min-h-8 items-center gap-2"><FollowupFieldIcon icon={Signpost} label={t("result")} className="fill-moon text-crater" />
                  {historical ? <span className="text-xs">{resultLabel}</span> : <FollowupChoice label={t("result")} value={draft.result} disabled={!writable || pending} className="min-h-8 w-32 py-1"
                    options={RENEWAL_RESULTS.filter(value => value === draft.result || renewalResultCanBeSelected(value, savedResult, canEnroll)).map(value => ({ value, label: `${RENEWAL_RESULTS.indexOf(value) + 1} ${t(`result_${value}`)}`, tone: renewalResultTone(value) }))}
                    onValueChange={value => choose(value as RenewalResult)} />}
                </div>
                <div className="flex min-h-8 items-center gap-2"><FollowupFieldIcon icon={MessagesSquare} label={t("contactMethod")} className="fill-leaf/50 text-leaf-deep" />
                  <FollowupChoice label={t("contactMethod")} value={draft.contactMethod ?? "none"} disabled={!writable || pending || historical} className="min-h-8 w-32 py-1"
                    options={[{ value: "none", label: t("notRecorded") }, ...RENEWAL_CONTACT_METHODS.map(value => ({ value, label: t(`contact_${value}`) }))]}
                    onValueChange={value => patch({ contactMethod: value === "none" ? null : value as RenewalWorkbenchDraft["contactMethod"] })} />
                </div>
                <div className="flex min-h-8 max-w-full flex-wrap items-center gap-2"><FollowupFieldIcon icon={CalendarRange} label={t("seasons")} className="fill-cheek/60 text-crater" />
                  <div role="group" aria-label={t("seasons")} className="flex flex-wrap gap-1">{RENEWAL_SEASONS.map(value => <Button key={value} type="button" size="sm" variant="ghost"
                    className={cn("h-7 min-w-8 rounded-md border px-2 text-xs", draft.seasons.includes(value) ? "border-crater bg-moon/50" : "border-transparent text-muted")}
                    aria-pressed={draft.seasons.includes(value)} disabled={!writable || pending || historical}
                    onClick={() => patch({ seasons: RENEWAL_SEASONS.filter(season => season === value ? !draft.seasons.includes(value) : draft.seasons.includes(season)) })}>{t(`season_${value}`)}</Button>)}</div>
                </div>
              </div>
              <nav aria-label={t("progress")}><ol data-renewal-progress className="flex min-w-0 flex-wrap gap-y-2">
                {RENEWAL_PANELS.map((value, index) => <li key={value} className="flex items-center gap-1.5 text-xs">
                  <Button type="button" size="sm" variant="ghost" disabled={pending} className="h-8 gap-1.5 rounded px-1 text-xs" aria-current={section === value ? "step" : undefined}
                    aria-controls={`${detailId}-${value}`} data-renewal-stage={value} onClick={() => setSection(value)}>
                    <span aria-hidden className={cn("flex size-5 items-center justify-center rounded-full border text-[11px]", section === value ? "border-[var(--followup-outline)] bg-moon/25 ring-2 ring-[var(--followup-outline)]/25" : "border-muted/40 bg-card text-muted")}>{index + 1}</span>
                    <span className={section === value ? "font-medium text-ink" : "text-muted"}>{t(`panel_${value}`)}</span>
                  </Button>{index < RENEWAL_PANELS.length - 1 ? <span aria-hidden className="mx-1 w-5 border-t border-dashed border-muted/40" /> : null}
                </li>)}
              </ol></nav>
            </div>}>
            <section id={`${detailId}-learning`} data-renewal-panel="learning" hidden={section !== "learning"} className="space-y-4">
              <div><h3 className="text-xs font-medium">{pool("recommendation")}</h3><p className="mt-2 whitespace-pre-wrap text-xs leading-6">{currentObservation || pool("noObservation")}</p></div>
              {canObserve && !historical ? <div data-renewal-teacher-entry className="space-y-2" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing && !event.repeat) { event.preventDefault(); event.stopPropagation(); submitObservation(); } }}>
                <Label className="text-xs" htmlFor={`${detailId}-observation`}>{pool("observe")}</Label>
                <FollowupChoice label={pool("signalType")} value={observationType} disabled={pending} className="w-44"
                  options={TEACHER_PROFESSIONAL_SIGNAL_TYPES.map(value => ({ value, label: legacy(`signalType_${value}`) }))} onValueChange={value => setObservationType(value as TeacherProfessionalSignalType)} />
                <Textarea id={`${detailId}-observation`} value={observationNote} rows={3} maxLength={2000} disabled={pending} className="bg-card text-sm" onChange={event => setObservationNote(event.target.value)} />
                <Button type="button" size="sm" variant="secondary" disabled={pending || !observationNote.trim()} onClick={submitObservation}><Pencil className="size-3.5" />{t("saveObservation")}</Button>
              </div> : null}
              {!historical ? <div className="space-y-2"><h3 className="text-xs font-medium">{pool("healthTitle")}</h3><p className="text-[11px] text-muted">{policyT("windowHint", { days: policy.windowDays })}</p>
                {!healthAvailable ? <p className="text-xs text-muted">{pool("unavailable")}</p> : <div className="grid gap-x-5 gap-y-3 @[34rem]/followup-entry:grid-cols-2">{health.map(signal => <div key={signal.key} className="min-w-0 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2"><span>{pool(signal.key)}</span><Badge variant="outline" className={cn("text-[10px]", followupToneClasses[healthTone(signal.level)])}>{pool(signal.level)}</Badge></div>
                  {signal.key !== "unavailable" ? <><p className="text-[11px]">{policyT(`facts_${signal.key}`, { count: signal.count ?? 0, total: signal.total ?? 0 })}</p>
                    <p className="text-[11px] leading-5 text-muted">{policyT(`condition_${signal.key}`, { min: policy.rules[signal.key as HealthRuleKey].minSamples, threshold: policy.rules[signal.key as HealthRuleKey].threshold })}</p></> : null}
                </div>)}</div>}
              </div> : null}
            </section>
            <section id={`${detailId}-communication`} data-renewal-panel="communication" hidden={section !== "communication"} className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-xs"><div><dt className="text-muted">{t("sourceClass")}</dt><dd className="mt-1 leading-5">{row.classroom || "—"}</dd></div>
                <div><dt className="text-muted">{t("teacher")}</dt><dd className="mt-1">{row.teacher || "—"}</dd></div><div><dt className="text-muted">{pool("owner")}</dt><dd className="mt-1">{row.owner || "—"}</dd></div>
                <div><dt className="text-muted">{t("targetTerm")}</dt><dd className="mt-1">{historical ? "—" : targetTerm || "—"}</dd></div></dl>
              <div><h3 className="text-xs font-medium">{t("communicationFocus")}</h3><p className="mt-2 text-xs leading-6 text-muted">{t(`hint_${draft.result}`)}</p></div>
              {currentObservation ? <div><h3 className="text-xs font-medium">{pool("recommendation")}</h3><p className="mt-2 whitespace-pre-wrap text-xs leading-6">{currentObservation}</p></div> : null}
            </section>
            <section id={`${detailId}-registration`} data-renewal-panel="registration" hidden={section !== "registration"} className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-xs"><div><dt className="text-muted">{pool("cycle")}</dt><dd className="mt-1">{historical ? "—" : cycleName || "—"}</dd></div>
                <div><dt className="text-muted">{legacy("targetCourse")}</dt><dd className="mt-1">{row.targetCourse || "—"}</dd></div></dl>
              <p className="text-xs leading-6 text-muted">{t("registrationScope")}</p>
              {paid && !historical ? <div data-renewal-payment-fields className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label htmlFor={`${detailId}-periods`} className="text-xs">{pool("periods")}</Label><Input id={`${detailId}-periods`} type="number" min={1} max={24} step={1} value={draft.periodCount} disabled={!writable || pending} className="h-9 bg-card text-xs" onChange={event => patch({ periodCount: event.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor={`${detailId}-amount`} className="text-xs">{pool("amount")}</Label><Input id={`${detailId}-amount`} type="number" min="0.01" max="1000000" step="0.01" value={draft.paidAmount} disabled={!writable || pending} className="h-9 bg-card text-xs" onChange={event => patch({ paidAmount: event.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor={`${detailId}-paidOn`} className="text-xs">{t("paidOn")}</Label><DateTimePicker id={`${detailId}-paidOn`} mode="date" value={draft.paidOn} disabled={!writable || pending} onValueChange={value => patch({ paidOn: value })} className="h-9 bg-card text-xs" /></div>
                <div className="space-y-1.5"><Label className="text-xs">{t("paymentMethod")}</Label><FollowupChoice label={t("paymentMethod")} value={draft.paymentMethod ?? "none"} disabled={!writable || pending} className="min-h-9 w-full"
                  options={[{ value: "none", label: t("notRecorded") }, ...RENEWAL_PAYMENT_METHODS.map(value => ({ value, label: t(`payment_${value}`) }))]}
                  onValueChange={value => patch({ paymentMethod: value === "none" ? null : value as RenewalWorkbenchDraft["paymentMethod"] })} /></div>
              </div> : <p className="text-xs leading-6">{historical ? resultLabel : t(`hint_${draft.result}`)}</p>}
              {savedResult === "registered" || savedResult === "paid" ? <p className="text-[11px] leading-5 text-muted">{t("enrollmentLocked")}</p> : null}
            </section>
          </FollowupEntryFields>
        </FollowupEntryLayout>
      </div>
    </FollowupInlineDetails>
  </>;
}
