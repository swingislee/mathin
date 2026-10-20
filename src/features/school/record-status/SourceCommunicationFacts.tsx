'use client';

import type { ReactNode } from 'react';
import { Tags } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { RECORD_TONE_STYLE } from './tones';
import type { StatusEvidence } from './contract';
import { communicationFactLabels as labels, communicationFactRows, communicationFactTags } from './communication-facts';

/** 将原文中的进展与顾虑放在同一可追溯入口；保留发生时间，不替代新登记。 */
export function SourceCommunicationFacts({ facts, locale, tags, onOpenChange, children }: {
  facts: StatusEvidence[]; locale: string; tags?: string[]; onOpenChange?: (open: boolean) => void; children?: ReactNode;
}) {
  const en = locale.startsWith('en');
  const keys = tags ?? communicationFactTags(facts);
  if (!keys.length) return null;
  const title = en ? 'Conversation context' : '沟通进展与顾虑';
  const tagLabels = keys.flatMap(key => labels[key] ? [labels[key][en?1:0]] : []);
  return <Popover onOpenChange={onOpenChange}><PopoverTrigger asChild><button type="button" aria-label={`${title} · ${tagLabels.join('、')}`}
    title={`${title} · ${tagLabels.join('、')}`} data-source-communication-facts
    className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md border p-0 transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crater',RECORD_TONE_STYLE.progress)}>
    <Tags size={14} strokeWidth={2} aria-hidden="true" />
  </button></PopoverTrigger><PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] text-sm">
    <p className="font-medium">{title}</p>
    <div className="my-2 flex flex-wrap gap-1">{tagLabels.map(label=><span key={label} className="rounded border border-line px-1.5 py-0.5 text-xs">{label}</span>)}</div>
    {children ?? <SourceCommunicationFactsContent facts={facts} locale={locale} />}
  </PopoverContent></Popover>;
}

export function SourceCommunicationFactsContent({ facts, locale }: { facts: StatusEvidence[]; locale: string }) {
  const en = locale.startsWith('en'), rows = communicationFactRows(facts);
  return <>
    <p className="mb-2 text-xs text-muted">{en ? 'Recorded at the time shown. Confirm the current situation in your next conversation.' : '以下为当时沟通中记录的进展，可在本次联系时确认最新情况。'}</p>
    <div className="max-h-80 space-y-3 overflow-y-auto">{rows.map((fact,index)=><div key={`${fact.recordId??fact.sourceId??''}:${index}`} className="border-t border-line pt-2">
      <p className="font-medium">{labels[`${fact.type}:${fact.value}`][en?1:0]}</p>
      <p className="my-1 text-xs text-muted">{fact.field} · {fact.date?.slice(0,10)??fact.dateLabel??(en?'Date not recorded':'日期未记录')}{fact.certainty==='review'?(en?' · To verify':' · 待核实'):''}</p>
      <p className="whitespace-pre-wrap break-words text-xs leading-5">{fact.excerpt}</p>
    </div>)}</div>
  </>;
}
