"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, Ellipsis, RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandState, DashboardCommandTabs, DashboardEmptyCard, DashboardPage, DashboardTableShell } from "./dashboard-page";
import { FollowupCommandPanel } from "./FollowupCommandPanel";
import { FollowupRecordRow, FollowupTableBody } from "./dashboard-page/FollowupRecordRow";
import { Student360Trigger } from "./Student360Sheet";
import { LeadPoolPagination } from "./LeadPoolPagination";
import { StudentStageAssignmentControl, StudentStageOwnerControl } from "./StudentStageAssignmentControl";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { studentStageMessages } from "./student-stage-messages";
import { defaultStudentEntryMode, replaceSavedStudent, STUDENT_STAGE_DETAILS, STUDENT_STAGE_TABS, studentStageHref,
  type StudentEntryMode, type StudentStageData, type StudentStageFilters, type StudentStageRow, type StudentStageSaved, type StudentStageAssignment, type StudentStageAssignee } from "./student-stage-contract";

const Entry = dynamic(() => import("./StudentStageEntry").then(m => m.StudentStageEntry));

export function StudentStageWorkspace({ data, filters, locale, currentUserId, canEnroll, canAssign, assignees, actions, timeZone }: {
  data: StudentStageData; filters: StudentStageFilters; locale: string; currentUserId: string;
  canEnroll: boolean; actions: ReactNode; timeZone: string;
  canAssign: boolean; assignees: StudentStageAssignee[];
}) {
  const m = studentStageMessages(locale);
  const studentT = useTranslations("school.students");
  const router = useRouter();
  const showBackground = filters.stage !== "awaiting_first_contact" && filters.stage !== "awaiting_assessment";
  const viewKey = JSON.stringify(filters);
  const [rows, setRows] = useState(data.rows);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const selectedRows = rows.filter(row => selectedKeys.has(row.key));
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
  const formatAt = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(value)) : "—";
  const navigate = (change: Partial<StudentStageFilters>) => { if (!busy) router.replace(studentStageHref(filters, { page: 1, ...change }), { scroll: false }); };
  const open = (row: StudentStageRow, mode: StudentEntryMode = defaultStudentEntryMode(row)) => {
    if (busy) return;
    setMenuKey(null); setFocusedKey(row.key); setVisited(current => new Set(current).add(row.key)); setActive({ key: row.key, mode });
  };
  const saved = (originalKey: string, result: StudentStageSaved, advance: boolean) => {
    setOutcomeRequest(null);
    const next = rows[rows.findIndex(row => row.key === originalKey) + 1];
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
          href: studentStageHref(filters, { stage, page: 1, detail: "", q: "" }) }))} /></DashboardCommandState>
      <DashboardCommandFilters><form className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget); navigate({ q: String(form.get("q") ?? "").trim(), detail: "" });
      }}><Input key={filters.q} name="q" defaultValue={filters.q} placeholder={m.search} aria-label={m.search} disabled={busy} className="h-8 w-60 text-xs" />
        <Button type="submit" size="sm" variant="secondary" disabled={busy}>{studentT("filter")}</Button>
        {filters.q ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => navigate({ q: "", detail: "" })}>{studentT("reset")}</Button> : null}
      </form></DashboardCommandFilters>
      <DashboardCommandActions>
        {canAssign && selectedRows.length ? <><span className="text-xs text-muted">{m.selected} {selectedRows.length}</span>
          <StudentStageAssignmentControl rows={selectedRows} assignees={assignees} locale={locale} disabled={busy} onBusyChange={setBusy} onAssigned={assigned} />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelectedKeys(new Set())}>{m.clearSelection}</Button></> : null}
        <Button size="sm" variant="ghost" disabled={busy || resetRequested} onClick={() => { setResetRequested(true); router.refresh(); }}><RefreshCw className="size-3.5" />{m.refresh}</Button>
        {actions}
      </DashboardCommandActions>
    </FollowupCommandPanel>}
    summary={filters.q ? <p className="text-xs text-muted">{m.searchHint}</p> : filters.stage === "former_student" ? <p className="text-xs text-muted">{m.formerHint}</p> : null}
    footer={<LeadPoolPagination baseHref="/dashboard/students" currentPage={data.page} totalPages={data.totalPages} totalCount={data.count}
      pageSize={data.pageSize} scope={filters.scope} q={filters.q} extraQuery={{ stage: filters.stage, ...(filters.detail ? { detail: filters.detail } : {}) }}
      disabled={busy} onPageChange={(page, pageSize) => navigate({ page, pageSize })} />}>
    <DashboardTableShell data-followup-workbench>
      <Table className={`table-fixed text-xs [&_th]:px-2 ${showBackground ? "min-w-[63rem]" : "min-w-[53rem]"}`}>
        <TableHeader className="sticky top-0 z-20 bg-paper text-xs text-muted"><TableRow>
          {canAssign ? <TableHead className="w-9"><Checkbox aria-label={m.selectPage} disabled={busy || !rows.length}
            checked={Boolean(rows.length) && selectedRows.length === rows.length ? true : selectedRows.length ? "indeterminate" : false}
            onCheckedChange={checked => setSelectedKeys(new Set(checked === true ? rows.map(row => row.key) : []))} /></TableHead> : null}
          <TableHead className="w-36">{m.name}</TableHead>
          <TableHead className="w-28">{m.phone}</TableHead>
          <TableHead className="w-32"><Select value={filters.detail || "all"} onValueChange={value => navigate({ detail: value === "all" ? "" : value })} disabled={busy || Boolean(filters.q)}>
            <SelectTrigger className="h-8 border-0 bg-transparent px-0 text-xs shadow-none" aria-label={m.state}><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all">{m.allDetails}</SelectItem>{STUDENT_STAGE_DETAILS[filters.stage].map(value => <SelectItem key={value} value={value}>{m.details[value]}</SelectItem>)}
            </SelectContent></Select></TableHead>
          {showBackground ? <TableHead className="w-40">{m.background}</TableHead> : null}
          <TableHead className="w-20"><Select value={filters.scope} onValueChange={scope => navigate({ scope: scope as StudentStageFilters["scope"] })} disabled={busy}>
            <SelectTrigger className="h-8 border-0 bg-transparent px-0 text-xs shadow-none" aria-label={m.owner}><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="mine">{m.mine}</SelectItem><SelectItem value="all">{m.all}</SelectItem><SelectItem value="unassigned">{m.unassigned}</SelectItem>
            </SelectContent></Select></TableHead>
          <TableHead>{m.recent}</TableHead><TableHead className={locale.startsWith("en") ? "w-64 text-right" : "w-48 text-right"}>{m.actions}</TableHead>
        </TableRow></TableHeader>
        <FollowupTableBody onNavigate={key => { if (busy) return false; setFocusedKey(key); return true; }}>{rows.map((row, index) => {
          const expanded = active?.key === row.key;
          const contactMode = defaultStudentEntryMode(row);
          const enrollmentLabel = row.stage === "awaiting_renewal" ? m.renewal : row.stage === "former_student" ? m.reactivate : m.enrollment;
          const grade = row.grade ? studentT("grade", { grade: row.grade }) : row.gradeText || "—";
          const situation = m.details[row.detail] ?? row.detail;
          const showStage = Boolean(filters.q) || row.stage !== filters.stage;
          const background = row.courseTitle ? `${row.courseTitle} · ${row.termName}`
            : row.assessmentBand || row.score !== null ? [row.assessmentBand?.toUpperCase().replaceAll("_PLUS", "+"), row.score !== null ? String(row.score) : null].filter(Boolean).join(" · ") : m.noAssessment;
          return <FollowupRecordRow key={row.key} rowKey={row.key} expanded={expanded} active={focusedKey === row.key} focusOnActivate
            pending={busy} keepMounted={visited.has(row.key)} onActivate={() => { if (!busy) setFocusedKey(row.key); }}
            onExpandedChange={value => { if (!busy) { if (value) open(row); else setActive(null); } }}
            onOutcomeChange={row.stage === "awaiting_first_contact" && row.canContact ? value => { open(row, "contact"); setOutcomeRequest({ key: row.key, value }); } : undefined}
            onSave={row.canWrite ? () => entryRefs.current.get(row.key)?.save() : undefined}
            detailsId={`student-stage-details-${row.key}`} title={row.name} colSpan={(showBackground ? 7 : 6) + (canAssign ? 1 : 0)} selected={selectedKeys.has(row.key)}
            rowProps={{ "data-student-stage-row": row.key, "data-student-stage": row.stage,
              className: "h-10 cursor-pointer focus-visible:outline-none [&>td]:px-2 [&>td]:py-1 [&>td]:align-middle [&>td]:whitespace-nowrap" }}
            summary={<>
            {canAssign ? <TableCell><Checkbox aria-label={`${m.selectStudent} · ${row.name}`} disabled={busy} checked={selectedKeys.has(row.key)}
              onCheckedChange={checked => setSelectedKeys(current => { const next = new Set(current); if (checked === true) next.add(row.key); else next.delete(row.key); return next; })} /></TableCell> : null}
            <TableCell title={`${row.name} · ${grade}`}><div className="flex min-w-0 items-center gap-1.5">
              <Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, grade: row.grade }} className="min-w-0 truncate font-medium">{row.name}</Student360Trigger>
              <span className="max-w-16 shrink-0 truncate text-[11px] text-muted">{grade}</span>
            </div></TableCell>
            <TableCell title={row.phone || undefined}><p className="truncate tabular-nums text-muted">{row.phone || "—"}</p></TableCell>
            <TableCell title={`${m.stages[row.stage]} · ${situation}`}><div className="flex min-w-0 items-center gap-1.5">
              <Badge variant="outline" className="min-w-0 max-w-full rounded-md px-1.5 py-0"><span className="truncate">{showStage ? `${m.stages[row.stage]} · ` : ""}{situation}</span></Badge>
              {handled.has(row.key) ? <span role="img" aria-label={m.retained} title={m.retained} className="shrink-0 text-leaf-deep"><Check className="size-3.5" aria-hidden="true" /></span> : null}
            </div></TableCell>
            {showBackground ? <TableCell title={[background, row.assessmentAt ? formatAt(row.assessmentAt) : ""].filter(Boolean).join(" · ")}><p className="truncate">{background}</p></TableCell> : null}
            <TableCell title={row.ownerName || m.unassigned}>{canAssign ? <StudentStageOwnerControl row={row} assignees={assignees} locale={locale} disabled={busy}
              onBusyChange={setBusy} onAssigned={assigned} /> : <p className="truncate">{row.ownerName || m.unassigned}</p>}</TableCell>
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
              canAdvance={index < rows.length - 1} onBusyChange={setBusy} onSaved={(result, advance) => saved(row.key, result, advance)} /> : <p className="text-sm text-muted">{m.needOwner}</p>}
          </FollowupRecordRow>;
        })}</FollowupTableBody>
      </Table>
    </DashboardTableShell>
    {rows.length === 0 ? <DashboardEmptyCard>{m.empty}</DashboardEmptyCard> : null}
  </DashboardPage>;
}
