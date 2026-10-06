'use client';

import dynamic from 'next/dynamic';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, ListOrdered, RefreshCw, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tabsListClassName, tabsTriggerClassName } from '@/components/ui/tabs-styles';
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link, useRouter } from '@/i18n/navigation';
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandState, DashboardPage, DashboardTableShell } from '../dashboard-page';
import { FollowupRecordRow, FollowupTableBody } from '../dashboard-page/FollowupRecordRow';
import { useDashboardPreference } from '../dashboard-page/DashboardPreferenceScope';
import { FollowupCommandPanel } from '../FollowupCommandPanel';
import { FilterSearchInput } from '../FilterBar';
import { FollowupQueryMemory } from '../FollowupQueryMemory';
import { LeadPoolPagination } from '../LeadPoolPagination';
import { Student360Trigger } from '../Student360Sheet';
import { StudentStageOwnerControl } from '../StudentStageAssignmentControl';
import { studentStageMessages } from '../student-stage-messages';
import type { StudentEntryMode, StudentStageSaved, StudentStageAssignee, StudentStageAssignment } from '../student-stage-contract';
import { COMMUNICATION_STAGES, href, workMessages, taskPeriodFields, type PeriodField, type WorkPage, type WorkQuery, type WorkRow } from './contract';
import { RecordStatusIcons } from '../record-status/RecordStatusIcons';

const Entry = dynamic(() => import('../StudentStageEntryLoader').then(m => m.StudentStageEntryLoader));
const QUERY_KEYS = ['stage','scope','group','marker','periodField','period','page','pageSize'];
const monthKey = (row: WorkRow) => `month:${row.worklist.period}`;
const parentKey = (row: WorkRow) => JSON.stringify(['group',row.worklist.period,row.worklist.group]);
const childKey = (row: WorkRow) => JSON.stringify(['person',row.worklist.period,row.worklist.group,row.worklist.subgroup]);
const collapseKeys = (row: WorkRow, allMonths: boolean) => [...(allMonths ? [monthKey(row)] : []),parentKey(row),...(row.worklist.subgroup ? [childKey(row)] : [])];
const startingCollapsed = (rows: WorkRow[], allMonths: boolean) => {
  const first = new Set(rows[0] ? collapseKeys(rows[0],allMonths) : []);
  return new Set(rows.flatMap(row => collapseKeys(row,allMonths)).filter(key => !first.has(key)));
};

export function Workspace({ data, query, locale, currentUserId, canEnroll, canViewAll, canAssess, canAssign, assignees, timeZone, now, firstContactContent }: {
  firstContactContent?: ReactNode; data: WorkPage; query: WorkQuery; locale: string; currentUserId: string; canEnroll: boolean; canViewAll: boolean; canAssess: boolean; timeZone: string; now: number;
  canAssign: boolean; assignees: StudentStageAssignee[];
}) {
  const m = workMessages(locale), stages = studentStageMessages(locale);
  const firstContact = query.stage === 'awaiting_first_contact';
  const tasks = firstContact ? ['awaiting_first_contact' as const] : COMMUNICATION_STAGES;
  const allMonths = query.stage !== 'former_student' && query.period === 'all';
  const router = useRouter();
  const [rows, setRows] = useState(data.rows);
  const [focused, setFocused] = useState<string | null>(null);
  const [active, setActive] = useState<{ id: string; mode: StudentEntryMode } | null>(null);
  const [visited, setVisited] = useState(new Set<string>());
  const [handled, setHandled] = useState(new Set<string>());
  const [collapsed, setCollapsed] = useState(() => startingCollapsed(data.rows,allMonths));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ id: string; value: '' | 'unreachable' | 'connected' | 'declined' | 'invalid_number' } | null>(null);
  const [acceptedData, setAcceptedData] = useState(data);
  const [refreshRequested, setRefreshRequested] = useState(false);
  if (acceptedData !== data) {
    setAcceptedData(data);
    // Action revalidation updates counts; the active list retains its positions until an explicit refresh.
    if (refreshRequested) { setRows(data.rows); setRefreshRequested(false); setActive(null); setVisited(new Set()); }
  }
  const scopeKey = JSON.stringify(query);
  const memory = useDashboardPreference(`communication-stages:v3:${scopeKey}`);
  const searchOrigin = useDashboardPreference('communication-stages:before-search');
  const entryRefs = useRef(new Map<string, { save(): void }>());
  const restored = useRef(false);
  useEffect(() => {
    if (!memory.ready || restored.current) return;
    restored.current = true;
    try {
      const saved = JSON.parse(memory.raw ?? 'null');
      if (!saved || typeof saved !== 'object') return;
      const ids = new Set(data.rows.map(r => r.worklist.id));
      const nextPosition = typeof saved.rank === 'number' ? data.rows.find(r => r.worklist.groupKey === saved.groupKey && r.worklist.rank >= saved.rank) : null;
      // Restore display position only after hydration; current authorized rows supply all business facts.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocused(typeof saved.focused === 'string' && ids.has(saved.focused) ? saved.focused : nextPosition?.worklist.id ?? null);
      setCollapsed(new Set(Array.isArray(saved.collapsed) ? saved.collapsed.filter((v: unknown): v is string => typeof v === 'string') : []));
      setHandled(new Set(Array.isArray(saved.handled) ? saved.handled.filter((v: unknown): v is string => typeof v === 'string' && ids.has(v)) : []));
    } catch { /* Keep the current list if a preference is unavailable. */ }
  }, [data.rows, memory.ready, memory.raw]);
  const remember = (id: string | null, groups = collapsed, processed = handled) => {
    const row = rows.find(r => r.worklist.id === id);
    memory.save({ focused: id, rank: row?.worklist.rank, groupKey: row?.worklist.groupKey, collapsed: [...groups], handled: [...processed] });
  };
  const focus = (id: string) => { if (!busy) { setFocused(id); remember(id); } };
  const modeFor = (row: WorkRow): StudentEntryMode => row.canContact && (query.stage === 'awaiting_first_contact' || !row.studentId) ? 'contact' : 'note';
  const assigned = (result: StudentStageAssignment[]) => {
    const updated = new Map(result.map(item => [item.key, item.subject]));
    setRows(current => current.flatMap(row => {
      if (!updated.has(row.key)) return [row];
      const subject = updated.get(row.key);
      if (!subject || query.scope === 'mine' && !(subject.isParticipant ?? subject.ownerId === currentUserId)
        || query.scope === 'group' && !subject.inMyGroups || query.scope === 'unassigned' && subject.ownerId !== null) return [];
      return [{ ...subject, worklist: row.worklist }];
    }));
    setActive(null); setVisited(new Set());
  };
  const open = (row: WorkRow, mode = modeFor(row)) => {
    if (busy) return;
    focus(row.worklist.id); setVisited(old => new Set(old).add(row.worklist.id)); setActive({ id: row.worklist.id, mode });
  };
  const navigate = (change: Partial<WorkQuery>) => { if (!busy) router.replace(href(query, { page: 1, ...change }), { scroll: false }); };
  const hidden = (row: WorkRow) => collapseKeys(row,allMonths).some(key => collapsed.has(key));
  const saved = (row: WorkRow, result: StudentStageSaved, advance: boolean) => {
    const next = rows.slice(rows.indexOf(row) + 1).find(r => !hidden(r));
    const updated = { ...result.subject, worklist: row.worklist };
    setRows(current => current.map(r => r.worklist.id === row.worklist.id ? updated : r));
    const processed = new Set(handled).add(row.worklist.id);
    setHandled(processed); setOutcome(null);
    const target = advance && next ? next : updated;
    setFocused(target.worklist.id); setVisited(old => new Set(old).add(target.worklist.id));
    setActive({ id: target.worklist.id, mode: modeFor(target) }); remember(target.worklist.id, collapsed, processed);
  };
  const groups = [...new Set(rows.map(childKey))].map(key => ({ key, rows: rows.filter(row => childKey(row) === key) }));
  const periodLabel = (period: string) => period === 'unknown' ? m.unknownPeriod : period === 'all' ? m.allPeriods : locale.startsWith('en') ? `${Number(period.replace('月',''))}` : period;
  const groupHeader = (key: string, label: string, count: number | undefined, depth: number, invisible = false) =>
    <TableRow hidden={invisible} data-followup-group="true" className={depth === 0 ? 'bg-line/20' : 'bg-card'}><TableCell colSpan={6} className="py-1.5 font-medium">
      <button disabled={busy} aria-expanded={!collapsed.has(key)} style={{ paddingInlineStart: depth * 18 }} className="flex w-full items-center gap-2 text-left" onClick={() => {
        const next = new Set(collapsed); if (next.has(key)) next.delete(key); else next.add(key); setCollapsed(next);
        const activeRow = rows.find(row => row.worklist.id === active?.id);
        if (next.has(key) && activeRow && collapseKeys(activeRow,allMonths).includes(key)) setActive(null);
        remember(focused,next);
      }}>{collapsed.has(key) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}{label}
        {count !== undefined ? <span className="text-xs font-normal tabular-nums text-muted">{count}</span> : null}
      </button>
    </TableCell></TableRow>;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, month: 'numeric', day: 'numeric' }).format(new Date(value));
  const contextText = (row: WorkRow) => {
    const priority = query.stage === 'awaiting_enrollment' ? ['学员情况','培养重点&核心期待&共识点','家长情况','思维测评等级','学习力测评等级']
      : query.stage === 'awaiting_assessment' ? ['跟进信息','确认信息备注','沟通情况','跟进结果','确认结果'] : [];
    const rank = (label: string) => priority.includes(label) ? priority.indexOf(label) : priority.length;
    return [...row.worklist.context].sort((a,b) => rank(a.label)-rank(b.label)).slice(0, query.stage === 'former_student' ? 4 : 2).map(c => `${c.label}：${c.value}`).join(' · ');
  };
  const returnFromSearch = () => {
    if (busy) return;
    try { const previous = JSON.parse(searchOrigin.raw ?? 'null'); if (previous && typeof previous === 'object') { router.replace(href(query, { ...previous, q: '' }), { scroll: false }); return; } } catch { /* Return to the current list. */ }
    navigate({ q: '' });
  };
  return <><FollowupQueryMemory preferenceKey={firstContact ? "leads-first-contact-entry" : "communication-stage-entry"} keys={QUERY_KEYS} />
    <DashboardPage title={firstContact ? (locale.startsWith('en') ? 'Leads' : '线索') : m.title} density="compact" commandPanel={<FollowupCommandPanel>
      <DashboardCommandState><nav aria-label={m.title} className={`${tabsListClassName} h-auto flex-wrap justify-start gap-1`}>
        {tasks.map(task => <button key={task} type="button" className={`${tabsTriggerClassName} gap-2`} data-state={query.stage === task ? 'active' : 'inactive'} disabled={busy}
          aria-current={query.stage === task ? 'page' : undefined} onClick={() => navigate({ stage: task, lead: '', students: '', group: '', marker: '', q: '', periodField: '', period: '' })}>
          {m.tasks[task]}<span className="text-xs tabular-nums text-muted">{data.counts[task]}</span>
        </button>)}
      </nav></DashboardCommandState>
      <DashboardCommandFilters>
        <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (!busy) { if (!query.q) searchOrigin.save(query); navigate({ q: String(new FormData(event.currentTarget).get('q') ?? '').trim().slice(0,80) }); } }}>
          <FilterSearchInput name="q" defaultValue={query.q} placeholder={m.search} aria-label={m.search} disabled={busy} />
          {query.q ? <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={returnFromSearch}>{m.clearSearch}</Button> : null}
          <select aria-label={m.sourceMarks} value={query.marker} disabled={busy} onChange={event => navigate({ marker: event.target.value })} className="h-8 rounded-md border border-line bg-card px-2 text-xs">
            <option value="">{m.allMarkers}</option>{data.markers.map(mark => <option key={mark.key} value={mark.key}>{mark.label} · {mark.count}</option>)}
          </select>
          <select aria-label={m.all} value={query.scope} disabled={busy} onChange={event => navigate({ scope: event.target.value as WorkQuery['scope'] })} className="h-8 rounded-md border border-line bg-card px-2 text-xs">
            <option value="mine">{m.mine}</option>{canViewAll ? <option value="all">{m.all}</option> : null}
            {query.scope === 'group' || query.scope === 'unassigned' ? <option value={query.scope}>{query.scope === 'group' ? (locale.startsWith('en') ? 'My groups' : '我的小组') : (locale.startsWith('en') ? 'Unassigned' : '待分配')}</option> : null}
          </select>
        </form>
      </DashboardCommandFilters>
      <DashboardCommandActions>
        <span className="inline-flex items-center gap-1 text-xs text-muted"><ListOrdered className="size-3.5" />{m.sourceOrder}</span>
        {focused ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const row = rows.find(r => r.worklist.id === focused); if (row) { const next = new Set(collapsed); for (const key of collapseKeys(row,allMonths)) next.delete(key); setCollapsed(next); open(row); remember(row.worklist.id,next); } }}>{m.resume}</Button> : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setRefreshRequested(true); router.refresh(); }}><RefreshCw className="size-3.5" />{m.refresh}</Button>
      </DashboardCommandActions>
    </FollowupCommandPanel>} footer={<LeadPoolPagination baseHref={firstContact ? "/dashboard/leads" : "/dashboard/communication"} currentPage={data.page} totalPages={data.totalPages}
      totalCount={data.count} pageSize={data.pageSize} disabled={busy} onPageChange={(page,pageSize) => navigate({ page,pageSize })} />}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line py-2">
        {query.stage !== 'former_student' ? <>
          <select aria-label={m.periodBasis} value={query.periodField} disabled={busy} onChange={event => navigate({ periodField: event.target.value as PeriodField, period: '', group: '', marker: '' })} className="h-8 rounded-md border border-line bg-card px-2 text-xs">
            {taskPeriodFields(query.stage).map(field => <option key={field} value={field}>{m.periods[field]}</option>)}
          </select>
          <nav aria-label={m.periods[query.periodField]} className={`${tabsListClassName} h-auto max-w-full justify-start overflow-x-auto gap-1`}>
            {data.periods.map(period => <button key={period.key} type="button" disabled={busy} className={`${tabsTriggerClassName} gap-1.5 px-2 text-xs`} data-state={query.period === period.key ? 'active' : 'inactive'} aria-current={query.period === period.key ? 'page' : undefined} onClick={() => navigate({ period: period.key, group: '', marker: '' })}>
              {periodLabel(period.key)}<span className="text-[10px] tabular-nums text-muted">{period.count}</span>
            </button>)}
            <button type="button" disabled={busy} className={`${tabsTriggerClassName} px-2 text-xs`} data-state={query.period === 'all' ? 'active' : 'inactive'} aria-current={query.period === 'all' ? 'page' : undefined} onClick={() => navigate({ period: 'all', group: '', marker: '' })}>{m.allPeriods}</button>
          </nav>
        </> : <span className="text-xs text-muted">{m.groupByTask.former_student} → {m.subgroupByTask.former_student}</span>}
        {!firstContactContent ? <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="size-7 p-0" title={m.collapseAll} aria-label={m.collapseAll} disabled={busy} onClick={() => { const next = new Set(rows.flatMap(row => collapseKeys(row,allMonths))); setCollapsed(next); setActive(null); remember(focused,next); }}><ChevronsDownUp className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" className="size-7 p-0" title={m.expandAll} aria-label={m.expandAll} disabled={busy} onClick={() => { const next = new Set<string>(); setCollapsed(next); remember(focused,next); }}><ChevronsUpDown className="size-3.5" /></Button>
        </div> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line py-1.5">
        <span className="shrink-0 text-xs text-muted">{m.groupByTask[query.stage]}</span>
        <nav aria-label={m.groupByTask[query.stage]} className={`${tabsListClassName} h-auto max-w-full justify-start overflow-x-auto gap-1`}>
          <button type="button" disabled={busy} className={`${tabsTriggerClassName} px-2 text-xs`} data-state={query.group === 'all' ? 'active' : 'inactive'} aria-current={query.group === 'all' ? 'page' : undefined} onClick={() => navigate({ group: 'all', marker: '' })}>{m.allGroups}</button>
          {data.groups.map(group => <button key={group.key} type="button" disabled={busy} className={`${tabsTriggerClassName} gap-1.5 px-2 text-xs`} data-state={query.group === group.key ? 'active' : 'inactive'} aria-current={query.group === group.key ? 'page' : undefined} onClick={() => navigate({ group: group.key, marker: '' })}>
            {group.key}<span className="text-[10px] tabular-nums text-muted">{group.count}</span>
          </button>)}
        </nav>
      </div>
      {firstContactContent ?? <DashboardTableShell><Table mobileLayout="stacked" className="table-fixed text-xs [&_th]:px-2 [&_td]:px-2">
        <TableHeader className="sticky top-0 z-20"><TableRow>
          <TableHead className="w-40">{m.name}</TableHead><TableHead className="w-28">{m.phone}</TableHead>
          <TableHead className="w-48">{m.stage}</TableHead><TableHead>{m.contextByTask[query.stage]}</TableHead>
          <TableHead>{m.recent}</TableHead><TableHead className="w-36 text-right">{m.work}</TableHead>
        </TableRow></TableHeader>
        <FollowupTableBody onNavigate={id => { if (busy) return false; focus(id); return true; }}>
          {groups.map((group,index) => {
            const first = group.rows[0], previous = groups[index - 1]?.rows[0];
            const topHidden = allMonths && collapsed.has(monthKey(first));
            const parentHidden = topHidden || collapsed.has(parentKey(first));
            const count = data.groups.find(g => g.key === first.worklist.group);
            return <Fragment key={group.key}>
            {allMonths && (!previous || monthKey(previous) !== monthKey(first)) ? groupHeader(monthKey(first),periodLabel(first.worklist.period),data.periods.find(p => p.key === first.worklist.period)?.count,0) : null}
            {!previous || parentKey(previous) !== parentKey(first) ? groupHeader(parentKey(first),`${m.groupByTask[query.stage]} · ${first.worklist.group}`,allMonths ? undefined : count?.count,allMonths ? 1 : 0,topHidden) : null}
            {first.worklist.subgroup ? groupHeader(childKey(first),`${m.subgroupByTask[query.stage]} · ${first.worklist.subgroup}`,allMonths ? undefined : count?.subgroups.find(s => s.key === first.worklist.subgroup)?.count,allMonths ? 2 : 1,parentHidden) : null}
            {group.rows.map(row => {
              const placement = row.worklist, expanded = !hidden(row) && active?.id === placement.id;
              const nextAt = row.nextContactAt && Number.isFinite(Date.parse(row.nextContactAt)) ? row.nextContactAt : null;
              return <FollowupRecordRow key={placement.id} rowKey={placement.id} detailsId={`worklist-${placement.id}`} title={row.name} colSpan={6}
                active={focused === placement.id && !hidden(row)} expanded={expanded} keepMounted={visited.has(placement.id)} pending={busy} focusOnActivate
                onActivate={() => focus(placement.id)} onExpandedChange={value => { if (!busy) { if (value) open(row); else setActive(null); } }}
                onSave={row.canWrite ? () => entryRefs.current.get(placement.id)?.save() : undefined}
                onOutcomeChange={query.stage === 'awaiting_first_contact' && row.canContact ? value => { open(row,'contact'); setOutcome({ id: placement.id,value }); } : undefined}
                rowProps={{ hidden: hidden(row), className: 'h-12 cursor-pointer [&>td]:py-1.5 [&>td]:align-middle', 'data-worklist-record': placement.id }}
                summary={<>
                  <TableCell mobileSpan="primary"><div className="flex items-center gap-1.5"><Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }}>{row.name}</Student360Trigger>
                    {handled.has(placement.id) ? <Check aria-label={m.handled} className="size-3.5 text-leaf-deep" /> : null}</div>
                    <span className="text-[11px] text-muted">{row.gradeText || (row.grade ? `${row.grade}${locale.startsWith('en') ? '' : ' 年级'}` : '')}</span>
                    <div className="max-w-36 text-[11px] text-muted">{canAssign ? <StudentStageOwnerControl row={row} assignees={assignees} locale={locale} disabled={busy} onBusyChange={setBusy} onAssigned={assigned} /> : row.ownerName || stages.unassigned}</div></TableCell>
                  <TableCell mobileLabel={m.phone}>{row.phone || '—'}</TableCell>
                  <TableCell mobileLabel={m.stage}><div className="mb-1 text-[11px] text-muted">{stages.stages[row.stage]} · {stages.details[row.detail] ?? row.detail}</div>
                    <RecordStatusIcons row={row} locale={locale} /></TableCell>
                  <TableCell mobileLabel={m.contextByTask[query.stage]}><p className="line-clamp-2 leading-5" title={contextText(row)}>{contextText(row) || m.noContext}</p></TableCell>
                  <TableCell mobileLabel={m.recent}><p className="line-clamp-2 leading-5" title={row.note}>{row.note || m.noNote}</p>
                    {nextAt ? <span className={Date.parse(nextAt) < now ? 'text-rose-deep' : 'text-muted'}>{date(nextAt)}</span> : null}</TableCell>
                  <TableCell mobileLabel={m.work} data-table-mobile-actions><div className="flex flex-wrap justify-end gap-1">
                    {row.canWrite ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => open(row)}>{m.recordByTask[query.stage]}</Button> : <span className="text-muted">{m.noWrite}</span>}
                    {query.stage === 'awaiting_enrollment' && row.registrationId && canAssess ? <Link className="rounded px-2 py-1 text-primary hover:underline" href={`/dashboard/assessments/${row.registrationId}`}>{m.assessment}</Link> : null}
                  </div></TableCell>
                </>}>
                {() => <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">{row.canContact ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => open(row,'invitation')}>{m.invitation}</Button> : null}
                    {row.studentId && row.canWrite ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => open(row,'enrollment')}>{m.enrollment}</Button> : null}
                    <Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }}>{m.open}</Student360Trigger>
                  </div>
                  {row.canWrite ? <Entry row={row} requestedMode={active?.id === placement.id ? active.mode : modeFor(row)} locale={locale} currentUserId={currentUserId} canEnroll={canEnroll}
                    contactContext={firstContact ? 'first_contact' : 'followup'}
                    ref={entry => { if (entry) entryRefs.current.set(placement.id,entry); else entryRefs.current.delete(placement.id); }}
                    outcomeRequest={outcome?.id === placement.id ? outcome : null} canAdvance={rows.slice(rows.indexOf(row)+1).some(r => !hidden(r))}
                    onBusyChange={setBusy} onSaved={(result,advance) => saved(row,result,advance)} /> : null}
                  {placement.context.length ? <details className="text-xs"><summary className="cursor-pointer text-muted">{m.source}</summary><dl className="mt-2 grid gap-2 sm:grid-cols-2">{placement.context.map(c => <div key={c.label}><dt className="text-muted">{c.label}</dt><dd className="whitespace-pre-wrap leading-6">{c.value}</dd></div>)}</dl></details> : null}
                </div>}
              </FollowupRecordRow>;
            })}
          </Fragment>; })}
          {!rows.length ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted">{m.empty}</TableCell></TableRow> : null}
        </FollowupTableBody>
      </Table></DashboardTableShell>}
    </DashboardPage></>;
}
