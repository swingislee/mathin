"use client";

import dynamic from "next/dynamic";
import { Fragment, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, ChevronDown, MessageSquarePlus, RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandState, DashboardCommandTabs, DashboardEmptyCard, DashboardPage, DashboardTableShell } from "./dashboard-page";
import { FollowupCommandPanel } from "./FollowupCommandPanel";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { Student360Trigger } from "./Student360Sheet";
import { LeadPoolPagination } from "./LeadPoolPagination";
import { studentStageMessages } from "./student-stage-messages";
import { defaultStudentEntryMode, replaceSavedStudent, STUDENT_STAGE_DETAILS, STUDENT_STAGE_TABS, studentStageHref,
  type StudentEntryMode, type StudentStageData, type StudentStageFilters, type StudentStageRow, type StudentStageSaved } from "./student-stage-contract";

const Entry = dynamic(() => import("./StudentStageEntry").then(m => m.StudentStageEntry));

export function StudentStageWorkspace({ data, filters, locale, currentUserId, canEnroll, actions, timeZone }: {
  data: StudentStageData; filters: StudentStageFilters; locale: string; currentUserId: string;
  canEnroll: boolean; actions: ReactNode; timeZone: string;
}) {
  const m = studentStageMessages(locale);
  const studentT = useTranslations("school.students");
  const router = useRouter();
  const viewKey = JSON.stringify(filters);
  const [rows, setRows] = useState(data.rows);
  const [active, setActive] = useState<{ key: string; mode: StudentEntryMode } | null>(null);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [resetRequested, setResetRequested] = useState(false);
  const [accepted, setAccepted] = useState({ data, viewKey });
  if (accepted.data !== data || accepted.viewKey !== viewKey) {
    setAccepted({ data, viewKey });
    if (accepted.viewKey !== viewKey || resetRequested) {
      setRows(data.rows); setActive(null); setVisited(new Set()); setHandled(new Set()); setResetRequested(false);
    }
  }
  const formatAt = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value)) : "—";
  const navigate = (change: Partial<StudentStageFilters>) => { if (!busy) router.replace(studentStageHref(filters, { page: 1, ...change }), { scroll: false }); };
  const open = (row: StudentStageRow, mode: StudentEntryMode = defaultStudentEntryMode(row)) => {
    if (busy) return;
    setMenuKey(null); setVisited(current => new Set(current).add(row.key)); setActive({ key: row.key, mode });
  };
  const saved = (originalKey: string, result: StudentStageSaved, advance: boolean) => {
    const next = rows[rows.findIndex(row => row.key === originalKey) + 1];
    setRows(current => replaceSavedStudent(current, originalKey, result.subject));
    setHandled(current => new Set(current).add(result.subject.key));
    setVisited(current => { const values = new Set(current); values.delete(originalKey); values.add(result.subject.key); if (advance && next) values.add(next.key); return values; });
    setActive(advance && next ? { key: next.key, mode: defaultStudentEntryMode(next) }
      : { key: result.subject.key, mode: defaultStudentEntryMode(result.subject) });
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
        <Button size="sm" variant="ghost" disabled={busy || resetRequested} onClick={() => { setResetRequested(true); router.refresh(); }}><RefreshCw className="size-3.5" />{m.refresh}</Button>
        {actions}
      </DashboardCommandActions>
    </FollowupCommandPanel>}
    summary={filters.q ? <p className="text-xs text-muted">{m.searchHint}</p> : filters.stage === "former_student" ? <p className="text-xs text-muted">{m.formerHint}</p> : null}
    footer={<LeadPoolPagination baseHref="/dashboard/students" currentPage={data.page} totalPages={data.totalPages} totalCount={data.count}
      pageSize={data.pageSize} scope={filters.scope} q={filters.q} extraQuery={{ stage: filters.stage, ...(filters.detail ? { detail: filters.detail } : {}) }}
      disabled={busy} onPageChange={(page, pageSize) => navigate({ page, pageSize })} />}>
    <DashboardTableShell data-followup-workbench>
      <Table className="min-w-[62rem] table-fixed text-sm">
        <TableHeader className="sticky top-0 z-20 bg-paper text-xs text-muted"><TableRow>
          <TableHead className="w-44">{m.name}</TableHead>
          <TableHead className="w-44"><Select value={filters.detail || "all"} onValueChange={value => navigate({ detail: value === "all" ? "" : value })} disabled={busy || Boolean(filters.q)}>
            <SelectTrigger className="h-8 border-0 bg-transparent px-0 text-xs shadow-none" aria-label={m.state}><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="all">{m.allDetails}</SelectItem>{STUDENT_STAGE_DETAILS[filters.stage].map(value => <SelectItem key={value} value={value}>{m.details[value]}</SelectItem>)}
            </SelectContent></Select></TableHead>
          <TableHead className="w-44">{m.background}</TableHead>
          <TableHead className="w-28"><Select value={filters.scope} onValueChange={scope => navigate({ scope: scope as StudentStageFilters["scope"] })} disabled={busy}>
            <SelectTrigger className="h-8 border-0 bg-transparent px-0 text-xs shadow-none" aria-label={m.owner}><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="mine">{m.mine}</SelectItem><SelectItem value="all">{m.all}</SelectItem><SelectItem value="unassigned">{m.unassigned}</SelectItem>
            </SelectContent></Select></TableHead>
          <TableHead className="w-64">{m.recent}</TableHead><TableHead className="w-32">{m.nextContact}</TableHead><TableHead className="w-48 text-right">{m.actions}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map((row, index) => {
          const expanded = active?.key === row.key;
          const contactMode = defaultStudentEntryMode(row);
          const enrollmentLabel = row.stage === "awaiting_renewal" ? m.renewal : row.stage === "former_student" ? m.reactivate : m.enrollment;
          return <Fragment key={row.key}><TableRow tabIndex={0} data-student-stage-row={row.key} data-student-stage={row.stage} data-followup-active={expanded} data-followup-expanded={expanded}
            aria-expanded={expanded} aria-controls={`student-stage-details-${row.key}`} className="h-20 cursor-pointer focus-visible:outline-none"
            onClick={event => { if (!(event.target as Element).closest("button,a,input,[role='combobox']")) open(row); }}
            onKeyDown={event => { if (event.target === event.currentTarget && event.key === "Enter") { event.preventDefault(); open(row); } }}>
            <TableCell className="align-top"><Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, grade: row.grade }} className="font-medium">{row.name}</Student360Trigger>
              <p className="mt-1 text-xs text-muted">{row.grade ? studentT("grade", { grade: row.grade }) : row.gradeText || "—"}</p><p className="mt-0.5 text-xs tabular-nums text-muted">{row.phone || "—"}</p></TableCell>
            <TableCell className="space-y-1.5 align-top"><p className="text-xs text-muted">{m.stages[row.stage]}</p><Badge variant="outline" className="max-w-full whitespace-normal rounded-md px-1.5 py-0.5">{m.details[row.detail] ?? row.detail}</Badge>
              {handled.has(row.key) ? <p className="text-[11px] text-leaf-deep">{m.retained}</p> : null}</TableCell>
            <TableCell className="align-top text-xs leading-5"><p className="line-clamp-2">{row.courseTitle ? `${row.courseTitle} · ${row.termName}`
              : row.assessmentBand || row.score !== null ? [row.assessmentBand?.toUpperCase().replaceAll("_PLUS", "+"), row.score !== null ? String(row.score) : null].filter(Boolean).join(" · ") : m.noAssessment}</p>
              {row.assessmentAt ? <p className="text-[11px] text-muted">{formatAt(row.assessmentAt)}</p> : null}</TableCell>
            <TableCell className="align-top text-xs">{row.ownerName || m.unassigned}</TableCell>
            <TableCell className="align-top"><p className="line-clamp-2 whitespace-pre-wrap text-xs leading-5">{row.note || m.noNote}</p>
              {row.lastContactAt ? <p className="mt-1 text-[11px] text-muted">{formatAt(row.lastContactAt)}</p> : null}</TableCell>
            <TableCell className="align-top text-xs text-muted">{row.nextContactAt ? formatAt(row.nextContactAt) : "—"}</TableCell>
            <TableCell className="align-top"><div className="flex flex-wrap justify-end gap-1">
              {row.canWrite ? <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={busy} onClick={() => open(row, contactMode)}><MessageSquarePlus className="size-3.5" />{contactMode === "contact" ? m.contact : m.note}</Button> : null}
              {row.stage === "awaiting_assessment" && row.canContact ? <Button size="sm" variant="secondary" className="h-8 px-2 text-xs" disabled={busy} onClick={() => open(row, "invitation")}><CalendarPlus className="size-3.5" />{row.detail === "no_show" || row.detail === "cancelled" ? m.rebook : m.book}</Button>
                : row.studentId && row.canWrite && row.stage !== "awaiting_first_contact" ? <Button size="sm" variant="secondary" className="h-8 px-2 text-xs" disabled={busy} onClick={() => open(row, "enrollment")}>{enrollmentLabel}</Button> : null}
              {row.canWrite ? <Popover open={menuKey === row.key} onOpenChange={value => setMenuKey(value ? row.key : null)}><PopoverTrigger asChild><Button size="sm" variant="ghost" className="h-8 px-1.5 text-xs" disabled={busy}>{m.more}<ChevronDown className="size-3" /></Button></PopoverTrigger>
                <PopoverContent align="end" className="flex w-44 flex-col gap-1 p-1.5">{row.canContact ? <Button variant="ghost" size="sm" className="justify-start" onClick={() => open(row, "invitation")}>{m.invitation}</Button> : null}
                  {row.studentId ? <Button variant="ghost" size="sm" className="justify-start" onClick={() => open(row, "enrollment")}>{enrollmentLabel}</Button> : null}</PopoverContent></Popover> : null}
            </div></TableCell>
          </TableRow>
          <FollowupInlineDetails open={expanded} keepMounted={visited.has(row.key)} active={expanded} pending={busy && expanded}
            onOpenChange={openValue => { if (!openValue && !busy) setActive(null); }} title={row.name} colSpan={7} id={`student-stage-details-${row.key}`}>
            {() => row.canWrite ? <Entry row={row} requestedMode={expanded ? active.mode : contactMode} locale={locale} currentUserId={currentUserId} canEnroll={canEnroll}
              canAdvance={index < rows.length - 1} onBusyChange={setBusy} onSaved={(result, advance) => saved(row.key, result, advance)} /> : <p className="text-sm text-muted">{m.needOwner}</p>}
          </FollowupInlineDetails></Fragment>;
        })}</TableBody>
      </Table>
    </DashboardTableShell>
    {rows.length === 0 ? <DashboardEmptyCard>{m.empty}</DashboardEmptyCard> : null}
  </DashboardPage>;
}
