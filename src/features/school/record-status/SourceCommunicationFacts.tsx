'use client';

import { Tags } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { LEARNING_CHECK_STATUS_STYLE } from '../session-learning-visual';
import type { StatusEvidence } from './contract';

const labels: Record<string,[string,string]> = {
  'contact_conflict:result_and_note':['联系结果与备注待核对','Contact result and note need review'],
  'invitation_progress:coordinating':['待重新约时间','Time to rearrange'],
  'invitation_progress:awaiting_parent':['待家长确认','Awaiting parent confirmation'],
  'invitation_progress:awaiting_teacher':['待老师确认','Awaiting teacher confirmation'],
  'invitation_progress:booked':['曾约到访／测评','Visit / assessment agreed'],
  'followup_progress:callback_requested':['约定回拨','Callback requested'],
  'followup_progress:deferred':['延后联系','Contact deferred'],
  'enrollment_progress:considering':['考虑／商量中','Considering / discussing'],
  'enrollment_progress:ready_to_enroll':['表达报名意愿','Intends to enroll'],
  'enrollment_progress:payment_pending':['待付款','Payment pending'],
  'enrollment_progress:not_enrolling':['表达暂不报名','Not enrolling at that time'],
  'enrollment_report:reported':['报名／缴费待核实','Reported enrollment / payment'],
  'concern:cost':['费用顾虑','Cost concern'],
  'concern:distance':['距离／接送问题','Travel / transport concern'],
  'concern:schedule':['时间冲突','Scheduling concern'],
  'concern:family_decision':['家庭商量／孩子意愿','Family / child decision'],
  'concern:other_provider':['已有其他机构课程','Another provider mentioned'],
};

/** 将原文中的进展与顾虑放在同一可追溯入口；保留发生时间，不替代新登记。 */
export function SourceCommunicationFacts({ facts, locale }: { facts: StatusEvidence[]; locale: string }) {
  const en = locale.startsWith('en');
  const rows = facts.filter(fact => `${fact.type}:${fact.value}` in labels)
    .filter((fact,index,all) => all.findIndex(other => other.type===fact.type && other.value===fact.value
      && other.excerpt===fact.excerpt && other.date===fact.date)===index)
    .sort((a,b)=>(b.date??'').localeCompare(a.date??''));
  if (!rows.length) return null;
  const title = en ? 'Conversation context' : '沟通进展与顾虑';
  const tagLabels = [...new Set(rows.map(f=>labels[`${f.type}:${f.value}`][en?1:0]))];
  return <Popover><PopoverTrigger asChild><button type="button" aria-label={`${title} · ${tagLabels.join('、')}`}
    title={`${title} · ${tagLabels.join('、')}`} data-source-communication-facts
    className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md border p-0 transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crater',LEARNING_CHECK_STATUS_STYLE.prompted.active)}>
    <Tags size={14} strokeWidth={2} aria-hidden="true" />
  </button></PopoverTrigger><PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] text-sm">
    <p className="font-medium">{title}</p>
    <div className="my-2 flex flex-wrap gap-1">{tagLabels.map(label=><span key={label} className="rounded border border-line px-1.5 py-0.5 text-xs">{label}</span>)}</div>
    <p className="mb-2 text-xs text-muted">{en ? 'Recorded at the time shown. Confirm the current situation in your next conversation.' : '以下为当时沟通中记录的进展，可在本次联系时确认最新情况。'}</p>
    <div className="max-h-80 space-y-3 overflow-y-auto">{rows.map((fact,index)=><div key={`${fact.recordId??fact.sourceId??''}:${index}`} className="border-t border-line pt-2">
      <p className="font-medium">{labels[`${fact.type}:${fact.value}`][en?1:0]}</p>
      <p className="my-1 text-xs text-muted">{fact.field} · {fact.date?.slice(0,10)??fact.dateLabel??(en?'Date not recorded':'日期未记录')}{fact.certainty==='review'?(en?' · To verify':' · 待核实'):''}</p>
      <p className="whitespace-pre-wrap break-words text-xs leading-5">{fact.excerpt}</p>
    </div>)}</div>
  </PopoverContent></Popover>;
}
