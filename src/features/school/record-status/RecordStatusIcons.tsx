'use client';

import { BookOpen, CalendarCheck, CalendarClock, CalendarX, Check, CirclePause, ClipboardList, GraduationCap, HeartPulse, Hourglass, MapPin, MessageCircle, Phone, PhoneForwarded, PhoneMissed, PhoneOff, Ticket, UserRound, UsersRound, Wallet } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Student360Trigger } from '../Student360Sheet';
import { WechatGlyph } from '../WechatStatusControl';
import { RECORD_TONE_STYLE, RECORD_UNKNOWN_STYLE } from './tones';
import type { StudentStageRow } from '../student-stage-contract';
import type { StatusFacet } from './contract';
import { recordStageFocus, recordStatusFacets, type ProgressGlyph } from './stage-focus';
import { SourceCommunicationFacts } from './SourceCommunicationFacts';

const PROGRESS_ICONS = { calendar: CalendarClock, calendarCheck: CalendarCheck, calendarX: CalendarX, teacher: GraduationCap, parent: UserRound,
  activity: Ticket, assessment: ClipboardList, message: MessageCircle, hourglass: Hourglass, payment: Wallet, check: Check, pause: CirclePause, class: UsersRound, book: BookOpen,
  phoneMissed: PhoneMissed, phoneCallback: PhoneForwarded, phone: Phone, phoneOff: PhoneOff } satisfies Record<ProgressGlyph, typeof CalendarClock>;
const buttonClass = 'inline-flex size-6 shrink-0 items-center justify-center rounded-md border p-0 transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crater';

export function StatusGlyph({ facet }: { facet: StatusFacet }) {
  if (facet === 'wechat') return <svg viewBox="0 0 24 24" width={14} height={14} className="shrink-0" aria-hidden="true" focusable="false"><WechatGlyph /></svg>;
  const Icon = facet === 'interest' ? HeartPulse : facet === 'visit' ? MapPin : ClipboardList;
  return <Icon size={14} strokeWidth={2} className="shrink-0" aria-hidden="true" focusable="false" />;
}


export function RecordStatusIcons({ row, locale }: { row: StudentStageRow; locale: string }) {
  const { progress } = recordStageFocus(row,locale);
  const en = locale.startsWith('en');
  const labels = en ? { wechat: 'WeChat', interest: 'Interest', visit: 'Visit', assessment: 'Assessment' }
    : { wechat: '微信', interest: '意向', visit: '到访', assessment: '测评' };
  const values: Record<string,string> = en ? { yes:'Added', no:'Not added', unknown:'Not recorded', conflicting:'Needs review', complete:'Completed', promised:'Promised', arrived:'Visited', not_promised:'Not promised' }
    : { yes:'已加微信', no:'未加微信', unknown:'未记录', conflicting:'有矛盾，待核对', complete:'已完成', promised:'已诺访', arrived:'已到访', not_promised:'未诺访' };
  Object.assign(values, { x_plus:'X+', below_a:'X+', g_plus:'G+', a:'A', a_plus:'A+', s:'S', c:'C' });
  const interestValues: Record<string,string> = en ? { A: 'High (A)', B: 'Medium (B)', C: 'Low (C)', interested: 'Interested; level not recorded' }
    : { A: '高（A）', B: '中（B）', C: '低（C）', interested: '有意向，未分级' };
  const unknownLabels: Record<StatusFacet,string> = en
    ? { wechat: 'To confirm', interest: 'To ask about', visit: 'To confirm', assessment: 'Details to complete' }
    : { wechat: '待确认', interest: '待了解', visit: '待确认', assessment: '资料待补齐' };
  const unknownHints: Record<StatusFacet,string> = en ? {
    wechat: 'Confirm whether the parent has been added on WeChat.',
    interest: 'Ask about their current interest during the next conversation and record their response.',
    visit: 'Confirm whether a visit has been promised or has already taken place.',
    assessment: 'Check the existing assessment records and complete the result or evaluation details.',
  } : {
    wechat: '确认是否已添加家长微信。',
    interest: '下次沟通时了解当前意向，按实际回应登记。',
    visit: '确认是否已答应到访，或已经实际到访。',
    assessment: '查看已有测评记录，补齐结果或评价资料。',
  };
  const valueLabel = (type: string, value: string) => (type === 'interest' ? interestValues[value] : undefined) ?? values[value] ?? value;
  const storedBasis = en ? 'Summarized from imported sheets and contact records. Open this student’s records to read the original notes.'
    : '按来源表与沟通记录汇总，与当前情况同源；原文可在此人的全部记录中查看。';
  const visible = recordStatusFacets(row);
  const ProgressIcon = progress ? PROGRESS_ICONS[progress.glyph] : null;
  return <div className="flex items-center gap-1" data-record-status-icons onClick={event => event.stopPropagation()}>
    {progress && ProgressIcon ? <Popover><PopoverTrigger asChild><button type="button" aria-label={progress.label} title={progress.label} data-stage-progress={progress.key}
      className={cn(buttonClass,RECORD_TONE_STYLE[progress.tone])}><ProgressIcon size={14} strokeWidth={2} aria-hidden="true" /></button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] text-sm">
        <p className="font-medium">{progress.label}</p>
        {progress.context.map((line,index) => <p key={index} className="mt-2 whitespace-pre-wrap text-xs text-muted">{line}</p>)}
        <div className="mt-3 border-t border-line pt-2"><Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }}>{en ? 'View related records' : '查看相关记录'}</Student360Trigger></div>
      </PopoverContent></Popover> : null}
    {visible.map(({ facet, status, tone }) => {
      const unknown = status.value === 'unknown' && !status.review;
      const label = `${labels[facet]} · ${status.review ? (en ? 'Needs review' : '待核对') : unknown ? unknownLabels[facet] : valueLabel(facet,status.value)}`;
      return <Popover key={facet}><PopoverTrigger asChild><button type="button" aria-label={label} title={label}
        data-status-facet={facet} className={cn(buttonClass,
          tone ? RECORD_TONE_STYLE[tone] : RECORD_UNKNOWN_STYLE)}>
        <StatusGlyph facet={facet} />
      </button></PopoverTrigger><PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] text-sm">
        <div className="mb-2 font-medium">{label}</div>
        {unknown ? <p className="mb-3 text-xs leading-5 text-muted">{unknownHints[facet]}</p> : null}
        {status.stored ? <p className="mb-3 text-xs leading-5 text-muted">{facet === 'visit' && row.lifecycle?.visitOn
          ? `${en ? 'Latest visit' : '最近到访'} ${row.lifecycle.visitOn.slice(0,10)} · ` : ''}{storedBasis}</p> : null}
        <div className="max-h-72 space-y-3 overflow-y-auto">
          {status.facts.length ? status.facts.map((fact,index) => <div key={`${fact.recordId ?? fact.sourceId ?? ''}:${fact.field}:${index}`} className="border-t border-line pt-2">
            <p className="text-xs text-muted">{fact.field}{fact.date ? ` · ${fact.date.slice(0,10)}` : ''}{fact.certainty === 'review' ? ` · ${en ? 'Needs review' : '待核对'}` : ''}</p>
            <p className="my-1 font-medium">{valueLabel(fact.type,fact.value)}</p>
            {fact.excerpt ? <p className="whitespace-pre-wrap break-words text-xs leading-5">{fact.excerpt}</p> : null}
          </div>) : unknown || status.stored ? null : <p className="text-xs text-muted">{en ? 'No explicit fact has been recorded.' : '现有记录中没有明确填写这一项。'}</p>}
        </div>
        <div className="mt-3 border-t border-line pt-2"><Student360Trigger subject={{ studentId: row.studentId, leadId: row.leadId }} fallback={{ name: row.name, phone: row.phone, grade: row.grade }}>{en ? 'Open this student’s records' : '查看此人的全部记录'}</Student360Trigger></div>
      </PopoverContent></Popover>;
    })}
    <SourceCommunicationFacts facts={row.statusEvidence??[]} locale={locale} />
  </div>;
}
