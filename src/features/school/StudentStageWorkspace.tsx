"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, Ellipsis, RefreshCw } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandState, DashboardCommandTabs, DashboardEmptyCard, DashboardPage, DashboardTableColumnHeader, DashboardTableShell } from "./dashboard-page";
import { FollowupCommandPanel } from "./FollowupCommandPanel";
import { FollowupRecordRow, FollowupTableBody } from "./dashboard-page/FollowupRecordRow";
import { FollowupPersonCell } from "./dashboard-page/FollowupPersonCell";
import { useDashboardFieldView } from "./dashboard-page/useDashboardFieldView";
import { formatDashboardDate } from "./dashboard-page/dashboard-table-date-contract";
import { filterAndSortDashboardFields } from "./dashboard-page/dashboard-table-field-contract";
import { useFollowupServerFields } from "./useFollowupServerFields";
import { STUDENT_STAGE_TABLE_COLUMNS, studentStageFieldsAcrossStages, studentStageTableFields } from "./student-stage-table-fields";
import { FilterBar, FilterSearchInput } from "./FilterBar";
import { FollowupPrimaryFilter } from "./FollowupPrimaryFilter";
import { LeadPoolPagination } from "./LeadPoolPagination";
import { StudentStageAssignmentControl, StudentStageOwnerControl } from "./StudentStageAssignmentControl";
import { Student360Trigger } from "./Student360Sheet";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { studentStageMessages } from "./student-stage-messages";
import { defaultStudentEntryMode, replaceSavedStudent, STUDENT_STAGE_TABS, studentStageHref,
  type StudentEntryMode, type StudentStageData, type StudentStageFilters, type StudentStageRow, type StudentStageSaved, type StudentStageAssignment, type StudentStageAssignee } from "./student-stage-contract";

const Entry = dynamic(() => import("./StudentStageEntry").then(m => m.StudentStageEntry));

export function StudentStageWorkspace({ data, filters, locale, currentUserId, canEnroll, canAssign, assignees, actions, timeZone, now }: {
  data: StudentStageData; filters: StudentStageFilters; locale: string; currentUserId: string;
  canEnroll: boolean; actions: ReactNode; timeZone: string; now?: number;
  canAssign: boolean; assignees: StudentStageAssignee[];
}) {
  const m = studentStageMessages(locale);
  const studentT = useTranslations("school.students");
  const router = useRouter();
  const showBackground = filters.stage !== "awaiting_first_contact" && filters.stage !== "awaiting_assessment";
  const viewKey = JSON.stringify(filters);
  const [rows, setRows] = useState(data.rows);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ key: string; mode: StudentEntryMode } | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [outcomeRequest, setOutcomeRequest] = useState<{ key: string; value: "" | "unreachable" | "connected" | "declined" | "invalid_number" } | null>(null);
  const entryRefs = useRef(new Map<string, { save: () => void }>());
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [resetRequested, setResetRequested] = useState(false);
  const [accepted, setAccepted] = useState({ data, viewKey });
  if (accepted.data !== data || accepted.viewKey !== viewKey) {
    setAccepted({ data, viewKey });
    if (accepted.viewKey !== viewKey || resetRequested) {
      setRows(data.rows); setSelectedKeys(new Set()); setActive(null); setFocusedKey(null); setOutcomeRequest(null); setVisited(new Set()); setHandled(new Set()); setResetRequested(false);
    }
  }
  const [clockNow] = useState(() => now ?? Date.now());
  const context = useMemo(() => ({ locale, timeZone, now: clockNow }), [locale, timeZone, clockNow]);
  const fields = useMemo(() => studentStageTableFields(locale, filters.stage, currentUserId), [locale, filters.stage, currentUserId]);
  const server = useFollowupServerFields(data.fieldView);
  const table = useDashboardFieldView({ rows, fields, columns: STUDENT_STAGE_TABLE_COLUMNS, context,
    server: server ? { ...server, onChange: query => { if (!busy) server.onChange(query); } } : undefined });
  const visibleRows = table.visibleRows;
  const selectedRows = visibleRows.filter(row => selectedKeys.has(row.key));
  const fieldQuery = { version: 2 as const, filters: table.filters, sort: table.sort };
  const currentFilters = { ...filters, fields: JSON.stringify(fieldQuery) };
  const acrossStages = studentStageFieldsAcrossStages(fieldQuery);
  const formatAt = (value: string | null) => formatDashboardDate(value, context, { time: true });
  const navigate = (change: Partial<StudentStageFilters>) => { if (!busy) router.replace(studentStageHref(currentFilters, {
    page: 1, ...(change.stage !== undefined || change.q !== undefined ? { fields: acrossStages, detail: "" } : {}), ...change,
  }), { scroll: false }); };
  const open = (row: StudentStageRow, mode: StudentEntryMode = defaultStudentEntryMode(row)) => {
    if (busy) return;
    setMenuKey(null); setFocusedKey(row.key); setVisited(current => new Set(current).add(row.key)); setActive({ key: row.key, mode });
  };
  const saved = (originalKey: string, result: StudentStageSaved, advance: boolean) => {
    setOutcomeRequest(null);
    const next = visibleRows[visibleRows.findIndex(row => row.key === originalKey) + 1];
    setRows(current => replaceSavedStudent(current, originalKey, result.subject));
    setSelectedKeys(current => { if (!current.has(originalKey)) return current; const values = new Set(current); values.delete(originalKey); values.add(result.subject.key); return values; });
    setFocusedKey(advance && next ? next.key : result.subject.key);
    setHandled(current => new Set(current).add(result.subject.key));
    setVisited(current => { const values = new Set(current); values.delete(originalKey); values.add(result.subject.key); if (advance && next) values.add(next.key); return values; });
    setActive(advance && next ? { key: next.key, mode: defaultStudentEntryMode(next) }
      : { key: result.subject.key, mode: defaultStudentEntryMode(result.subject) });
  };
  const assigned = (result: StudentStageAssignment[]) => {
    const updates = new Map(result.map(item => [item.key, item.subject]));
    setRows(current => current.flatMap(row => {
      if (!updates.has(row.key)) return [row];
      const subject = updates.get(row.key);
      if (!subject || filters.scope === "mine" && subject.ownerId !== currentUserId || filters.scope === "unassigned" && subject.ownerId !== null) return [];
      if (!filterAndSortDashboardFields([subject], fields, fieldQuery, locale, timeZone).length) return [];
      return [subject];
    }));
    setSelectedKeys(current => new Set([...current].filter(key => !updates.has(key))));
    if (active && updates.has(active.key)) setActive(null);
    setOutcomeRequest(null);
    window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); router.refresh();
  };
  return <DashboardPage title={m.title} density="compact"
    commandPanel={<FollowupCommandPanel>
      <DashboardCommandState><DashboardCommandTabs ariaLabel={m.title} activeValue={filters.stage} activeTone="accent"
        items={STUDENT_STAGE_TABS.map(stage => ({ value: stage, label: m.stages[stage], badge: data.counts[stage] ?? 0,
          href: studentStageHref(currentFilters, { stage, page: 1, detail: "", q: "", fields: acrossStages }) }))} /></DashboardCommandState>
      <DashboardCommandFilters><FollowupPrimaryFilter value={filters.population ?? "work"} label={m.population} disabled={busy}
        options={[{ value: "work", label: m.workPopulation }, { value: "records", label: m.recordsPopulation }]}
        onValueChange={population => navigate({ population: population as "work" | "records", q: "" })} />
      <FilterBar onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget); navigate({ q: String(form.get("q") ?? "").trim(), detail: "" });
      }}><FilterSearchInput name="q" defaultValue={filters.q} placeholder={m.search} aria-label={m.search} disabled={busy} />
        {filters.q ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => navigate({ q: "", detail: "" })}>{studentT("reset")}</Button> : null}
      </FilterBar></DashboardCommandFilters>
      <DashboardCommandActions>
        {canAssign && selectedRows.length ? <><span className="text-xs text-muted">{m.selected} {selectedRows.length}</span>
          <StudentStageAssignmentControl rows={selectedRows} assignees={assignees} locale={locale} disabled={busy} onBusyChange={setBusy} onAssigned={assigned} />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelectedKeys(new Set())}>{m.clearSelection}</Button></> : null}
        <Button size="sm" variant="ghost" disabled={busy || resetRequested} onClick={() => { setResetRequested(true); router.refresh(); }}><RefreshCw className="size-3.5" />{m.refresh}</Button>
        {actions}
      </DashboardCommandActions>
    </FollowupCommandPanel>}
    summary={<p className="text-xs text-muted">{filters.q ? m.searchHint : filters.population === "records" ? m.recordsHint : m.workHint}
      {filters.stage === "former_student" && !filters.q ? ` ${m.formerHint}` : ""}</p>}
    footer={<LeadPoolPagination baseHref="/dashboard/students" currentPage={data.page} totalPages={data.totalPages} totalCount={data.count}
      pageSize={data.pageSize} scope={filters.scope} q={filters.q} extraQuery={{ stage: filters.stage, fields: currentFilters.fields, population: filters.population ?? "work" }}
      disabled={busy} onPageChange={(page, pageSize) => navigate({ page, pageSize })} />}>
    <DashboardTableShell data-followup-workbench aria-busy={server?.pending}>
      <Table className={`table-fixed text-xs [&_th]:px-2 ${showBackground ? "min-w-[69rem]" : "min-w-[53rem]"}`}>
        <TableHeader className="sticky top-0 z-20 bg-paper text-xs text-muted"><TableRow>
          {canAssign ? <TableHead className="w-9"><Checkbox aria-label={m.selectPage} disabled={busy || !visibleRows.length}
            checked={Boolean(visibleRows.length) && selectedRows.length === visibleRows.length ? true : selectedRows.length ? "indeterminate" : false}
            onCheckedChange={checked => setSelectedKeys(new Set(checked === true ? visibleRows.map(row => row.key) : []))} /></TableHead> : null}
          <TableHead className="w-40"><DashboardTableColumnHeader label={m.name} {...table.columnProps("name")} disabled={busy} /></TableHead>
          <TableHead className="w-28"><DashboardTableColumnHeader label={m.phone} {...table.columnProps("phone")} disabled={busy} /></TableHead>
          <TableHead className="w-32"><DashboardTableColumnHeader label={m.state} {...table.columnProps("state")} disabled={busy} /></TableHead>
          {showBackground ? <TableHead className="w-40"><DashboardTableColumnHeader label={m.background} {...table.columnProps("background")} disabled={busy} /></TableHead> : null}
          <TableHead className="w-24"><DashboardTableColumnHeader label={m.owner} {...table.columnProps("owner")} disabled={busy} /></TableHead>
          {showBackground ? <TableHead className="w-24"><DashboardTableColumnHeader label={m.teacher} {...table.columnProps("teacher")} disabled={busy} /></TableHead> : null}
          <TableHead><DashboardTableColumnHeader label={m.recent} {...table.columnProps("recent")} disabled={busy} /></TableHead><TableHead className={locale.startsWith("en") ? "w-64 text-right" : "w-48 text-right"}>{m.actions}</TableHead>
        </TableRow></TableHeader>
        <FollowupTableBody onNavigate={key => { if (busy) return false; setFocusedKey(key); return true; }}>{visibleRows.map((row, index) => {
          const expanded = active?.key === row.key;
          const contactMode = defaultStudentEntryMode(row);
          const enrollmentLabel = row.stage === "awaiting_renewal" ? m.renewal : row.stage === "former_student" ? m.reactivate : m.enrollment;
          const grade = row.grade ? studentT("grade", { grade: row.grade }) : row.gradeText || "—";
          const situation = m.details[row.detail] ?? row.detail;
          const showStage = Boolean(filters.q) || row.stage !== filters.stage;
          const learning = [row.assessmentBand?.toUpperCase().replaceAll("_PLUS", "+"), row.score !== null ? String(row.score) : null,
            row.learningBand ? `${m.learningBand} ${row.learningBand}` : null].filter(Boolean).join(" · ");
          const background = row.assessmentSource === "class_band" ? `${m.classBandReference} · ${learning || row.classBandLabel}`
            : learning || (row.assessmentSource === "assessment" ? m.completedAssessment : row.courseTitle ? `${row.courseTitle} · ${row.termName}` : m.noAssessment);
          return <FollowupRecordRow key={row.key} rowKey={row.key} expanded={expanded} active={focusedKey === row.key} focusOnActivate
            pending={busy} keepMounted={visited.has(row.key)} onActivate={() => { if (!busy) setFocusedKey(row.key); }}
            onExpandedChange={value => { if (!busy) { if (value) open(row); else setActive(null); } }}
            onOutcomeChange={row.stage === "awaiting_first_contact" && row.canContact ? value => { open(row, "contact"); setOutcomeRequest({ key: row.key, value }); } : undefined}
            onSave={row.canWrite ? () => entryRefs.current.get(row.key)?.save() : undefined}
            detailsId={`student-stage-details-${row.key}`} title={row.name} colSpan={(showBackground ? 8 : 6) + (canAssign ? 1 : 0)} selected={selectedKeys.has(row.key)}
            rowProps={{ "data-student-stage-row": row.key, "data-student-stage": row.stage,
              className: "h-10 cursor-pointer focus-visible:outline-none [&>td]:px-2 [&>td]:py-1 [&>td]:align-middle [&>td]:whitespace-nowrap" }}
            summary={<>
            {canAssign ? <TableCell><Checkbox aria-label={`${m.selectStudent} · ${row.name}`} disabled={busy} checked={selectedKeys.has(row.key)}
              onCheckedChange={checked => setSelectedKeys(current => { const next = new Set(current); if (checked === true) next.add(row.key); else next.delete(row.key); return next; })} /></TableCell> : null}
            <TableCell><FollowupPersonCell name={row.name} phone={row.phone} grade={grade} studentGrade={row.grade} nameOnly inlineGrade
              subject={{ studentId: row.studentId, leadId: row.leadId }} expanded={expanded} detailsId={`student-stage-details-${row.key}`}
              onToggle={() => { if (!busy) { if (expanded) setActive(null); else open(row); } }} /></TableCell>
            <TableCell title={row.phone || undefined}><p className="truncate tabular-nums text-muted">{row.phone || "—"}</p></TableCell>
            <TableCell title={`${m.stages[row.stage]} · ${situation}`}><div className="flex min-w-0 items-center gap-1.5">
              <Badge variant="outline" className="min-w-0 max-w-full rounded-md px-1.5 py-0"><span className="truncate">{showStage ? `${m.stages[row.stage]} · ` : ""}{situation}</span></Badge>
              {handled.has(row.key) ? <span role="img" aria-label={m.retained} title={m.retained} className="shrink-0 text-leaf-deep"><Check className="size-3.5" aria-hidden="true" /></span> : null}
            </div></TableCell>
            {showBackground ? <TableCell title={[background, row.assessmentAt ? formatAt(row.assessmentAt) : ""].filter(Boolean).join(" · ")}><p className="truncate">{background}</p>
              {row.inferredSourceIds?.length && row.studentId ? <Link href={`/dashboard/students/${row.studentId}?tab=history#student-source-records`}><Badge variant="outline" className="mt-0.5 px-1 text-[10px]">{locale.startsWith("en") ? "Inferred · check when needed" : "资料待核对"}</Badge></Link>
                : Boolean(row.assessmentCandidateCount) ? <Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }} className="text-xs text-primary">{m.assessmentCandidates} {row.assessmentCandidateCount}</Student360Trigger> : null}</TableCell> : null}
            <TableCell title={row.ownerName || m.unassigned}>{canAssign ? <StudentStageOwnerControl row={row} assignees={assignees} locale={locale} disabled={busy}
              onBusyChange={setBusy} onAssigned={assigned} /> : <p className="truncate">{row.ownerName || m.unassigned}</p>}</TableCell>
            {showBackground ? <TableCell title={row.teacherName || m.unassigned}><p className="truncate">{row.teacherName || m.unassigned}</p></TableCell> : null}
            <TableCell title={[row.note || m.noNote, row.lastContactAt ? formatAt(row.lastContactAt) : ""].filter(Boolean).join("\n")}><p className="truncate">{row.note || m.noNote}</p></TableCell>
            <TableCell><div className="flex items-center justify-end gap-1">
              {row.canWrite ? <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" disabled={busy} onClick={() => open(row, contactMode)}>{contactMode === "contact" ? m.contact : m.note}</Button> : null}
              {row.stage === "awaiting_assessment" && row.canContact ? <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2 text-xs" disabled={busy} onClick={() => open(row, "invitation")}>{row.detail === "no_show" || row.detail === "cancelled" ? m.rebook : m.book}</Button>
                : row.studentId && row.canWrite && row.stage !== "awaiting_first_contact" ? <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2 text-xs" disabled={busy} onClick={() => open(row, "enrollment")}>{enrollmentLabel}</Button> : null}
              {row.canWrite ? <Popover open={menuKey === row.key} onOpenChange={value => setMenuKey(value ? row.key : null)}><PopoverTrigger asChild><Button size="sm" variant="ghost" className="size-7 shrink-0 p-0" disabled={busy} aria-label={m.more} title={m.more}><Ellipsis className="size-4" /></Button></PopoverTrigger>
                <PopoverContent align="end" className="flex w-44 flex-col gap-1 p-1.5">{row.canContact ? <Button variant="ghost" size="sm" className="justify-start" onClick={() => open(row, "invitation")}>{m.invitation}</Button> : null}
                  {row.studentId ? <Button variant="ghost" size="sm" className="justify-start" onClick={() => open(row, "enrollment")}>{enrollmentLabel}</Button> : null}</PopoverContent></Popover> : null}
            </div></TableCell>
          </>}>
            {() => row.canWrite ? <Entry row={row} requestedMode={expanded ? active.mode : contactMode} locale={locale} currentUserId={currentUserId} canEnroll={canEnroll}
              ref={entry => { if (entry) entryRefs.current.set(row.key, entry); else entryRefs.current.delete(row.key); }}
              outcomeRequest={outcomeRequest?.key === row.key ? outcomeRequest : null}
              canAdvance={index < visibleRows.length - 1} onBusyChange={setBusy} onSaved={(result, advance) => saved(row.key, result, advance)} /> : <p className="text-sm text-muted">{m.needOwner}</p>}
          </FollowupRecordRow>;
        })}</FollowupTableBody>
      </Table>
    </DashboardTableShell>
    {visibleRows.length === 0 ? <DashboardEmptyCard>{m.empty}</DashboardEmptyCard> : null}
  </DashboardPage>;
}
