"use client";

import { useDashboardSearchQuery } from "./dashboard-page/DashboardPreferenceScope";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronUp, FlaskConical, Pencil, SlidersHorizontal } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createTeacherProfessionalSignalAction, setRenewalCycleStatusAction, snapshotRenewalCycleMembershipsAction } from "./actions/renewals";
import { DashboardPage, DashboardCommandPanel, DashboardCommandState, DashboardCommandFilters, DashboardCommandActions, DashboardTableShell, DashboardTableColumnHeader } from "./dashboard-page";
import { FollowupChoice, followupToneClasses, type FollowupTone } from "./dashboard-page/FollowupChoice";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { inlineEntryCommand } from "./dashboard-page/inline-entry-keyboard";
import { useDashboardTableView } from "./dashboard-page/useDashboardTableView";
import { FilterSearchInput } from "./FilterBar";
import { FollowupTabs } from "./FollowupTabs";
import { renewalHealthLevel, renewalHealthSignals, type RenewalHealthSignal } from "./renewal-health-contract";
import { type HealthRuleKey, type RenewalHealthPolicy } from "./renewal-health-policy";
import { renewalHealthSamples } from "./renewal-health-samples";
import { RenewalHealthSettings } from "./RenewalHealthSettings";
import { registerRenewalResultAction } from "./renewal-pool-actions";
import type { RenewalPoolSupplement } from "./renewal-pool-data";
import { TEACHER_PROFESSIONAL_SIGNAL_TYPES, type TeacherProfessionalSignalType } from "./renewal-contract";
import type { RenewalWorkspaceData } from "./renewals";
import { CreateCycleDialog } from "./RenewalPoolWorkspace";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { Student360Trigger } from "./Student360Sheet";

type PoolRow = {
  membershipId: string; studentId: string; name: string; grade: number | null;
  classroom: string; owner: string; stage: string; note: string; opportunityId: string | null;
};
const RESULT_STAGES = ["considering", "payment_pending", "enrolled", "not_enrolled", "nurturing"] as const;
type ResultStage = typeof RESULT_STAGES[number];
type ActiveEntry = { membershipId: string; kind: "registration" | "observation" | "health"; focus?: boolean };
type Payment = RenewalPoolSupplement["payments"][number];
const isResultStage = (stage: string): stage is ResultStage => RESULT_STAGES.includes(stage as ResultStage);
const levelFor = renewalHealthLevel;
const resultTone = (stage: string): FollowupTone => stage === "enrolled" ? "healthy" : stage === "not_enrolled" ? "unhealthy" : stage === "payment_pending" ? "healthy" : stage === "nurturing" ? "attention" : "neutral";
const healthTone = (level: string): FollowupTone => level === "attention" ? "unhealthy" : level === "observed" ? "healthy" : "neutral";

export function RenewalStudentPool({ data, supplement, canWrite, canReview, canEnroll, settings = false, allowHealthSamples = false, healthSampleMode = false }: {
  data: RenewalWorkspaceData; supplement: RenewalPoolSupplement;
  canWrite: boolean; canReview: boolean; canEnroll: boolean; settings?: boolean; health?: boolean;
  allowHealthSamples?: boolean; healthSampleMode?: boolean;
}) {
  const t = useTranslations("school.renewals.poolV2");
  const legacy = useTranslations("school.renewals");
  const policyT = useTranslations("school.renewals.healthSettings");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useDashboardSearchQuery("renewals");
  const [entry, setEntry] = useState<ActiveEntry | null>(null);
  const [entryBusy, setEntryBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(settings);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [sampleMode, setSampleMode] = useState(allowHealthSamples && healthSampleMode);
  const [policyUpdate, setPolicyUpdate] = useState<{ policy: RenewalHealthPolicy; revision: number } | null>(null);
  const latestPolicy = policyUpdate && policyUpdate.revision >= supplement.healthPolicyRevision ? policyUpdate : { policy: supplement.healthPolicy, revision: supplement.healthPolicyRevision };
  const policy = latestPolicy.policy;
  const [createOpen, setCreateOpen] = useState(false);
  const [closeCycleOpen, setCloseCycleOpen] = useState(false);
  const cycle = data.cycles.find(row => row.id === data.selectedCycleId);
  const samples = renewalHealthSamples(supplement.now);
  const healthFacts = sampleMode ? samples.map(sample => sample.facts) : supplement.health;
  const facts = new Map(healthFacts.map(row => [row.studentId, row]));
  const payments = new Map(supplement.payments.map(row => [row.opportunity_id, row]));
  const signalsFor = (row: PoolRow) => renewalHealthSignals(facts.get(row.studentId), supplement.now, policy);
  const rows: PoolRow[] = [
    ...data.candidates.map(row => ({ membershipId: row.membershipId, studentId: row.studentId, name: row.studentName, grade: row.grade, classroom: row.classroomName, owner: row.currentOwnerName, stage: "unprepared", note: "", opportunityId: null })),
    ...data.opportunities.filter(row => row.opportunityType === "renewal" && row.cycleId === cycle?.id && row.sourceMembershipId).map(row => ({ membershipId: row.sourceMembershipId!, studentId: row.studentId, name: row.studentName, grade: row.grade, classroom: row.sourceClassroomName, owner: row.ownerName, stage: row.stage, note: row.note, opportunityId: row.id })),
  ];
  const stageLabel = (row: PoolRow) => row.stage === "enrolled" && !payments.has(row.opportunityId ?? "") ? legacy("stage_enrolled") : row.stage === "unprepared" ? t("unprepared") : isResultStage(row.stage) ? t(row.stage) : legacy("stage_" + row.stage);
  const displayRows: PoolRow[] = sampleMode ? samples.map((sample, index) => ({ membershipId: sample.facts.studentId, studentId: sample.facts.studentId, name: policyT("sampleName", { number: index + 1, scenario: policyT("sample_" + sample.key) }), grade: null, classroom: policyT("sampleClass"), owner: "—", stage: "unprepared", note: "", opportunityId: null })) : rows;
  const filtered = displayRows.filter(row => [row.name, row.classroom, row.owner].some(value => value.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))));
  const columns = {
    name: { filterValues: (row: PoolRow) => ({ value: row.studentId, label: row.name }), sortValue: (row: PoolRow) => row.name },
    classroom: { filterValues: (row: PoolRow) => ({ value: row.classroom, label: row.classroom }), sortValue: (row: PoolRow) => row.classroom },
    owner: { filterValues: (row: PoolRow) => ({ value: row.owner || "none", label: row.owner || "—" }), sortValue: (row: PoolRow) => row.owner },
    stage: { filterValues: (row: PoolRow) => ({ value: row.stage === "enrolled" && payments.has(row.opportunityId ?? "") ? "paid" : row.stage, label: stageLabel(row) }), sortValue: (row: PoolRow) => row.stage },
    health: { filterValues: (row: PoolRow) => ({ value: levelFor(signalsFor(row)), label: t(levelFor(signalsFor(row))) }), sortValue: (row: PoolRow) => signalsFor(row).filter(signal => signal.level === "attention").length },
  };
  const table = useDashboardTableView({ rows: filtered, columns, locale, persistenceKey: "followup-renewals" });
  const errors = { default: legacy("actionFailed") };
  const refresh = useAction(snapshotRenewalCycleMembershipsAction, { successMessage: result => legacy("snapshotSuccess", result), errorMessage: errors, onSuccess: () => router.refresh() });
  const status = useAction(setRenewalCycleStatusAction, { successMessage: legacy("cycleStatusSaved"), errorMessage: errors, onSuccess: () => { setCloseCycleOpen(false); router.refresh(); } });

  return <DashboardPage title={legacy("title")} density="compact" commandPanel={<DashboardCommandPanel>
    <DashboardCommandState><FollowupTabs /><span className="whitespace-nowrap text-xs text-muted">{legacy("view_all")} {rows.length} · {t("enrolled")} {rows.filter(row => row.stage === "enrolled").length} · {t("attention")} {rows.filter(row => levelFor(signalsFor(row)) === "attention").length}</span></DashboardCommandState>
    <DashboardCommandFilters><FilterSearchInput aria-label={t("search")} placeholder={t("search")} value={query} disabled={entryBusy} onChange={event => setQuery(event.target.value)} /></DashboardCommandFilters>
    <DashboardCommandActions>
      <Button size="sm" variant="ghost" disabled={entryBusy} onClick={() => setSettingsOpen(true)}><SlidersHorizontal className="size-4" />{t("settings")}</Button>
      <Link href="/dashboard/followups/renewals/growth" className={buttonVariants({ size: "sm", variant: "ghost" })}>{legacy("reactivationAndReferrals")}</Link>
      <Link href="/dashboard/followups/renewals/signals" className={buttonVariants({ size: "sm", variant: "ghost" })}>{legacy("teacherSignals")}</Link>
    </DashboardCommandActions>
  </DashboardCommandPanel>}>
    <DashboardTableShell><Table className="min-w-[72rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-11rem)] overflow-auto">
      <colgroup><col className="w-40" /><col className="w-36" /><col className="w-24" /><col className="w-28" /><col className="w-40" /><col className="w-36" /><col /></colgroup>
      <TableHeader className="sticky top-0 z-20 bg-card" inert={entryBusy || undefined}><TableRow className="[&>th]:h-9 [&>th]:px-2">
        <TableHead><DashboardTableColumnHeader label={t("student")} {...table.columnProps("name")} /></TableHead>
        <TableHead><DashboardTableColumnHeader label={t("classroom")} {...table.columnProps("classroom")} /></TableHead>
        <TableHead><DashboardTableColumnHeader label={t("owner")} {...table.columnProps("owner")} /></TableHead>
        <TableHead><DashboardTableColumnHeader label={t("health")} {...table.columnProps("health")} /></TableHead>
        <TableHead>{t("observation")}</TableHead>
        <TableHead><DashboardTableColumnHeader label={t("result")} {...table.columnProps("stage")} /></TableHead>
        <TableHead>{t("details")}</TableHead>
      </TableRow></TableHeader>
      <TableBody>{table.visibleRows.map(row => <RenewalEntryRow key={(cycle?.id ?? "") + "-" + row.membershipId}
        row={row} cycleId={cycle?.id ?? ""} stageLabel={stageLabel(row)} payment={payments.get(row.opportunityId ?? "")}
        health={signalsFor(row)} policy={policy} sampleMode={sampleMode}
        observation={supplement.signals.find(item => item.student_id === row.studentId)?.recommendation}
        canWrite={!sampleMode && canWrite && cycle?.status === "open"} canEnroll={canEnroll}
        canObserve={!sampleMode && canReview && supplement.observationMemberships.includes(row.membershipId)}
        entry={entry?.membershipId === row.membershipId ? entry : null} busy={entryBusy} onBusy={setEntryBusy}
        onActivate={(kind, focus = false) => { if (!entryBusy) setEntry({ membershipId: row.membershipId, kind, focus }); }}
        onClose={() => setEntry(null)} onSaved={advance => {
          const index = table.visibleRows.findIndex(item => item.membershipId === row.membershipId);
          const next = advance ? table.visibleRows.slice(index + 1).find(item => ["unprepared", "planning", "contacted", "considering", "payment_pending"].includes(item.stage)) : undefined;
          setEntry(next ? { membershipId: next.membershipId, kind: "registration", focus: true } : null);
          window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); router.refresh();
        }}
      />)}{!table.visibleRows.length ? <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted">{t("noRows")}</TableCell></TableRow> : null}</TableBody>
    </Table></DashboardTableShell>
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="sm:max-w-3xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{t("settings")}</DialogTitle></DialogHeader>
      <div className="space-y-5"><Label className="block">{t("cycle")}<FollowupChoice label={t("cycle")} value={cycle?.id ?? ""} onValueChange={id => router.replace("/dashboard/followups/renewals?cycle=" + id)} options={data.cycles.map(item => ({ value: item.id, label: item.name }))} className="mt-2 w-full" /></Label>
        {cycle ? <><p className="text-sm">{cycle.sourceTermName} → {cycle.targetTermName}</p><p className="text-xs text-muted">{legacy("cycleStatus_" + cycle.status)} · {cycle.preparationStartsOn || "—"} — {cycle.decisionDueOn || "—"}</p></> : null}
        <div className="flex flex-wrap gap-2">{canWrite ? <>
          {cycle && cycle.status !== "closed" ? <Button size="sm" variant="secondary" disabled={refresh.pending} onClick={() => refresh.run(cycle.id)}>{t("refresh")}</Button> : null}
          {cycle?.status === "planning" ? <Button size="sm" disabled={status.pending} onClick={() => status.run(cycle.id, "open")}>{legacy("openCycle")}</Button> : null}
          {cycle?.status === "open" ? <Button size="sm" variant="secondary" onClick={() => setCloseCycleOpen(true)}>{t("closeCycle")}</Button> : null}
          <CreateCycleDialog open={createOpen} onOpenChange={setCreateOpen} terms={data.terms} errors={errors} onSaved={() => router.refresh()} />
          {cycle ? <Button size="sm" variant="secondary" onClick={() => setPolicyOpen(true)}>{policyT("title")}</Button> : null}
        </> : null}{allowHealthSamples ? <Button size="sm" variant="ghost" onClick={() => { setSampleMode(value => !value); setSettingsOpen(false); }}><FlaskConical className="size-4" />{policyT(sampleMode ? "showStudents" : "showSamples")}</Button> : null}</div>
      </div>
    </DialogContent></Dialog>
    <ConfirmDialog open={closeCycleOpen} onOpenChange={setCloseCycleOpen} title={legacy("closeCycleTitle")} description={legacy("closeCycleDescription")} confirmLabel={legacy("closeCycleConfirm")} cancelLabel={t("cancel")} pending={status.pending} onConfirm={() => cycle && status.run(cycle.id, "closed")} />
    {policyOpen && cycle ? <RenewalHealthSettings key={latestPolicy.revision} open onOpenChange={setPolicyOpen} cycleId={cycle.id} cycleName={cycle.name} policy={policy} revision={latestPolicy.revision} facts={healthFacts} now={supplement.now} sampleMode={sampleMode} onSaved={(value, revision) => setPolicyUpdate({ policy: value, revision })} /> : null}
  </DashboardPage>;
}

function RenewalEntryRow({ row, cycleId, stageLabel, payment, observation, canWrite, canEnroll, canObserve, entry, busy, onBusy, onActivate, onClose, onSaved, health, policy, sampleMode }: {
  row: PoolRow; cycleId: string; stageLabel: string; payment?: Payment; observation?: string;
  health: RenewalHealthSignal[]; policy: RenewalHealthPolicy; sampleMode: boolean;
  canWrite: boolean; canEnroll: boolean; canObserve: boolean; entry: ActiveEntry | null; busy: boolean;
  onBusy: (busy: boolean) => void; onActivate: (kind: ActiveEntry["kind"], focus?: boolean) => void;
  onClose: () => void; onSaved: (advance: boolean) => void;
}) {
  const t = useTranslations("school.renewals.poolV2");
  const legacy = useTranslations("school.renewals");
  const policyT = useTranslations("school.renewals.healthSettings");
  const [stage, setStage] = useState<ResultStage>(isResultStage(row.stage) ? row.stage : "considering");
  const [note, setNote] = useState(payment?.note ?? row.note);
  const [periods, setPeriods] = useState(payment ? String(payment.period_count) : "");
  const [amount, setAmount] = useState(payment ? String(payment.paid_amount) : "");
  const [observationType, setObservationType] = useState<TeacherProfessionalSignalType>("churn_risk");
  const [observationNote, setObservationNote] = useState("");
  const [saved, setSaved] = useState<{ stage: ResultStage; payment?: Payment } | null>(null);
  const [savedObservation, setSavedObservation] = useState<string | null>(null);
  const advanceRef = useRef(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const registering = entry?.kind === "registration";
  const observing = entry?.kind === "observation";
  const viewingHealth = entry?.kind === "health";
  const paid = stage === "enrolled";
  const currentStage = saved?.stage ?? row.stage;
  const currentPayment = saved ? saved.payment : payment;
  const currentObservation = savedObservation ?? observation;
  const currentLabel = saved ? t(saved.stage) : stageLabel;
  const valid = !paid || (canEnroll && Number.isInteger(Number(periods)) && Number(periods) >= 1 && Number(periods) <= 24 && Number(amount) > 0 && Number.isFinite(Number(amount)));
  const run = useAction(async (input: Parameters<typeof registerRenewalResultAction>[0]) => {
    onBusy(true);
    try { return await registerRenewalResultAction(input); } finally { onBusy(false); }
  }, { successMessage: legacy("opportunitySaved"), errorMessage: { default: legacy("actionFailed"), INVALID_CYCLE_STATE: legacy("invalidCycleState") }, onSuccess: () => {
    setSaved({ stage, payment: paid ? { opportunity_id: row.opportunityId ?? "", period_count: Number(periods), paid_amount: Number(amount), note } : undefined });
    onSaved(advanceRef.current);
  } });
  const observe = useAction(async (input: Parameters<typeof createTeacherProfessionalSignalAction>[0]) => {
    onBusy(true);
    try { return await createTeacherProfessionalSignalAction(input); } finally { onBusy(false); }
  }, { successMessage: legacy("opportunitySaved"), errorMessage: { default: legacy("actionFailed") }, onSuccess: () => {
    setSavedObservation(observationNote);
    setObservationNote("");
    onSaved(false);
  } });

  useEffect(() => {
    if (!entry?.focus || entry.kind === "health") return;
    const target = detailRef.current?.querySelector<HTMLElement>("input, textarea");
    target?.focus({ preventScroll: true });
  }, [entry?.focus, entry?.kind, paid]);

  const submit = (advance: boolean) => {
    if (busy || run.pending || !canWrite || !valid) return;
    advanceRef.current = advance;
    run.run({ cycleId, membershipId: row.membershipId, stage, note, periodCount: paid ? Number(periods) : null, paidAmount: paid ? Number(amount) : null });
  };
  const submitObservation = () => {
    if (busy || observe.pending || !canObserve || !observationNote.trim()) return;
    observe.run({ studentId: row.studentId, sourceMembershipId: row.membershipId, sourceSessionId: null, signalType: observationType, recommendation: observationNote, suggestedCourseId: null, targetTermId: null });
  };
  const chooseStage = (value: ResultStage) => {
    if (busy || !canWrite || (value === "enrolled" && !canEnroll) || (currentStage === "enrolled" && value !== "enrolled")) return;
    setStage(value);
    onActivate("registration", value === "enrolled");
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (busy || event.defaultPrevented || event.nativeEvent.isComposing || event.repeat) return;
    const target = event.target as HTMLElement;
    if (target.closest("[role='listbox'], [role='menu'], [role='dialog']")) return;
    if (event.target === event.currentTarget && event.currentTarget.tagName === "TR" && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (entry) onClose(); else onActivate(canWrite ? "registration" : "health");
      return;
    }
    const command = inlineEntryCommand({ ...event, isComposing: event.nativeEvent.isComposing }, !!target.closest("input, textarea, select, [contenteditable='true'], [role='combobox']"));
    if (command?.type === "choice" && !observing && RESULT_STAGES[command.index]) {
      event.preventDefault();
      chooseStage(RESULT_STAGES[command.index]);
    } else if (command?.type === "submit" && entry && !viewingHealth) {
      event.preventDefault();
      if (observing) submitObservation(); else submit(true);
    } else if (command?.type === "close" && entry && event.currentTarget.tagName === "TR") {
      event.preventDefault();
      onClose();
    }
  };
  const displayedStage = registering ? stage : currentStage;
  const detailId = "renewal-entry-" + row.membershipId;

  return <>
    <TableRow data-renewal-pool-row={row.membershipId} tabIndex={0} aria-selected={!!entry} aria-expanded={!!entry} aria-controls={entry ? detailId : undefined}
      className={cn("h-10 cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-crater [&>td]:px-2 [&>td]:py-1", entry && "bg-moon/15 hover:bg-moon/15")} onKeyDown={handleKeyDown} onClick={(event) => {
        if (busy || (event.target as HTMLElement).closest("button,a,input,textarea,select,[role='combobox'],[role='checkbox']")) return;
        if (entry) onClose(); else onActivate(canWrite ? "registration" : "health");
      }}>
      <TableCell><div className="flex min-w-0 items-center gap-1">
        <Button type="button" size="sm" variant="ghost" className="size-6 shrink-0 p-0" aria-label={entry ? t("close") : t("details")} aria-expanded={!!entry} disabled={busy} onClick={() => entry ? onClose() : onActivate(canWrite ? "registration" : "health")}>
          {entry ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </Button>{sampleMode ? <span className="truncate">{row.name}</span> : <Student360Trigger className="truncate" subject={{ studentId: row.studentId, leadId: null }} fallback={{ name: row.name, grade: row.grade }} />}
      </div></TableCell>
      <TableCell className="truncate" title={row.classroom}>{row.classroom}</TableCell><TableCell className="truncate" title={row.owner}>{row.owner || "—"}</TableCell>
      <TableCell><Button size="sm" variant="ghost" className={cn("h-7 w-full truncate px-1 text-xs", followupToneClasses[healthTone(levelFor(health))])} disabled={busy} aria-expanded={viewingHealth} onClick={() => viewingHealth ? onClose() : onActivate("health")}>{t(levelFor(health))}</Button></TableCell>
      <TableCell>{canObserve ? <Button type="button" size="sm" variant="ghost" className={cn("h-8 w-full justify-start gap-1 rounded-md px-1 text-xs", observing && "bg-moon/50 text-ink")} disabled={busy} aria-label={row.name + " · " + t("observe")} aria-expanded={observing} title={currentObservation} onClick={() => observing ? onClose() : onActivate("observation", true)}>
        <Pencil className="size-3 shrink-0" /><span className="truncate">{currentObservation || t("observe")}</span>
      </Button> : <p className="truncate text-muted" title={currentObservation}>{currentObservation || t("noObservation")}</p>}</TableCell>
      <TableCell>{canWrite ? <FollowupChoice value={displayedStage} onValueChange={value => chooseStage(value as ResultStage)} label={row.name + " · " + t("result")} disabled={busy} className="w-full" options={RESULT_STAGES.filter(value => (value !== "enrolled" || canEnroll) && (currentStage !== "enrolled" || value === "enrolled")).map((value) => ({ value, label: t(value), tone: resultTone(value) }))} /> : <Badge variant="outline" className={followupToneClasses[resultTone(currentStage)]}>{currentLabel}</Badge>}</TableCell>
      <TableCell><div className="flex min-w-0 items-center gap-2">
        {!isResultStage(currentStage) ? <span className="shrink-0 text-[10px] text-muted">{currentLabel}</span> : null}
        {currentPayment ? <span className="shrink-0 text-[11px] font-medium text-leaf-deep">{t("paidSummary", { periods: currentPayment.period_count, amount: Number(currentPayment.paid_amount).toFixed(2) })}</span> : null}
        <Button size="sm" variant="ghost" className="h-8 min-w-0 flex-1 justify-start px-1 text-xs" disabled={busy || !canWrite} onClick={() => onActivate("registration", true)} aria-label={row.name + " · " + t("details")} aria-expanded={registering} title={note || currentLabel}><span className="truncate">{note || t("details")}</span><Pencil className="size-3 shrink-0" /></Button>
        {canWrite ? <Button size="sm" variant="ghost" className="size-7 shrink-0 p-0" aria-label={t("save")} title={t("save") + " · Ctrl/⌘ + Enter"} aria-keyshortcuts="Control+Enter Meta+Enter" disabled={busy || !valid || !registering} onClick={() => submit(false)}><Check className="size-3.5" /></Button> : null}
      </div></TableCell>
    </TableRow>
    <FollowupInlineDetails open={!!entry} onOpenChange={open => { if (!open && !busy) onClose(); }} title={row.name + " · " + (viewingHealth ? t("health") : observing ? t("observe") : t("details"))} colSpan={7} pending={busy} autoFocus={!!entry?.focus} onSubmit={viewingHealth ? undefined : () => observing ? submitObservation() : submit(true)} id={detailId}>
      <div ref={detailRef} data-renewal-entry-detail onKeyDown={handleKeyDown} inert={busy || undefined}>
        {viewingHealth ? <>
          <p className="mb-3 text-xs text-muted">{policyT("windowHint", { days: policy.windowDays })}</p>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">{health.map(signal => <div key={signal.key} className="min-w-0 space-y-1 text-xs">
            <div className="flex items-center justify-between gap-2"><strong>{t(signal.key)}</strong><Badge variant="outline" className={followupToneClasses[healthTone(signal.level)]}>{t(signal.level)}</Badge></div>
            {signal.key !== "unavailable" ? <><p>{policyT("facts_" + signal.key, { count: signal.count ?? 0, total: signal.total ?? 0 })}</p><p className="leading-5 text-muted">{policyT("condition_" + signal.key, { min: policy.rules[signal.key as HealthRuleKey].minSamples, threshold: policy.rules[signal.key as HealthRuleKey].threshold })}</p><p className="leading-5 text-muted">{policyT("coverage_" + signal.key)}</p></> : null}
          </div>)}</div>
        </> : <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">{observing ? <div className="grid items-start gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
            <Label className="block text-xs">{t("signalType")}<FollowupChoice label={t("signalType")} value={observationType} onValueChange={value => setObservationType(value as TeacherProfessionalSignalType)} options={TEACHER_PROFESSIONAL_SIGNAL_TYPES.map(value => ({ value, label: legacy("signalType_" + value), tone: value === "churn_risk" ? "unhealthy" : "healthy" }))} className="mt-1 w-full" /></Label>
            <Label className="block text-xs">{t("recommendation")}<Textarea className="mt-1 min-h-20 text-xs" rows={3} value={observationNote} maxLength={2000} onChange={event => setObservationNote(event.target.value)} /></Label>
          </div> : <div className="grid items-start gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="space-y-3"><Label className="block text-xs">{t("result")}<FollowupChoice label={t("result")} value={stage} onValueChange={value => chooseStage(value as ResultStage)} options={RESULT_STAGES.filter(value => (value !== "enrolled" || canEnroll) && (currentStage !== "enrolled" || value === "enrolled")).map(value => ({ value, label: t(value), tone: resultTone(value) }))} className="mt-1 w-full" /></Label>
              {paid ? <div className="grid grid-cols-2 gap-3"><Label className="block text-xs">{t("periods")}<Input className="mt-1 h-8 text-xs" type="number" min={1} max={24} step={1} value={periods} onChange={event => setPeriods(event.target.value)} /></Label><Label className="block text-xs">{t("amount")}<Input className="mt-1 h-8 text-xs" type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></Label></div> : null}
            </div>
            <Label className="block text-xs">{t("note")}<Textarea className="mt-1 min-h-20 text-xs" rows={3} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></Label>
          </div>}</div>
          <div className="flex flex-col gap-3 border-line xl:border-l xl:pl-5">
            {observing ? <Button size="sm" disabled={busy || !observationNote.trim()} onClick={submitObservation}><Check className="size-4" />{t("save")}</Button> : <><Button size="sm" disabled={busy || !valid} onClick={() => submit(true)}><Check className="size-4" />{t("action_" + stage)}</Button><Button size="sm" variant="ghost" disabled={busy || !valid} onClick={() => submit(false)}>{t("save")}</Button></>}
            <p className="text-[11px] leading-5 text-muted">{observing ? t("observationKeys") : t("quickKeys")}</p>
          </div>
        </div>}
      </div>
    </FollowupInlineDetails>
  </>;
}
