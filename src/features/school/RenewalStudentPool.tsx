"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FlaskConical, SlidersHorizontal } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { setRenewalCycleStatusAction, snapshotRenewalCycleMembershipsAction } from "./actions/renewals";
import { BusinessRecordStateFilter, useBusinessSearchQuery } from "./BusinessRecordStateFilter";
import { businessRecordMessages, isCurrentBusinessRecord, matchesBusinessRecordState, type BusinessRecordStateFilter as StateFilter } from "./business-record-state-contract";
import { DashboardPage, DashboardCommandState, DashboardCommandFilters, DashboardCommandActions, DashboardTableShell, DashboardTableColumnHeader } from "./dashboard-page";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { useDashboardTableView } from "./dashboard-page/useDashboardTableView";
import { FilterSearchInput } from "./FilterBar";
import { navigateFollowupTable } from "./followup-keyboard";
import { FollowupTabs } from "./FollowupTabs";
import { FollowupCommandPanel } from "./FollowupCommandPanel";
import { FollowupPrimaryFilter, useFollowupWorkFilter } from "./FollowupPrimaryFilter";
import { RENEWAL_WORK_FILTERS, renewalMatchesWorkFilter, type RenewalWorkFilter } from "./followup-primary-filter-contract";
import { RenewalEntryRow, type RenewalPoolRow } from "./RenewalRecordDetails";
import { renewalHealthLevel, renewalHealthSignals } from "./renewal-health-contract";
import type { RenewalHealthPolicy } from "./renewal-health-policy";
import { renewalHealthSamples } from "./renewal-health-samples";
import { RenewalHealthSettings } from "./RenewalHealthSettings";
import type { RenewalPoolSupplement } from "./renewal-pool-data";
import { renewalResult, type RenewalWorkbenchSaved } from "./renewal-workbench-contract";
import type { RenewalWorkspaceData } from "./renewals";
import { CreateCycleDialog } from "./RenewalPoolWorkspace";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { businessSubjectKey, type StudentBusinessHistory } from "./student-business-history-contract";

export function RenewalStudentPool({ data, supplement, canWrite, canReview, canEnroll, settings = false,
  allowHealthSamples = false, healthSampleMode = false, history, initialQuery, initialRecordState = "all",
}: {
  data: RenewalWorkspaceData; supplement: RenewalPoolSupplement;
  canWrite: boolean; canReview: boolean; canEnroll: boolean; settings?: boolean; health?: boolean;
  allowHealthSamples?: boolean; healthSampleMode?: boolean;
  history?: StudentBusinessHistory | null; initialQuery?: string; initialRecordState?: StateFilter;
}) {
  const t = useTranslations("school.renewals.workbench");
  const filterT = useTranslations("school.followupFilters");
  const pool = useTranslations("school.renewals.poolV2");
  const legacy = useTranslations("school.renewals");
  const policyT = useTranslations("school.renewals.healthSettings");
  const locale = useLocale(), router = useRouter(), recordM = businessRecordMessages(locale);
  const [query, setQuery] = useBusinessSearchQuery("renewals", initialQuery);
  const [recordState, setRecordState] = useState(initialRecordState);
  const [workFilter, setWorkFilter] = useFollowupWorkFilter("renewals", RENEWAL_WORK_FILTERS, "all");
  const effectiveWorkFilter = recordState === "historical" ? "all" : workFilter;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [entryBusy, setEntryBusy] = useState(false);
  const [savedRows, setSavedRows] = useState<Record<string, RenewalWorkbenchSaved>>({});
  const [retainedView, setRetainedView] = useState<{ key: string; ids: string[] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(settings);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [sampleMode, setSampleMode] = useState(allowHealthSamples && healthSampleMode);
  const [policyUpdate, setPolicyUpdate] = useState<{ policy: RenewalHealthPolicy; revision: number } | null>(null);
  const latestPolicy = policyUpdate && policyUpdate.revision >= supplement.healthPolicyRevision ? policyUpdate
    : { policy: supplement.healthPolicy, revision: supplement.healthPolicyRevision };
  const policy = latestPolicy.policy;
  const [createOpen, setCreateOpen] = useState(false);
  const [closeCycleOpen, setCloseCycleOpen] = useState(false);
  const cycle = data.cycles.find(row => row.id === data.selectedCycleId);
  const samples = renewalHealthSamples(supplement.now);
  const healthFacts = sampleMode ? samples.map(sample => sample.facts) : supplement.health;
  const facts = new Map(healthFacts.map(row => [row.studentId, row]));
  const payments = new Map(supplement.payments.map(row => [row.opportunity_id, row]));
  const records = new Map(supplement.records.map(row => [row.opportunityId, row]));
  const phones = new Map(supplement.students.map(row => [row.id, row.phone]));
  const teachers = new Map(supplement.membershipTeachers.map(row => [row.membershipId, row.name]));
  const signalsFor = (row: RenewalPoolRow) => isCurrentBusinessRecord(row.recordState) ? renewalHealthSignals(facts.get(row.studentId), supplement.now, policy) : [];
  const currentRows: RenewalPoolRow[] = [
    ...data.candidates.map(row => ({ id: row.membershipId, membershipId: row.membershipId, studentId: row.studentId,
      name: row.studentName, phone: phones.get(row.studentId) ?? "", grade: row.grade, classroom: row.classroomName,
      teacher: teachers.get(row.membershipId) ?? "", owner: row.currentOwnerName, stage: "unprepared", note: "", opportunityId: null,
      targetCourse: row.sourceCourseTitle, nextContactAt: null, updatedAt: null })),
    ...data.opportunities.filter(row => row.opportunityType === "renewal" && row.cycleId === cycle?.id && row.sourceMembershipId).map(row => ({
      id: row.sourceMembershipId!, membershipId: row.sourceMembershipId!, studentId: row.studentId, name: row.studentName,
      phone: phones.get(row.studentId) ?? "", grade: row.grade, classroom: row.sourceClassroomName, teacher: teachers.get(row.sourceMembershipId!) ?? "",
      owner: row.ownerName, stage: row.stage, note: row.note, opportunityId: row.id, targetCourse: row.courseTitle,
      nextContactAt: row.nextActionAt, updatedAt: row.updatedAt, record: records.get(row.id), payment: payments.get(row.id),
    })),
  ].map(row => {
    const saved = savedRows[row.id];
    // 新的服务器事实优先；在刷新到达前即时回显本次完整保存结果。
    if (!saved || (row.updatedAt && Date.parse(row.updatedAt) > Date.parse(saved.record.updatedAt))) return row;
    return { ...row, opportunityId: saved.record.opportunityId, stage: saved.stage, note: saved.note,
      nextContactAt: saved.nextContactAt, updatedAt: saved.record.updatedAt, record: saved.record, payment: saved.payment ?? undefined };
  });
  const rows: RenewalPoolRow[] = [...currentRows, ...(history?.renewals ?? []).map(row => ({
    id: `historical:${row.id}`, membershipId: null, studentId: row.student_id ?? "", sourceRecordId: row.source_record_id,
    name: history!.students[businessSubjectKey(row)] ?? recordM.unknown, phone: history!.subjects[businessSubjectKey(row)]?.phone ?? "",
    grade: history!.subjects[businessSubjectKey(row)]?.grade ?? null, classroom: `${row.period_label || `${row.period_year ?? ""}${row.period_key === "summer" ? t("season_summer") : row.period_key === "autumn" ? t("season_autumn") : ""}`} · ${row.class_label}`,
    teacher: row.teacher_label, owner: "", stage: row.outcome === "renewed" ? "enrolled" : row.outcome === "not_renewed" ? "not_enrolled" : "unknown",
    note: row.decision_note, opportunityId: row.id, targetCourse: "", nextContactAt: null, updatedAt: null, recordState: "historical" as const,
  }))];
  const displayRows: RenewalPoolRow[] = sampleMode ? samples.map((sample, index) => ({
    id: sample.facts.studentId, membershipId: null, studentId: sample.facts.studentId,
    name: policyT("sampleName", { number: index + 1, scenario: policyT("sample_" + sample.key) }), phone: "", grade: null,
    classroom: policyT("sampleClass"), teacher: "", owner: "", stage: "unprepared", note: "", opportunityId: null,
    targetCourse: "", nextContactAt: null, updatedAt: null,
  })) : rows;
  const resultFor = (row: RenewalPoolRow) => row.stage === "unknown" ? "unknown" : renewalResult(row.stage, row.payment);
  const labelFor = (row: RenewalPoolRow) => resultFor(row) === "unknown" ? recordM.outcomeUnknown : t(`result_${resultFor(row)}`);
  const filtered = displayRows.filter(row => matchesBusinessRecordState(row.recordState, recordState)
    && [row.name, row.phone, row.classroom, row.teacher, row.owner, row.note].some(value => value.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))));
  const field = (value: string) => ({ value: value || "none", label: value || "—" });
  const table = useDashboardTableView({ rows: filtered, locale, persistenceKey: "followup-renewals", columns: {
    name: { filterValues: (row: RenewalPoolRow) => ({ value: row.studentId, label: row.name }), sortValue: row => row.name },
    owner: { filterValues: (row: RenewalPoolRow) => field(row.owner), sortValue: row => row.owner },
    classroom: { filterValues: (row: RenewalPoolRow) => field(row.classroom), sortValue: row => row.classroom },
    teacher: { filterValues: (row: RenewalPoolRow) => field(row.teacher), sortValue: row => row.teacher },
    seasons: { filterValues: (row: RenewalPoolRow) => row.record?.seasons.length ? row.record.seasons.map(value => ({ value, label: t(`season_${value}`) })) : [field("")], sortValue: row => row.record?.seasons.join(",") },
    health: { filterValues: (row: RenewalPoolRow) => isCurrentBusinessRecord(row.recordState) ? { value: renewalHealthLevel(signalsFor(row)), label: pool(renewalHealthLevel(signalsFor(row))) } : [], sortValue: row => signalsFor(row).filter(signal => signal.level === "attention").length },
    stage: { filterValues: (row: RenewalPoolRow) => ({ value: resultFor(row), label: labelFor(row) }), sortValue: row => resultFor(row) },
    payment: { filterValues: (row: RenewalPoolRow) => row.record?.paymentMethod ? { value: row.record.paymentMethod, label: t(`payment_${row.record.paymentMethod}`) } : [field("")], sortValue: row => row.payment?.paid_amount },
    next: { filterValues: (row: RenewalPoolRow) => ({ value: row.nextContactAt ? Date.parse(row.nextContactAt) <= supplement.now ? "due" : "scheduled" : "none",
      label: t(row.nextContactAt ? Date.parse(row.nextContactAt) <= supplement.now ? "contactDue" : "contactScheduled" : "contactUnscheduled") }), sortValue: row => row.nextContactAt },
  } });
  const viewKey = JSON.stringify([cycle?.id, sampleMode, query, recordState, effectiveWorkFilter, table.filters, table.sort]);
  if (retainedView && retainedView.key !== viewKey) setRetainedView(null);
  const rowById = new Map(displayRows.map(row => [row.id, row]));
  const visibleRows = retainedView?.key === viewKey ? retainedView.ids.flatMap(id => rowById.has(id) ? [rowById.get(id)!] : []) : table.visibleRows.filter(row => renewalMatchesWorkFilter(row, effectiveWorkFilter));
  const activate = (id: string) => {
    if (entryBusy) return;
    setRetainedView(current => current?.key === viewKey ? current : { key: viewKey, ids: visibleRows.map(row => row.id) });
    setActiveId(id);
  };
  const nextRow = (row: RenewalPoolRow) => visibleRows.slice(visibleRows.findIndex(item => item.id === row.id) + 1)
    .find(item => isCurrentBusinessRecord(item.recordState) && item.membershipId && !["paid", "not_enrolled"].includes(resultFor(item)));
  const notifySaved = () => { window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); router.refresh(); };
  const errors = { default: legacy("actionFailed") };
  const refresh = useAction(snapshotRenewalCycleMembershipsAction, { successMessage: result => legacy("snapshotSuccess", result), errorMessage: errors, onSuccess: () => router.refresh() });
  const status = useAction(setRenewalCycleStatusAction, { successMessage: legacy("cycleStatusSaved"), errorMessage: errors, onSuccess: () => { setCloseCycleOpen(false); router.refresh(); } });

  return <DashboardPage title={legacy("title")} density="compact" commandPanel={<FollowupCommandPanel>
    <DashboardCommandState><FollowupTabs /></DashboardCommandState>
    <DashboardCommandFilters>
      <FollowupPrimaryFilter label={filterT("workQueue")} value={effectiveWorkFilter} disabled={entryBusy}
        options={RENEWAL_WORK_FILTERS.map(value => ({ value, label: filterT(`renewals_${value}`) }))}
        onValueChange={value => {
          setWorkFilter(value as RenewalWorkFilter);
          if (value !== "all" && recordState === "historical") setRecordState("current");
        }} />
      <FollowupChoice label={pool("cycle")} value={cycle?.id ?? "none"} presentation="select" disabled={entryBusy || !data.cycles.length} className="w-52 h-8 min-h-8 shrink-0 py-1 text-xs"
        onValueChange={id => router.replace(`/dashboard/followups/renewals?cycle=${id}`)} options={data.cycles.length ? data.cycles.map(item => ({ value: item.id, label: item.name })) : [{ value: "none", label: legacy("noCycles") }]} />
      <BusinessRecordStateFilter presentation="followup" value={recordState} onChange={value => {
        if (entryBusy) return;
        setRecordState(value);
        if (value === "historical") setWorkFilter("all");
      }} locale={locale} />
      <FilterSearchInput aria-label={t("search")} placeholder={t("search")} value={query} disabled={entryBusy} onChange={event => setQuery(event.target.value)} />
    </DashboardCommandFilters>
    <DashboardCommandActions><Button size="sm" variant="ghost" disabled={entryBusy} onClick={() => setSettingsOpen(true)}><SlidersHorizontal className="size-4" />{pool("settings")}</Button>
      <Link href="/dashboard/followups/renewals/growth" className={buttonVariants({ size: "sm", variant: "ghost" })}>{legacy("reactivationAndReferrals")}</Link>
      <Link href="/dashboard/followups/renewals/signals" className={buttonVariants({ size: "sm", variant: "ghost" })}>{legacy("teacherSignals")}</Link>
    </DashboardCommandActions>
  </FollowupCommandPanel>}>
    <DashboardTableShell data-renewal-workbench data-followup-workbench data-followup-scroll>
      <Table className="w-full min-w-[70rem] table-fixed text-xs" containerClassName="overflow-auto [scrollbar-gutter:stable]"
        onKeyDown={event => navigateFollowupTable(event, id => { if (entryBusy) return false; activate(id); return true; })}>
        <colgroup><col className="w-48" /><col className="w-48" /><col className="w-28" /><col /><col className="w-32" /><col className="w-40" /><col className="w-36" /></colgroup>
        <TableHeader className="sticky top-0 z-20 bg-card" inert={entryBusy || undefined}><TableRow className="[&>th]:h-9 [&>th]:px-2">
          <TableHead className="sticky left-0 z-30 border-r border-line bg-card"><div className="flex min-w-0 items-center justify-between gap-1"><DashboardTableColumnHeader label={pool("student")} {...table.columnProps("name")} /><DashboardTableColumnHeader label={pool("owner")} {...table.columnProps("owner")} /></div></TableHead>
          <TableHead><div className="flex min-w-0 items-center justify-between gap-1"><DashboardTableColumnHeader label={pool("classroom")} {...table.columnProps("classroom")} /><DashboardTableColumnHeader label={t("teacher")} {...table.columnProps("teacher")} /></div></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("arrangement")} {...table.columnProps("seasons")} /></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("learning")} {...table.columnProps("health")} /></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("result")} {...table.columnProps("stage")} /></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("paymentFacts")} {...table.columnProps("payment")} /></TableHead>
          <TableHead><DashboardTableColumnHeader label={t("nextContact")} {...table.columnProps("next")} /></TableHead>
        </TableRow></TableHeader>
        <TableBody>{visibleRows.map(row => <RenewalEntryRow key={`${sampleMode}:${row.id}`} row={row} cycleId={cycle?.id ?? ""} cycleName={cycle?.name ?? ""} targetTerm={cycle?.targetTermName ?? ""}
          health={signalsFor(row)} healthAvailable={sampleMode || supplement.healthAvailable} policy={policy} sampleMode={sampleMode} now={supplement.now}
          observation={supplement.signals.find(item => item.student_id === row.studentId && item.source_class_membership_id === row.membershipId)?.recommendation}
          canWrite={isCurrentBusinessRecord(row.recordState) && !sampleMode && canWrite && cycle?.status === "open"} canEnroll={canEnroll}
          canObserve={isCurrentBusinessRecord(row.recordState) && !sampleMode && canReview && !!row.membershipId && supplement.observationMemberships.includes(row.membershipId)}
          active={activeId === row.id} busy={entryBusy} canAdvance={!!nextRow(row)} onBusy={setEntryBusy} onActivate={() => activate(row.id)} onClose={() => setActiveId(null)}
          onSaved={(value, advance) => {
            setSavedRows(current => ({ ...current, [row.id]: value }));
            if (advance && activeId === row.id) { const next = nextRow(row); if (next) setActiveId(next.id); }
            notifySaved();
          }} onObservationSaved={notifySaved} />)}
          {!visibleRows.length ? <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted">{pool("noRows")}{!rows.length ? <p className="mt-2 text-xs">{pool("readyHint")}</p> : null}</TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </DashboardTableShell>
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="sm:max-w-3xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{pool("settings")}</DialogTitle></DialogHeader>
      <div className="space-y-5"><Label className="block">{pool("cycle")}<FollowupChoice label={pool("cycle")} value={cycle?.id ?? ""} onValueChange={id => router.replace(`/dashboard/followups/renewals?cycle=${id}`)} options={data.cycles.map(item => ({ value: item.id, label: item.name }))} className="mt-2 w-full" /></Label>
        {cycle ? <><p className="text-sm">{cycle.sourceTermName} → {cycle.targetTermName}</p><p className="text-xs text-muted">{legacy(`cycleStatus_${cycle.status}`)} · {cycle.preparationStartsOn || "—"} — {cycle.decisionDueOn || "—"}</p></> : null}
        <div className="flex flex-wrap gap-2">{canWrite ? <>
          {cycle && cycle.status !== "closed" ? <Button size="sm" variant="secondary" disabled={refresh.pending} onClick={() => refresh.run(cycle.id)}>{pool("refresh")}</Button> : null}
          {cycle?.status === "planning" ? <Button size="sm" disabled={status.pending} onClick={() => status.run(cycle.id, "open")}>{legacy("openCycle")}</Button> : null}
          {cycle?.status === "open" ? <Button size="sm" variant="secondary" onClick={() => setCloseCycleOpen(true)}>{pool("closeCycle")}</Button> : null}
          <CreateCycleDialog open={createOpen} onOpenChange={setCreateOpen} terms={data.terms} errors={errors} onSaved={() => router.refresh()} />
          {cycle ? <Button size="sm" variant="secondary" onClick={() => setPolicyOpen(true)}>{policyT("title")}</Button> : null}
        </> : null}{allowHealthSamples ? <Button size="sm" variant="ghost" onClick={() => { setSampleMode(value => !value); setSettingsOpen(false); setActiveId(null); }}><FlaskConical className="size-4" />{policyT(sampleMode ? "showStudents" : "showSamples")}</Button> : null}</div>
      </div>
    </DialogContent></Dialog>
    <ConfirmDialog open={closeCycleOpen} onOpenChange={setCloseCycleOpen} title={legacy("closeCycleTitle")} description={legacy("closeCycleDescription")} confirmLabel={legacy("closeCycleConfirm")} cancelLabel={pool("cancel")} pending={status.pending} onConfirm={() => cycle && status.run(cycle.id, "closed")} />
    {policyOpen && cycle ? <RenewalHealthSettings key={latestPolicy.revision} open onOpenChange={setPolicyOpen} cycleId={cycle.id} cycleName={cycle.name} policy={policy} revision={latestPolicy.revision} facts={healthFacts} now={supplement.now} sampleMode={sampleMode} onSaved={(value, revision) => setPolicyUpdate({ policy: value, revision })} /> : null}
  </DashboardPage>;
}
