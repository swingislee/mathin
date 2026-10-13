'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, CornerDownRight, RefreshCw, ChevronsDownUp, ChevronsUpDown, Upload } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { tabsListClassName, tabsTriggerClassName } from '@/components/ui/tabs-styles';
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Link, useRouter } from '@/i18n/navigation';
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandSelection, DashboardCommandState, DashboardPage, DashboardTableColumnHeader, DashboardTableShell } from '../dashboard-page';
import { useDashboardFieldView } from '../dashboard-page/useDashboardFieldView';
import { FollowupRecordRow, FollowupTableBody } from '../dashboard-page/FollowupRecordRow';
import { useDashboardPreference } from '../dashboard-page/DashboardPreferenceScope';
import { FollowupCommandPanel } from '../FollowupCommandPanel';
import { FilterSearchInput } from '../FilterBar';
import { FollowupQueryMemory } from '../FollowupQueryMemory';
import { LeadPoolPagination } from '../LeadPoolPagination';
import { Student360Trigger } from '../Student360Sheet';
import { StudentStageAssignmentControl, StudentStageOwnerControl } from '../StudentStageAssignmentControl';
import { studentStageMessages } from '../student-stage-messages';
import { schoolCollaborationMessages } from '../school-collaboration-contract';
import { communicationEntryMode } from '../work-entry-contract';
import type { StudentEntryMode, StudentStageSaved, StudentStageAssignee, StudentStageAssignment } from '../student-stage-contract';
import { COMMUNICATION_STAGES, href, workMessages, taskPeriodFields, type WorkPage, type WorkQuery, type WorkRow } from './contract';
import { sourceGroupLabels, sourceGroupPath } from './grouping';
import { RecordStatusIcons } from '../record-status/RecordStatusIcons';
import { SourceLayoutFilters } from './SourceLayoutFilters';
import { WORKLIST_COLUMNS, worklistFields } from './fields';
import { useWorklistFields } from './useWorklistFields';
import { useWorklistSelection } from './Selection';

const Entry = dynamic(() => import('../StudentStageEntryLoader').then(m => m.StudentStageEntryLoader));
const QUERY_KEYS = ['stage','scope','group','marker','periodField','period','page','pageSize','fields','batch','interest','channel'];
const monthKey = (row: WorkRow) => `month:${row.worklist.period}`;
const parentKey = (row: WorkRow) => JSON.stringify(['group',row.worklist.period,row.worklist.group]);
const childKey = (row: WorkRow) => JSON.stringify(['person',row.worklist.period,row.worklist.group,row.worklist.subgroup]);
const collapseKeys = (row: WorkRow, allMonths: boolean) => sourceGroupPath(row.worklist,allMonths,'zh').map(group => group.key);
const startingCollapsed = (rows: WorkRow[], allMonths: boolean) => {
  const first = new Set(rows[0] ? collapseKeys(rows[0],allMonths) : []);
  return new Set(rows.flatMap(row => collapseKeys(row,allMonths)).filter(key => !first.has(key)));
};

export function Workspace({ data, query, locale, currentUserId, canEnroll, canAssess, canAssign, canImport, assignees, timeZone, now, firstContactContent }: {
  firstContactContent?: ReactNode; data: WorkPage; query: WorkQuery; locale: string; currentUserId: string; canEnroll: boolean; canAssess: boolean; timeZone: string; now: number;
  canAssign: boolean; canImport: boolean; assignees: StudentStageAssignee[];
}) {
  const m = workMessages(locale), stages = studentStageMessages(locale);
  const leadT = useTranslations('school.leads');
  const firstContact = query.stage === 'awaiting_first_contact';
  const showContext = query.stage === 'awaiting_enrollment' || query.stage === 'former_student';
  const columnCount = showContext ? 7 : 6;
  const tasks = firstContact ? ['awaiting_first_contact' as const] : COMMUNICATION_STAGES;
  const allMonths = query.stage !== 'former_student' && query.period === 'all';
  const router = useRouter();
  const [rows, setRows] = useState(data.rows);
  const [focused, setFocused] = useState<string | null>(null);
  const [active, setActive] = useState<{ id: string; mode: StudentEntryMode } | null>(null);
  const [visited, setVisited] = useState(new Set<string>());
  const [handled, setHandled] = useState(new Set<string>());
  const [collapsed, setCollapsed] = useState(() => query.fields || query.scope === 'mine' ? new Set<string>() : startingCollapsed(data.rows,allMonths));
  const [entryBusy, setBusy] = useState(false);
  const selection = useWorklistSelection();
  const busy = entryBusy || Boolean(selection?.busy);
  const selectionKey = (row: WorkRow) => firstContact && row.leadId ? 'lead:' + row.leadId : row.key;
  const selectedRows = rows.filter(row => selection?.keys.has(selectionKey(row)));
  const sourceFields = useWorklistFields(data.fieldView, query, locale);
  const fields = useDashboardFieldView({ rows, fields: worklistFields(locale,query.stage,currentUserId), columns: WORKLIST_COLUMNS,
    context: { locale,timeZone,now }, server: sourceFields.server });
  const columnProps = (column: keyof typeof WORKLIST_COLUMNS) => {
    const props = fields.columnProps(column);
    return { ...props, disabled: busy, ...(props.fields.some(field => field.kind === 'enum' || field.kind === 'date')
      ? { onLoadFacets: sourceFields.onLoadFacets, facetsStatus: sourceFields.facetsStatus } : {}) };
  };
  const [outcome, setOutcome] = useState<{ id: string; value: '' | 'unreachable' | 'connected' | 'declined' | 'invalid_number' } | null>(null);
  const [acceptedData, setAcceptedData] = useState(data);
  const [refreshRequested, setRefreshRequested] = useState(false);
  if (acceptedData !== data) {
    setAcceptedData(data);
    // Action revalidation updates counts; the active list retains its positions until an explicit refresh.
    if (refreshRequested) { setRows(data.rows); setRefreshRequested(false); setActive(null); setVisited(new Set()); }
    else {
      const fresh = new Map(data.rows.map(row => [row.key,row]));
      setRows(current => current.map(row => {
        const latest = fresh.get(row.key);
        return latest ? { ...row, canWrite: latest.canWrite, canContact: latest.canContact, ownerId: latest.ownerId, ownerName: latest.ownerName }
          : { ...row, canWrite: false, canContact: false };
      }));
    }
  }
  const scopeKey = JSON.stringify(query);
  const memory = useDashboardPreference(`communication-stages:v4:${scopeKey}`);
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
  const modeFor = communicationEntryMode;
  const assigned = (result: StudentStageAssignment[]) => {
    const updated = new Map(result.map(item => [item.key, item.subject]));
    setRows(current => current.flatMap(row => {
      if (!updated.has(row.key)) return [row];
      const subject = updated.get(row.key);
      if (!subject || query.scope === 'mine' && !(subject.isParticipant ?? subject.ownerId === currentUserId)
        || query.scope === 'group' && !subject.inMyGroups || query.scope === 'unassigned' && subject.ownerId !== null) return [];
      return [{ ...subject, communication: subject.communication ?? row.communication, worklist: row.worklist }];
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
  const groups = rows.reduce<{ key: string; rows: WorkRow[] }[]>((result,row) => {
    const key = childKey(row), previous = result.at(-1);
    if (previous?.key === key) previous.rows.push(row); else result.push({ key,rows: [row] });
    return result;
  },[]);
  const periodLabel = (period: string) => period === 'unknown' ? m.unknownPeriod : period === 'all' ? m.allPeriods : locale.startsWith('en') ? `${Number(period.replace('月',''))}` : period;
  const groupHeader = (key: string, label: string, count: number | undefined, depth: number, invisible = false) =>
    <TableRow hidden={invisible} data-followup-group="true" className={depth === 0 ? 'bg-line/20' : 'bg-card'}><TableCell colSpan={columnCount} className="py-1.5 font-medium">
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
    const recent = row.communication?.latestNote ?? row.note;
    return [...new Set([...row.worklist.context].sort((a,b) => rank(a.label)-rank(b.label))
      .map(c => c.value.trim()).filter(value => value && !recent.includes(value)))].slice(0, query.stage === 'former_student' ? 4 : 2).join(' · ');
  };
  const returnFromSearch = () => {
    if (busy) return;
    try { const previous = JSON.parse(searchOrigin.raw ?? 'null'); if (previous && typeof previous === 'object') { router.replace(href(query, { ...previous, q: '' }), { scroll: false }); return; } } catch { /* Return to the current list. */ }
    navigate({ q: '' });
  };
  return <><FollowupQueryMemory preferenceKey={firstContact ? "leads-first-contact-entry:v2" : "communication-stage-entry:v2"} keys={QUERY_KEYS} />
    <DashboardPage title={firstContact ? (locale.startsWith('en') ? 'Leads' : '线索') : m.title} density="compact" commandPanel={<FollowupCommandPanel>
      {selectedRows.length > 0 && selection ? <DashboardCommandSelection>
        <span className="text-xs">{locale.startsWith('en') ? `${selectedRows.length} selected` : `已选 ${selectedRows.length} 人`}</span>
        <StudentStageAssignmentControl rows={selectedRows} assignees={assignees} locale={locale} disabled={busy} context="lead"
          onBusyChange={selection.setBusy} onAssigned={result => { assigned(result); selection.clear(); router.refresh(); }} />
        <Button size="sm" variant="ghost" disabled={busy} onClick={selection.clear}>{locale.startsWith('en') ? 'Clear selection' : '取消选择'}</Button>
      </DashboardCommandSelection> : <>
      <DashboardCommandState>{firstContact ? <SourceLayoutFilters data={data} kind="acquisition" groupMode="lead" section="groups" periodFields={[]} locale={locale} disabled={busy} layout="toolbar"
        onChange={change => navigate({ ...change, marker: '' })} /> : <nav aria-label={m.title} className={`${tabsListClassName} h-auto flex-wrap justify-start gap-1`}>
        {tasks.map(task => <button key={task} type="button" className={`${tabsTriggerClassName} gap-2`} data-state={query.stage === task ? 'active' : 'inactive'} disabled={busy}
          aria-current={query.stage === task ? 'page' : undefined} onClick={() => navigate({ stage: task, lead: '', students: '', group: '', marker: '', q: '', periodField: '', period: '', fields: '' })}>
          {m.tasks[task]}<span className="text-xs tabular-nums text-muted">{data.counts[task]}</span>
        </button>)}
      </nav>}</DashboardCommandState>
      <DashboardCommandFilters>
        <form className="flex min-w-0 max-w-full flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (!busy) { if (!query.q) searchOrigin.save(query); navigate({ q: String(new FormData(event.currentTarget).get('q') ?? '').trim().slice(0,80) }); } }}>
          <FilterSearchInput name="q" defaultValue={query.q} placeholder={m.search} aria-label={m.search} disabled={busy} />
          <select aria-label={locale.startsWith('en') ? 'Source channel' : '来源渠道'} value={query.channel ?? ''} disabled={busy}
            onChange={event => navigate({ channel: event.target.value, batch: '', fields: '' })} className="h-8 rounded-md border border-line bg-card px-2 text-xs">
            <option value="">{locale.startsWith('en') ? 'All sources' : '全部来源'}</option>
            {data.channels.map(channel => <option key={channel.key} value={channel.key}>{channel.key} · {channel.count}</option>)}
          </select>
          {data.batches.length ? <select aria-label={locale.startsWith('en') ? 'Import batch' : '导入批次'} value={query.batch ?? ''} disabled={busy}
            onChange={event => navigate({ batch: event.target.value, period: 'all', group: 'all', fields: '' })} className="h-8 max-w-64 rounded-md border border-line bg-card px-2 text-xs">
            <option value="">{locale.startsWith('en') ? 'All import batches' : '全部导入批次'}</option>
            {data.batches.map(batch => <option key={batch.id} value={batch.id}>{batch.label} · {date(batch.createdAt)}</option>)}
          </select> : null}
          {query.q ? <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={returnFromSearch}>{m.clearSearch}</Button> : null}
          {data.markers.length ? <select aria-label={m.sourceMarks} value={query.marker} disabled={busy} onChange={event => navigate({ marker: event.target.value })} className="h-8 rounded-md border border-line bg-card px-2 text-xs">
            <option value="">{m.allMarkers}</option>{data.markers.map(mark => <option key={mark.key} value={mark.key}>{mark.label} · {mark.count}</option>)}
          </select> : null}
          {!firstContact ? <Button type="button" size="sm" variant={query.interest === 'A' ? 'secondary' : 'ghost'} aria-pressed={query.interest === 'A'} disabled={busy}
            onClick={() => navigate({ interest: query.interest === 'A' ? '' : 'A' })}>{locale.startsWith('en') ? 'High interest · A' : '高意向 · A 级'}</Button> : null}
          <select aria-label={m.all} value={query.scope} disabled={busy} onChange={event => navigate({ scope: event.target.value as WorkQuery['scope'] })} className="h-8 rounded-md border border-line bg-card px-2 text-xs">
            <option value="mine">{m.mine}</option><option value="all">{m.all}</option>
            <option value="group">{locale.startsWith('en') ? 'My groups' : '我的小组'}</option>
            {canAssign || query.scope === 'unassigned' ? <option value="unassigned">{locale.startsWith('en') ? 'Unassigned' : '待分配'}</option> : null}
          </select>
        </form>
        <SourceLayoutFilters data={data} kind="acquisition" groupMode={firstContact ? 'lead' : 'support'} section={firstContact ? 'periods' : 'all'} periodFields={taskPeriodFields(query.stage)} locale={locale} disabled={busy} compactPeriods layout="toolbar"
          onChange={change => navigate({ ...change, marker: '' })} />
      </DashboardCommandFilters>
      <DashboardCommandActions>
        {canAssign ? <Button size="sm" variant={query.scope === 'unassigned' ? 'secondary' : 'ghost'} disabled={busy}
          onClick={() => navigate({ scope: 'unassigned',period: 'all',group: 'all',fields: '' })}>{locale.startsWith('en') ? 'Assign unassigned leads' : '分配待分配名单'}</Button> : null}
        {firstContact && canImport ? <Link href="/dashboard/students/import?from=leads" className={buttonVariants({ variant: 'secondary', size: 'sm' })}><Upload className="size-4" aria-hidden />{leadT('importXiaoditui')}</Link> : null}
        {canAssign ? <Link href="/dashboard/staff?view=organization" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{schoolCollaborationMessages(locale).title}</Link> : null}
        {focused ? <Button size="sm" variant="ghost" className="size-8 p-0" title={m.resume} aria-label={m.resume} disabled={busy} onClick={() => { const row = rows.find(r => r.worklist.id === focused); if (row) { const next = new Set(collapsed); for (const key of collapseKeys(row,allMonths)) next.delete(key); setCollapsed(next); open(row); remember(row.worklist.id,next); } }}><CornerDownRight className="size-4" aria-hidden /></Button> : null}
        <Button size="sm" variant="ghost" className="size-8 p-0" title={m.refresh} aria-label={m.refresh} disabled={busy} onClick={() => { setRefreshRequested(true); router.refresh(); }}><RefreshCw className="size-4" aria-hidden /></Button>
        {!firstContactContent ? <div className="flex items-center gap-0.5 border-l border-line pl-1.5">
          <Button size="sm" variant="ghost" className="size-8 p-0" title={m.collapseAll} aria-label={m.collapseAll} disabled={busy} onClick={() => { const next = new Set(rows.flatMap(row => collapseKeys(row,allMonths))); setCollapsed(next); setActive(null); remember(focused,next); }}><ChevronsDownUp className="size-4" aria-hidden /></Button>
          <Button size="sm" variant="ghost" className="size-8 p-0" title={m.expandAll} aria-label={m.expandAll} disabled={busy} onClick={() => { const next = new Set<string>(); setCollapsed(next); remember(focused,next); }}><ChevronsUpDown className="size-4" aria-hidden /></Button>
        </div> : null}
      </DashboardCommandActions>
      </>}
    </FollowupCommandPanel>} footer={<LeadPoolPagination baseHref={firstContact ? "/dashboard/leads" : "/dashboard/communication"} currentPage={data.page} totalPages={data.totalPages}
      totalCount={data.count} pageSize={data.pageSize} disabled={busy} onPageChange={(page,pageSize) => navigate({ page,pageSize })} />}>
      {firstContactContent ?? <DashboardTableShell><Table mobileLayout="stacked" className="table-fixed text-xs [&_th]:px-2 [&_td]:px-2">
        <TableHeader className="sticky top-0 z-20"><TableRow>
          <TableHead className="w-40"><div className="flex items-center gap-1.5">{canAssign && selection ? <Checkbox
            checked={selectedRows.length && selectedRows.length === rows.length ? true : selectedRows.length ? 'indeterminate' : false}
            disabled={busy || !rows.length} aria-label={locale.startsWith('en') ? 'Select this page' : '选择本页'} onCheckedChange={checked => selection.toggle(rows.map(selectionKey),checked === true)} /> : null}
            <DashboardTableColumnHeader label={m.name} {...columnProps('name')} /></div></TableHead>
          <TableHead className="w-28"><DashboardTableColumnHeader label={m.phone} {...columnProps('phone')} /></TableHead>
          <TableHead className="w-36"><DashboardTableColumnHeader label={locale.startsWith('en') ? 'Learning support' : '学服'} {...columnProps('owner')} /></TableHead>
          <TableHead className="w-36"><DashboardTableColumnHeader label={m.stage} {...columnProps('state')} /></TableHead>{showContext ? <TableHead><DashboardTableColumnHeader label={m.contextByTask[query.stage]} {...columnProps('context')} /></TableHead> : null}
          <TableHead><DashboardTableColumnHeader label={m.recent} {...columnProps('recent')} /></TableHead><TableHead className="w-24 text-right">{m.work}</TableHead>
        </TableRow></TableHeader>
        <FollowupTableBody onNavigate={id => { if (busy) return false; focus(id); return true; }}>
          {groups.map((group,index) => {
            const first = group.rows[0], previous = groups[index - 1]?.rows[0];
            const topHidden = allMonths && collapsed.has(monthKey(first));
            const parentHidden = topHidden || collapsed.has(parentKey(first));
            const count = data.groups.find(g => g.key === first.worklist.group);
            const labels = sourceGroupLabels(first.worklist.kind,locale,first.worklist.groupMode);
            return <Fragment key={`${group.key}:${index}`}>
            {allMonths && (!previous || monthKey(previous) !== monthKey(first)) ? groupHeader(monthKey(first),periodLabel(first.worklist.period),data.periods.find(p => p.key === first.worklist.period)?.count,0) : null}
            {!previous || parentKey(previous) !== parentKey(first) ? groupHeader(parentKey(first),`${labels.group} · ${first.worklist.group}`,allMonths ? undefined : count?.count,allMonths ? 1 : 0,topHidden) : null}
            {first.worklist.subgroup ? groupHeader(childKey(first),`${labels.subgroup} · ${first.worklist.subgroup}`,allMonths ? undefined : count?.subgroups.find(s => s.key === first.worklist.subgroup)?.count,allMonths ? 2 : 1,parentHidden) : null}
            {group.rows.map(row => {
              const placement = row.worklist, expanded = !hidden(row) && active?.id === placement.id;
              const nextAt = row.nextContactAt && Number.isFinite(Date.parse(row.nextContactAt)) ? row.nextContactAt : null;
              const communication = row.communication;
              const recentNote = communication?.latestNote ?? row.note;
              const recentDate = communication?.latestAt && Number.isFinite(Date.parse(communication.latestAt))
                ? date(communication.latestAt) : communication?.latestDateLabel;
              return <FollowupRecordRow key={placement.id} rowKey={placement.id} detailsId={`worklist-${placement.id}`} title={row.name} colSpan={columnCount}
                active={focused === placement.id && !hidden(row)} expanded={expanded} keepMounted={visited.has(placement.id)} pending={busy} focusOnActivate hideTitle
                onActivate={() => focus(placement.id)} onExpandedChange={value => { if (!busy) { if (value) open(row); else setActive(null); } }}
                onSave={row.canWrite ? () => entryRefs.current.get(placement.id)?.save() : undefined}
                onOutcomeChange={query.stage === 'awaiting_first_contact' && row.canContact ? value => { open(row,'contact'); setOutcome({ id: placement.id,value }); } : undefined}
                rowProps={{ hidden: hidden(row), className: 'h-12 cursor-pointer [&>td]:py-1.5 [&>td]:align-middle', 'data-worklist-record': placement.id }}
                summary={<>
                  <TableCell mobileSpan="primary"><div className="flex items-center gap-1.5">{canAssign && selection ? <span onClick={event => event.stopPropagation()}><Checkbox
                    checked={selection.keys.has(selectionKey(row))} disabled={busy} aria-label={`${locale.startsWith('en') ? 'Select' : '选择'} ${row.name}`}
                    onCheckedChange={checked => selection.toggle([selectionKey(row)],checked === true)} /></span> : null}
                    <Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }}>{row.name}</Student360Trigger>
                    {handled.has(placement.id) ? <Check aria-label={m.handled} className="size-3.5 text-leaf-deep" /> : null}</div>
                    <span className="text-[11px] text-muted">{row.grade != null ? `${row.grade}${locale.startsWith('en') ? '' : ' 年级'}` : row.gradeText}</span></TableCell>
                  <TableCell mobileLabel={m.phone}>{row.phone || '—'}</TableCell>
                  <TableCell mobileLabel={locale.startsWith('en') ? 'Learning support' : '学服'}>{canAssign ? <StudentStageOwnerControl row={row} assignees={assignees} locale={locale} disabled={busy} context="lead"
                    onBusyChange={setBusy} onAssigned={result => { assigned(result); router.refresh(); }} /> : row.ownerName || stages.unassigned}</TableCell>
                  <TableCell mobileLabel={m.stage}>{row.detail !== 'unassigned' ? <div className="mb-1 text-[11px] text-muted">{stages.details[row.detail] ?? row.detail}</div> : null}
                    <RecordStatusIcons row={row} locale={locale} /></TableCell>
                  {showContext ? <TableCell mobileLabel={m.contextByTask[query.stage]}><p className="line-clamp-2 leading-5" title={contextText(row)}>{contextText(row) || '—'}</p></TableCell> : null}
                  <TableCell mobileLabel={m.recent}>
                    <p className="line-clamp-2 leading-5" title={recentNote}>{recentNote || (communication?.count ? m.noContactNote : m.noNote)}</p>
                    {communication?.count ? <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                      {recentDate ? <span>{recentDate}</span> : null}
                      <span>{communication.latestOutcome ? m.contactOutcomes[communication.latestOutcome] : m.unknownOutcome}</span>
                      <Student360Trigger className="font-normal text-muted" subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }}>{m.contactCount(communication.count)}</Student360Trigger>
                    </div> : null}
                    {nextAt ? <span className={Date.parse(nextAt) < now ? 'text-rose-deep' : 'text-muted'}>{m.nextContact} · {date(nextAt)}</span> : null}</TableCell>
                  <TableCell mobileLabel={m.work} data-table-mobile-actions><div className="flex flex-wrap justify-end gap-1">
                    {row.canWrite ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => open(row)}>{m.recordByTask[query.stage]}</Button> : <span className="text-muted">{m.noWrite}</span>}
                    {query.stage === 'awaiting_enrollment' && row.registrationId && canAssess ? <Link className="rounded px-2 py-1 text-primary hover:underline" href={`/dashboard/assessments/${row.registrationId}`}>{m.assessment}</Link> : null}
                  </div></TableCell>
                </>}>
                {() => <div className="space-y-2">
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
          {!rows.length ? <TableRow><TableCell colSpan={columnCount} className="h-32 text-center text-muted">{m.empty}</TableCell></TableRow> : null}
        </FollowupTableBody>
      </Table></DashboardTableShell>}
    </DashboardPage></>;
}
