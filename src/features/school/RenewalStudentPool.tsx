"use client";

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronUp, Pencil, Search } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createTeacherProfessionalSignalAction, setRenewalCycleStatusAction, snapshotRenewalCycleMembershipsAction } from "./actions/renewals";
import { DashboardPage, DashboardCommandPanel, DashboardCommandState, DashboardCommandFilters, DashboardCommandActions, DashboardSection, DashboardTableShell, DashboardTableColumnHeader } from "./dashboard-page";
import { DashboardInlineEntry } from "./dashboard-page/DashboardInlineEntry";
import { inlineEntryCommand } from "./dashboard-page/inline-entry-keyboard";
import { useDashboardTableView } from "./dashboard-page/useDashboardTableView";
import { renewalHealthSignals, type RenewalHealthSignal } from "./renewal-health-contract";
import { registerRenewalResultAction } from "./renewal-pool-actions";
import type { RenewalPoolSupplement } from "./renewal-pool-data";
import { TEACHER_PROFESSIONAL_SIGNAL_TYPES, type TeacherProfessionalSignalType } from "./renewal-contract";
import type { RenewalWorkspaceData } from "./renewals";
import { RenewalNavTabs } from "./RenewalNavTabs";
import { CreateCycleDialog } from "./RenewalPoolWorkspace";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { Student360Trigger } from "./Student360Sheet";

type PoolRow = {
  membershipId: string; studentId: string; name: string; grade: number | null;
  classroom: string; owner: string; stage: string; note: string; opportunityId: string | null;
};
const RESULT_STAGES = ["considering", "payment_pending", "enrolled", "not_enrolled", "nurturing"] as const;
type ResultStage = typeof RESULT_STAGES[number];
type ActiveEntry = { membershipId: string; kind: "registration" | "observation"; focus?: boolean };
type Payment = RenewalPoolSupplement["payments"][number];
const isResultStage = (stage: string): stage is ResultStage => RESULT_STAGES.includes(stage as ResultStage);
const levelFor = (signals: RenewalHealthSignal[]) => signals.some(signal => signal.level === "attention")
  ? "attention" : signals.some(signal => signal.level === "unknown") ? "unknown" : "observed";

export function RenewalStudentPool({ data, supplement, canWrite, canReview, canEnroll, settings = false, health = false }: {
  data: RenewalWorkspaceData; supplement: RenewalPoolSupplement;
  canWrite: boolean; canReview: boolean; canEnroll: boolean; settings?: boolean; health?: boolean;
}) {
  const t = useTranslations("school.renewals.poolV2");
  const legacy = useTranslations("school.renewals");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [entry, setEntry] = useState<ActiveEntry | null>(null);
  const [entryBusy, setEntryBusy] = useState(false);
  const [healthStudent, setHealthStudent] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [closeCycleOpen, setCloseCycleOpen] = useState(false);
  const cycle = data.cycles.find(row => row.id === data.selectedCycleId);
  const facts = new Map(supplement.health.map(row => [row.studentId, row]));
  const payments = new Map(supplement.payments.map(row => [row.opportunity_id, row]));
  const signalsFor = (row: PoolRow) => renewalHealthSignals(facts.get(row.studentId), supplement.now);
  const rows: PoolRow[] = [
    ...data.candidates.map(row => ({ membershipId: row.membershipId, studentId: row.studentId, name: row.studentName, grade: row.grade, classroom: row.classroomName, owner: row.currentOwnerName, stage: "unprepared", note: "", opportunityId: null })),
    ...data.opportunities.filter(row => row.opportunityType === "renewal" && row.cycleId === cycle?.id && row.sourceMembershipId).map(row => ({ membershipId: row.sourceMembershipId!, studentId: row.studentId, name: row.studentName, grade: row.grade, classroom: row.sourceClassroomName, owner: row.ownerName, stage: row.stage, note: row.note, opportunityId: row.id })),
  ];
  const stageLabel = (row: PoolRow) => row.stage === "enrolled" && !payments.has(row.opportunityId ?? "")
    ? legacy("stage_enrolled") : row.stage === "unprepared" ? t("unprepared") : isResultStage(row.stage) ? t(row.stage) : legacy("stage_" + row.stage);
  const filtered = rows.filter(row => [row.name, row.classroom, row.owner].some(value => value.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))));
  const columns = {
    name: { filterValues: (row: PoolRow) => ({ value: row.studentId, label: row.name }), sortValue: (row: PoolRow) => row.name },
    classroom: { filterValues: (row: PoolRow) => ({ value: row.classroom, label: row.classroom }), sortValue: (row: PoolRow) => row.classroom },
    owner: { filterValues: (row: PoolRow) => ({ value: row.owner || "none", label: row.owner || "—" }), sortValue: (row: PoolRow) => row.owner },
    stage: { filterValues: (row: PoolRow) => ({ value: row.stage === "enrolled" && payments.has(row.opportunityId ?? "") ? "paid" : row.stage, label: stageLabel(row) }), sortValue: (row: PoolRow) => row.stage },
    health: { filterValues: (row: PoolRow) => ({ value: levelFor(signalsFor(row)), label: t(levelFor(signalsFor(row))) }), sortValue: (row: PoolRow) => signalsFor(row).filter(signal => signal.level === "attention").length },
  };
  const table = useDashboardTableView({ rows: filtered, columns, locale });
  const errors = { default: legacy("actionFailed") };
  const refresh = useAction(snapshotRenewalCycleMembershipsAction, { successMessage: result => legacy("snapshotSuccess", result), errorMessage: errors, onSuccess: () => router.refresh() });
  const status = useAction(setRenewalCycleStatusAction, { successMessage: legacy("cycleStatusSaved"), errorMessage: errors, onSuccess: () => { setCloseCycleOpen(false); router.refresh(); } });
  const activeTab = settings ? "settings" : health ? "health" : "pool";

  return <DashboardPage title={t(activeTab)} commandPanel={<DashboardCommandPanel>
    <DashboardCommandState><RenewalNavTabs active={activeTab} cycleId={cycle?.id} /></DashboardCommandState>
    {!settings ? <DashboardCommandFilters><div className="relative w-full max-w-96">
      <Search className="absolute left-3 top-3 size-4 text-muted" />
      <Input aria-label={t("search")} className="pl-9" placeholder={t("search")} value={query} disabled={entryBusy} onChange={event => setQuery(event.target.value)} />
    </div></DashboardCommandFilters> : null}
    {settings && canWrite ? <DashboardCommandActions>
      {cycle && cycle.status !== "closed" ? <Button size="sm" variant="secondary" disabled={refresh.pending} onClick={() => refresh.run(cycle.id)}>{t("refresh")}</Button> : null}
      {cycle?.status === "open" ? <Button size="sm" variant="secondary" onClick={() => setCloseCycleOpen(true)}>{t("closeCycle")}</Button> : null}
      <CreateCycleDialog open={createOpen} onOpenChange={setCreateOpen} terms={data.terms} errors={errors} onSaved={() => router.refresh()} />
    </DashboardCommandActions> : null}
  </DashboardCommandPanel>}>
    {settings ? <>
      <DashboardSection title={t("settings")}><div className="max-w-xl space-y-4">
        <Label>{t("cycle")}<Select value={cycle?.id ?? ""} onValueChange={id => router.replace("/dashboard/renewals?tab=settings&cycle=" + id)}>
          <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{data.cycles.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select></Label>
        {cycle ? <><p>{cycle.sourceTermName} → {cycle.targetTermName}</p><p>{legacy("cycleStatus_" + cycle.status)} · {cycle.preparationStartsOn || "—"} — {cycle.decisionDueOn || "—"}</p>
          {canWrite && cycle.status === "planning" ? <Button disabled={status.pending} onClick={() => status.run(cycle.id, "open")}>{legacy("openCycle")}</Button> : null}
        </> : null}
      </div></DashboardSection>
      <DashboardSection title={t("healthPolicy")} description={t("healthHint")}><dl className="max-w-3xl space-y-4">{["communication", "attendance", "participation", "challenge", "homework", "accuracy", "video", "trend"].map(key => <div key={key}><dt className="font-medium">{t(key)}</dt><dd className="mt-1 text-sm text-muted">{t(key + "Rule")}</dd></div>)}</dl></DashboardSection>
    </> : health ? <DashboardTableShell>
      <Table className="min-w-[56rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
        <colgroup><col className="w-44" /><col className="w-44" /><col className="w-28" /><col className="w-40" /><col /></colgroup>
        <TableHeader className="sticky top-0 z-20 bg-card"><TableRow>
          <TableHead><DashboardTableColumnHeader label={t("student")} {...table.columnProps("name")} /></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("classroom")} {...table.columnProps("classroom")} /></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("owner")} {...table.columnProps("owner")} /></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("health")} {...table.columnProps("health")} /></TableHead>
          <TableHead>{t("healthTitle")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{table.visibleRows.map(row => {
          const signals = signalsFor(row);
          const level = levelFor(signals);
          const expanded = healthStudent === row.membershipId;
          const attention = signals.filter(signal => signal.level === "attention");
          return <Fragment key={row.membershipId}>
            <TableRow className={cn("[&>td]:py-2", expanded && "bg-moon/15 hover:bg-moon/15")}>
              <TableCell><Student360Trigger className="block max-w-full truncate" subject={{ studentId: row.studentId, leadId: null }} fallback={{ name: row.name, grade: row.grade }} /></TableCell>
              <TableCell className="truncate" title={row.classroom}>{row.classroom}</TableCell><TableCell className="truncate" title={row.owner}>{row.owner || "—"}</TableCell>
              <TableCell><Badge variant="outline" className={level === "attention" ? "text-rose" : ""}>{t(level)}{attention.length ? " · " + attention.length : ""}</Badge></TableCell>
              <TableCell><Button size="sm" variant="ghost" className="h-8 w-full justify-start px-0 text-xs" aria-expanded={expanded} onClick={() => setHealthStudent(expanded ? null : row.membershipId)}>
                {expanded ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}<span className="truncate">{attention.length ? attention.map(signal => t(signal.key)).join(" · ") : t("coverage")}</span>
              </Button></TableCell>
            </TableRow>
            {expanded ? <TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="whitespace-normal px-5 py-4">
              <p className="mb-4 text-xs text-muted">{t("healthHint")}</p><div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-4">{signals.map(signal => <div key={signal.key}>
                <div className="flex items-center justify-between gap-2"><strong>{t(signal.key)}</strong><span className={signal.level === "attention" ? "text-rose" : "text-muted"}>{t(signal.level)}</span></div>
                {signal.key !== "unavailable" ? <><p className="mt-1">{t("counts", { count: signal.count ?? 0, total: signal.total ?? 0 })}</p><p className="mt-1 leading-5 text-muted">{t(signal.key + "Rule")}</p></> : null}
              </div>)}</div>
            </TableCell></TableRow> : null}
          </Fragment>;
        })}{!table.visibleRows.length ? <EmptyRows columns={5} /> : null}</TableBody>
      </Table>
    </DashboardTableShell> : <DashboardTableShell>
      <Table className="min-w-[74rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
        <colgroup><col className="w-44" /><col className="w-36" /><col className="w-24" /><col className="w-40" /><col className="w-[22rem]" /><col /></colgroup>
        <TableHeader className="sticky top-0 z-20 bg-card" inert={entryBusy || undefined}><TableRow className="[&>th]:h-9 [&>th]:px-2">
          <TableHead><DashboardTableColumnHeader label={t("student")} {...table.columnProps("name")} /></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("classroom")} {...table.columnProps("classroom")} /></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("owner")} {...table.columnProps("owner")} /></TableHead>
          <TableHead>{t("observation")}</TableHead>
          <TableHead><DashboardTableColumnHeader label={t("result")} {...table.columnProps("stage")} /></TableHead>
          <TableHead>{t("details")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{table.visibleRows.map(row => <RenewalEntryRow key={(cycle?.id ?? "") + "-" + row.membershipId}
          row={row} cycleId={cycle?.id ?? ""} stageLabel={stageLabel(row)} payment={payments.get(row.opportunityId ?? "")}
          observation={supplement.signals.find(item => item.student_id === row.studentId)?.recommendation}
          canWrite={canWrite && cycle?.status === "open"} canEnroll={canEnroll}
          canObserve={canReview && supplement.observationMemberships.includes(row.membershipId)}
          entry={entry?.membershipId === row.membershipId ? entry : null} busy={entryBusy} onBusy={setEntryBusy}
          onActivate={(kind, focus = false) => { if (!entryBusy) setEntry({ membershipId: row.membershipId, kind, focus }); }}
          onClose={() => setEntry(null)} onSaved={advance => {
            const index = table.visibleRows.findIndex(item => item.membershipId === row.membershipId);
            const next = advance ? table.visibleRows.slice(index + 1).find(item => ["unprepared", "planning", "contacted", "considering", "payment_pending"].includes(item.stage)) : undefined;
            setEntry(next ? { membershipId: next.membershipId, kind: "registration", focus: true } : null);
            window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
            router.refresh();
          }}
        />)}{!table.visibleRows.length ? <EmptyRows columns={6} /> : null}</TableBody>
      </Table>
    </DashboardTableShell>}
    <ConfirmDialog open={closeCycleOpen} onOpenChange={setCloseCycleOpen} title={legacy("closeCycleTitle")} description={legacy("closeCycleDescription")} confirmLabel={legacy("closeCycleConfirm")} cancelLabel={t("cancel")} pending={status.pending} onConfirm={() => cycle && status.run(cycle.id, "closed")} />
  </DashboardPage>;
}

function EmptyRows({ columns }: { columns: number }) {
  const t = useTranslations("school.renewals.poolV2");
  return <TableRow><TableCell colSpan={columns} className="h-40 text-center text-muted">{t("noRows")}<p className="mt-2 text-xs">{t("readyHint")}</p></TableCell></TableRow>;
}

function RenewalEntryRow({ row, cycleId, stageLabel, payment, observation, canWrite, canEnroll, canObserve, entry, busy, onBusy, onActivate, onClose, onSaved }: {
  row: PoolRow; cycleId: string; stageLabel: string; payment?: Payment; observation?: string;
  canWrite: boolean; canEnroll: boolean; canObserve: boolean; entry: ActiveEntry | null; busy: boolean;
  onBusy: (busy: boolean) => void; onActivate: (kind: ActiveEntry["kind"], focus?: boolean) => void;
  onClose: () => void; onSaved: (advance: boolean) => void;
}) {
  const t = useTranslations("school.renewals.poolV2");
  const legacy = useTranslations("school.renewals");
  const [stage, setStage] = useState<ResultStage>(isResultStage(row.stage) ? row.stage : "considering");
  const [note, setNote] = useState(payment?.note ?? row.note);
  const [periods, setPeriods] = useState(payment ? String(payment.period_count) : "");
  const [amount, setAmount] = useState(payment ? String(payment.paid_amount) : "");
  const [observationType, setObservationType] = useState<TeacherProfessionalSignalType>("churn_risk");
  const [observationNote, setObservationNote] = useState("");
  const [saved, setSaved] = useState<{ stage: ResultStage; payment?: Payment } | null>(null);
  const [savedObservation, setSavedObservation] = useState<string | null>(null);
  const advanceRef = useRef(false);
  const noteRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLTableRowElement>(null);
  const registering = entry?.kind === "registration";
  const observing = entry?.kind === "observation";
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
    if (!entry?.focus) return;
    detailRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const target = entry.kind === "observation" || paid
      ? detailRef.current?.querySelector<HTMLElement>("input, textarea") : noteRef.current;
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
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (busy || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("[role='dialog'], [role='listbox'], [role='menu']")) return;
    const command = inlineEntryCommand({ ...event, isComposing: event.nativeEvent.isComposing }, !!target.closest("input, textarea, select, [contenteditable='true'], [role='combobox']"));
    if (command?.type === "choice" && !observing && RESULT_STAGES[command.index]) {
      event.preventDefault();
      chooseStage(RESULT_STAGES[command.index]);
    } else if (command?.type === "submit" && entry) {
      event.preventDefault();
      if (observing) submitObservation(); else submit(true);
    } else if (command?.type === "close" && entry) {
      event.preventDefault();
      onClose();
    }
  };
  const displayedStage = registering ? stage : currentStage;
  const detailId = "renewal-entry-" + row.membershipId;

  return <>
    <TableRow data-renewal-pool-row={row.membershipId} tabIndex={0} aria-selected={!!entry} aria-expanded={!!entry} aria-controls={entry ? detailId : undefined}
      className={cn("h-10 whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-crater [&>td]:px-2 [&>td]:py-1", entry && "bg-moon/15 hover:bg-moon/15")} onKeyDown={handleKeyDown}>
      <TableCell><div className="flex min-w-0 items-center gap-1">
        <Button type="button" size="sm" variant="ghost" className="size-6 shrink-0 p-0" aria-label={entry ? t("close") : t("details")} aria-expanded={!!entry} disabled={busy || !canWrite} onClick={() => entry ? onClose() : onActivate("registration")}>
          {entry ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </Button><Student360Trigger className="truncate" subject={{ studentId: row.studentId, leadId: null }} fallback={{ name: row.name, grade: row.grade }} />
      </div></TableCell>
      <TableCell className="truncate" title={row.classroom}>{row.classroom}</TableCell><TableCell className="truncate" title={row.owner}>{row.owner || "—"}</TableCell>
      <TableCell>{canObserve ? <Button type="button" size="sm" variant="ghost" className={cn("h-8 w-full justify-start gap-1 rounded-md px-1 text-xs", observing && "bg-moon/50 text-ink")} disabled={busy} aria-label={row.name + " · " + t("observe")} aria-expanded={observing} title={currentObservation} onClick={() => observing ? onClose() : onActivate("observation", true)}>
        <Pencil className="size-3 shrink-0" /><span className="truncate">{currentObservation || t("observe")}</span>
      </Button> : <p className="truncate text-muted" title={currentObservation}>{currentObservation || t("noObservation")}</p>}</TableCell>
      <TableCell>{canWrite ? <div className="grid grid-cols-5 gap-1" role="group" aria-label={row.name + " · " + t("result")}>
        {RESULT_STAGES.map((value, index) => {
          const selected = displayedStage === value;
          const legacyEnrollment = value === "enrolled" && currentStage === "enrolled" && !currentPayment && !registering;
          return <Button key={value} type="button" size="sm" variant={selected && registering ? "primary" : "secondary"}
            className={cn("h-7 min-w-0 gap-1 rounded-md px-1 text-[11px]", selected && !registering && "border-crater bg-moon/55 text-ink")}
            disabled={busy || (value === "enrolled" && !canEnroll) || (currentStage === "enrolled" && value !== "enrolled")}
            aria-label={legacyEnrollment ? currentLabel : t(value)} aria-pressed={selected} aria-keyshortcuts={(index + 1) + " Alt+" + (index + 1)} title={legacyEnrollment ? currentLabel : t(value)} onClick={() => chooseStage(value)}>
            <kbd className="font-mono text-[10px] opacity-75">{index + 1}</kbd><span className="truncate">{legacyEnrollment ? currentLabel : t("short_" + value)}</span>
          </Button>;
        })}
      </div> : <Badge variant="outline">{currentLabel}</Badge>}</TableCell>
      <TableCell><div className="flex min-w-0 items-center gap-2">
        {!isResultStage(currentStage) ? <span className="shrink-0 text-[10px] text-muted">{currentLabel}</span> : null}
        {currentPayment ? <span className="shrink-0 text-[11px] font-medium text-leaf-deep">{t("paidSummary", { periods: currentPayment.period_count, amount: Number(currentPayment.paid_amount).toFixed(2) })}</span> : null}
        <Input ref={noteRef} value={note} readOnly={!canWrite} disabled={busy} maxLength={2000} aria-label={row.name + " · " + t("details")} aria-expanded={registering}
          className="h-8 min-w-0 rounded-md px-2 text-xs md:text-xs" placeholder={currentLabel + " · " + t("details")} title={note || (currentStage === "enrolled" && !currentPayment ? t("paymentMissing") : currentLabel)}
          onFocus={() => { if (canWrite && !registering) onActivate("registration"); }} onChange={event => setNote(event.target.value)} />
      </div></TableCell>
    </TableRow>
    {entry ? <TableRow ref={detailRef} id={detailId} data-renewal-entry-detail className="bg-moon/10 hover:bg-moon/10" onKeyDown={handleKeyDown}>
      <TableCell colSpan={6} className="whitespace-normal px-5 py-3">
        <DashboardInlineEntry title={row.name + " · " + (observing ? t("observe") : t("details"))} closeLabel={t("close")} onClose={onClose} onSubmit={() => observing ? submitObservation() : submit(true)} pending={busy} flush>
          <div className="mt-3 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]" inert={busy || undefined}>
            <div className="min-w-0 space-y-3">
              {observing ? <>
                <Label className="block max-w-72 text-xs">{t("signalType")}<Select value={observationType} onValueChange={value => setObservationType(value as TeacherProfessionalSignalType)}>
                  <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger><SelectContent>{TEACHER_PROFESSIONAL_SIGNAL_TYPES.map(value => <SelectItem key={value} value={value}>{legacy("signalType_" + value)}</SelectItem>)}</SelectContent>
                </Select></Label>
                <Label className="block text-xs">{t("recommendation")}<Textarea className="mt-1 min-h-16 text-xs" rows={2} value={observationNote} maxLength={2000} onChange={event => setObservationNote(event.target.value)} /></Label>
              </> : <>
                {paid ? <div className="grid max-w-xl grid-cols-2 gap-4">
                  <Label className="block text-xs">{t("periods")}<Input className="mt-1 h-8 text-xs" type="number" min={1} max={24} step={1} value={periods} onChange={event => setPeriods(event.target.value)} /></Label>
                  <Label className="block text-xs">{t("amount")}<Input className="mt-1 h-8 text-xs" type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></Label>
                </div> : null}
                <Label className="block text-xs">{t("note")}<Textarea className="mt-1 min-h-16 text-xs" rows={2} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></Label>
              </>}
            </div>
            <section className="space-y-3 border-line xl:border-l xl:pl-5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{t("currentAction")}</p>
              <div className={cn("border-l-2 pl-3", paid && registering ? "border-leaf-deep" : "border-rose")}><p className="text-sm font-medium text-ink">{observing ? t("observe") : t(stage)}</p><p className="mt-1 text-xs leading-5 text-muted">{observing ? t("observationHint") : t("hint_" + stage)}</p></div>
              {observing ? <Button type="button" size="sm" className="h-9 w-full" disabled={busy || !observationNote.trim()} onClick={submitObservation}><Check className="size-4" />{t("save")}</Button> : <>
                <Button type="button" size="sm" className="h-9 w-full" disabled={busy || !valid} onClick={() => submit(true)}><Check className="size-4" />{t("action_" + stage)}</Button>
                <div className="flex justify-end"><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy || !valid} onClick={() => submit(false)}>{t("save")}</Button></div>
              </>}
              <p className="text-[11px] leading-5 text-muted">{observing ? t("observationKeys") : t("quickKeys")}</p>
            </section>
          </div>
        </DashboardInlineEntry>
      </TableCell>
    </TableRow> : null}
  </>;
}
