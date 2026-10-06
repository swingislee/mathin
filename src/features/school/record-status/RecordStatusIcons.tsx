'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Student360Trigger } from '../Student360Sheet';
import { WechatGlyph } from '../WechatStatusControl';
import type { StudentStageRow } from '../student-stage-contract';
import { resolveStatusEvidence, type StatusFacet } from './contract';

export function StatusGlyph({ facet, value, review = false }: { facet: StatusFacet; value: string; review?: boolean }) {
  const unknown = value === 'unknown', negative = value === 'no' || value === 'not_promised';
  const symbol = review ? '!' : unknown ? '?' : negative ? '×' : facet === 'interest' ? value : facet === 'assessment' && value !== 'complete' ? value : '✓';
  return <svg viewBox="0 0 32 32" className="size-8 shrink-0" fill="none" aria-hidden="true" focusable="false">
    {facet === 'wechat' ? <g transform="translate(1 0) scale(1.1)"><WechatGlyph /></g>
      : facet === 'interest' ? <path d="M16 26 5 15C-2 5 11 0 16 8c5-8 18-3 11 7Z" stroke="currentColor" strokeWidth="2" />
      : facet === 'visit' ? <><path d="M16 27s10-9 10-16a10 10 0 0 0-20 0c0 7 10 16 10 16Z" stroke="currentColor" strokeWidth="2" /><circle cx="16" cy="11" r="3" stroke="currentColor" strokeWidth="2" /></>
      : <><rect x="5" y="5" width="22" height="25" rx="3" stroke="currentColor" strokeWidth="2" /><rect x="11" y="2" width="10" height="6" rx="2" fill="var(--color-card,white)" stroke="currentColor" strokeWidth="2" /></>}
    {facet !== 'assessment' && facet !== 'interest' ? <circle cx="25" cy="25" r="7" fill="var(--color-card,white)" /> : null}
    <text x={facet === 'assessment' || facet === 'interest' ? 16 : 25} y={facet === 'assessment' || facet === 'interest' ? 23 : 30}
      textAnchor="middle" fill="currentColor" fontWeight="700" fontSize={symbol.length > 2 ? 10 : 14}>{symbol}</text>
  </svg>;
}

export function RecordStatusIcons({ row, locale }: { row: StudentStageRow; locale: string }) {
  const en = locale.startsWith('en');
  const labels = en ? { wechat: 'WeChat', interest: 'Interest', visit: 'Visit', assessment: 'Assessment' }
    : { wechat: '微信', interest: '意向', visit: '到访', assessment: '测评' };
  const values: Record<string,string> = en ? { yes:'Added', no:'Not added', unknown:'Not recorded', conflicting:'Needs review', complete:'Completed', promised:'Promised', arrived:'Visited', not_promised:'Not promised' }
    : { yes:'已加微信', no:'未加微信', unknown:'未记录', conflicting:'有矛盾，待核对', complete:'已完成', promised:'已诺访', arrived:'已到访', not_promised:'未诺访' };
  return <div className="flex items-center gap-2" data-record-status-icons onClick={event => event.stopPropagation()}>
    {(['wechat','interest','visit','assessment'] as const).map(facet => {
      const status = resolveStatusEvidence(row.statusEvidence ?? [],facet);
      const label = `${labels[facet]} · ${status.review ? (en ? 'Needs review' : '待核对') : values[status.value] ?? status.value}`;
      return <Popover key={facet}><PopoverTrigger asChild><button type="button" aria-label={label} title={label}
        className={cn('rounded-md p-0.5 transition-colors hover:bg-line/30 focus-visible:outline-2 focus-visible:outline-crater',
          status.review ? 'text-amber-600' : status.value === 'unknown' ? 'text-muted/45' : ['no','not_promised','C'].includes(status.value) ? 'text-rose-deep' : 'text-leaf-deep')}>
        <StatusGlyph facet={facet} value={status.value} review={status.review} />
      </button></PopoverTrigger><PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] text-sm">
        <div className="mb-2 font-medium">{label}</div>
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {status.facts.length ? status.facts.map((fact,index) => <div key={`${fact.recordId ?? fact.sourceId ?? ''}:${fact.field}:${index}`} className="border-t border-line pt-2">
            <p className="text-xs text-muted">{fact.field}{fact.date ? ` · ${fact.date.slice(0,10)}` : ''}{fact.certainty === 'review' ? ` · ${en ? 'Needs review' : '待核对'}` : ''}</p>
            <p className="my-1 font-medium">{values[fact.value] ?? fact.value}</p>
            {fact.excerpt ? <p className="whitespace-pre-wrap break-words text-xs leading-5">{fact.excerpt}</p> : null}
          </div>) : <p className="text-xs text-muted">{en ? 'No explicit fact has been recorded.' : '现有记录中没有明确填写这一项。'}</p>}
        </div>
        <div className="mt-3 border-t border-line pt-2"><Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }}>{en ? 'Open this student’s records' : '查看此人的全部记录'}</Student360Trigger></div>
      </PopoverContent></Popover>;
    })}
  </div>;
}
