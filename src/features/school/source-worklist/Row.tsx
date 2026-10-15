'use client';

import dynamic from 'next/dynamic';
import { memo, type RefObject } from 'react';
import { Check } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell } from '@/components/ui/table';
import { Link } from '@/i18n/navigation';
import { FollowupRecordRow } from '../dashboard-page/FollowupRecordRow';
import { DashboardRowDisclosure } from '../dashboard-page/DashboardRowDisclosure';
import { Student360Trigger } from '../Student360Sheet';
import { StudentStageOwnerControl } from '../StudentStageAssignmentControl';
import { RecordStatusIcons } from '../record-status/RecordStatusIcons';
import { communicationEntryMode } from '../work-entry-contract';
import type { studentStageMessages } from '../student-stage-messages';
import type { StudentEntryMode, StudentStageAssignee, StudentStageAssignment, StudentStageSaved } from '../student-stage-contract';
import type { WorkQuery, WorkRow, workMessages } from './contract';
import { SourceInfo } from './SourceInfo';
import { SourceDateText } from '../SourceDateText';
import { communicationNoteSummary, worklistGrade } from './summary';

const Entry = dynamic(() => import('../StudentStageEntryLoader').then(m => m.StudentStageEntryLoader));

export type WorklistOutcome = { id: string; value: '' | 'unreachable' | 'connected' | 'declined' | 'invalid_number' };
/** 整页共用的显示条件；父组件按依赖缓存，点击单行时引用不变。 */
export interface WorklistRowView {
  stage: WorkQuery['stage']; locale: string; now: number; currentUserId: string; canEnroll: boolean; canAssess: boolean; canAssign: boolean;
  selectable: boolean; showContext: boolean; columnCount: number; assignees: StudentStageAssignee[];
  m: ReturnType<typeof workMessages>; stages: ReturnType<typeof studentStageMessages>; date: (value: string) => string;
}
/** 行内操作读取名单的最新状态；以引用传入，点击一行只重画状态变化的行。 */
export interface WorklistRowActions {
  focus(id: string): void; open(row: WorkRow, mode?: StudentEntryMode): void; close(): void; outcome(row: WorkRow, value: WorklistOutcome['value']): void;
  saved(row: WorkRow, result: StudentStageSaved, advance: boolean): void; assigned(result: StudentStageAssignment[]): void;
  select(row: WorkRow, checked: boolean): void; setBusy(value: boolean): void; save(id: string): void; register(id: string, entry: { save(): void } | null): void;
}

function contextText(row: WorkRow, stage: WorkQuery['stage']) {
  const priority = stage === 'awaiting_enrollment' ? ['学员情况','培养重点&核心期待&共识点','家长情况','思维测评等级','学习力测评等级']
    : stage === 'awaiting_assessment' ? ['跟进信息','确认信息备注','沟通情况','跟进结果','确认结果'] : [];
  const rank = (label: string) => priority.includes(label) ? priority.indexOf(label) : priority.length;
  const recent = row.communication?.latestNote ?? row.note;
  return [...new Set([...row.worklist.context].sort((a,b) => rank(a.label)-rank(b.label))
    .map(c => c.value.trim()).filter(value => value && !recent.includes(value)))].slice(0, stage === 'former_student' ? 4 : 2).join(' · ');
}

export const WorklistRow = memo(function WorklistRow({ row, view, actions, active, expanded, mode, keepMounted, hidden, busy, selected, handled, outcome, canAdvance }: {
  row: WorkRow; view: WorklistRowView; actions: RefObject<WorklistRowActions | null>; active: boolean; expanded: boolean; mode: StudentEntryMode | null;
  keepMounted: boolean; hidden: boolean; busy: boolean; selected: boolean; handled: boolean; outcome: WorklistOutcome | null; canAdvance: boolean;
}) {
  const { m, stages, locale, stage, date } = view, placement = row.worklist;
  const nextAt = row.nextContactAt && Number.isFinite(Date.parse(row.nextContactAt)) ? row.nextContactAt : null;
  const communication = row.communication;
  const originalNote = communication?.latestNote || row.note;
  const recentNote = communicationNoteSummary(originalNote);
  const recentDate = communication?.latestAt && Number.isFinite(Date.parse(communication.latestAt))
    ? date(communication.latestAt) : communication?.latestDateLabel;
  const context = view.showContext ? contextText(row, stage) : '';
  return <FollowupRecordRow rowKey={placement.id} detailsId={`worklist-${placement.id}`} title={row.name} colSpan={view.columnCount}
    profileSubject={row} selected={selected}
    active={active} expanded={expanded} keepMounted={keepMounted} pending={busy} focusOnActivate hideTitle
    onActivate={() => actions.current?.focus(placement.id)} onExpandedChange={value => { if (!busy) { if (value) actions.current?.open(row); else actions.current?.close(); } }}
    onSave={row.canWrite ? () => actions.current?.save(placement.id) : undefined}
    onOutcomeChange={stage === 'awaiting_first_contact' && row.canContact ? value => actions.current?.outcome(row, value) : undefined}
    rowProps={{ hidden, className: 'h-12 cursor-pointer [&>td]:py-1.5 [&>td]:align-middle', 'data-worklist-record': placement.id }}
    summary={<>
      {view.selectable ? <TableCell mobileSpan="secondary" className="w-9" onClick={event => event.stopPropagation()}><div className="flex justify-center"><Checkbox
        checked={selected} disabled={busy} aria-label={`${locale.startsWith('en') ? 'Select' : '选择'} ${row.name}`}
        onCheckedChange={checked => actions.current?.select(row, checked === true)} /></div></TableCell> : null}
      <TableCell mobileSpan="primary"><div className="flex items-start gap-1">
        <DashboardRowDisclosure expanded={expanded} controls={`worklist-${placement.id}`} label={`${m.recordByTask[stage]} · ${row.name}`}
          onToggle={() => { if (!busy) { if (expanded) actions.current?.close(); else actions.current?.open(row); } }} />
        <div className="min-w-0"><div className="flex items-center gap-1.5">
        <Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }}>{row.name}</Student360Trigger>
        {handled ? <Check aria-label={m.handled} className="size-3.5 text-leaf-deep" /> : null}</div>
        <span className="block text-[11px] text-muted">{worklistGrade(row, locale)}</span></div></div></TableCell>
      <TableCell mobileLabel={m.phone}>{row.phone || '—'}</TableCell>
      <TableCell mobileLabel={locale.startsWith('en') ? 'Learning support' : '学服'}>{view.canAssign ? <StudentStageOwnerControl row={row} assignees={view.assignees} locale={locale} disabled={busy} context="lead"
        onBusyChange={value => actions.current?.setBusy(value)} onAssigned={result => actions.current?.assigned(result)} /> : row.ownerName || stages.unassigned}</TableCell>
      <TableCell mobileLabel={m.stage}>{row.detail !== 'unassigned' ? <div className="mb-1 text-[11px] text-muted">{stages.details[row.detail] ?? row.detail}</div> : null}
        <RecordStatusIcons row={row} locale={locale} /></TableCell>
      {view.showContext ? <TableCell mobileLabel={m.contextByTask[stage]}><p className="line-clamp-2 leading-5" title={context}>{context || '—'}</p>
        {stage === 'awaiting_enrollment' && row.registrationId && view.canAssess ? <Link className="inline-block py-1 text-primary hover:underline" href={`/dashboard/assessments/${row.registrationId}`}>{m.assessment}</Link> : null}
      </TableCell> : null}
      <TableCell mobileLabel={m.recent}>
        <p className="line-clamp-2 leading-5" title={recentNote}>{recentNote || (communication?.count ? m.noContactNote : m.noNote)}</p>
        {communication?.count ? <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          {recentDate ? <SourceDateText display={recentDate} locale={locale}
            marks={{ basis: communication.latestDateBasis, review: communication.latestDateReview, label: communication.latestDateLabel }} /> : null}
          <span>{communication.latestOutcome ? m.contactOutcomes[communication.latestOutcome] : m.unknownOutcome}</span>
          <Student360Trigger className="font-normal text-muted" subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }}>{m.contactCount(communication.count)}</Student360Trigger>
        </div> : null}
        {nextAt ? <span className={Date.parse(nextAt) < view.now ? 'text-rose-deep' : 'text-muted'}>{m.nextContact} · {date(nextAt)}</span> : null}</TableCell>
    </>}>
    {() => <div className="space-y-2">
      {row.canWrite ? <Entry row={row} requestedMode={mode ?? communicationEntryMode(row)} locale={locale} currentUserId={view.currentUserId} canEnroll={view.canEnroll}
        contactContext={stage === 'awaiting_first_contact' ? 'first_contact' : 'followup'}
        ref={entry => actions.current?.register(placement.id, entry)}
        outcomeRequest={outcome} canAdvance={canAdvance}
        onBusyChange={value => actions.current?.setBusy(value)} onSaved={(result,advance) => actions.current?.saved(row,result,advance)} /> : null}
      <SourceInfo placement={placement} locale={locale} />
      {originalNote ? <details className="text-xs"><summary className="cursor-pointer text-muted">{locale.startsWith('en') ? 'Original latest note' : '最近备注原文'}</summary><p className="mt-2 whitespace-pre-wrap break-words leading-5">{originalNote}</p></details> : null}
    </div>}
  </FollowupRecordRow>;
});
